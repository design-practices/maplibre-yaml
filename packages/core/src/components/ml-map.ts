/**
 * @file Unified MLMap web component for maplibre-yaml
 * @module @maplibre-yaml/core/components/ml-map
 *
 * @description
 * The `<ml-map>` component is the primary way to embed MapLibre maps configured
 * with YAML. It supports multiple configuration methods to fit any use case.
 *
 * ## Configuration Methods (in priority order)
 *
 * ### 1. External YAML File (Recommended)
 * ```html
 * <ml-map src="/configs/my-map.yaml"></ml-map>
 * ```
 *
 * ### 2. Inline YAML via Script Tag
 * `type="text/yaml"`, `application/yaml` (or the `x-yaml` variants),
 * `application/json` and `application/toml` all work.
 * ```html
 * <ml-map>
 *   <script type="text/yaml">
 * type: map
 * id: my-map
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   mapStyle: "https://tiles.openfreemap.org/styles/liberty"
 * layers: []
 *   </script>
 * </ml-map>
 * ```
 *
 * ### 3. Config Attribute (Programmatic)
 * Document text in any of the three formats.
 * ```html
 * <ml-map config='{"type":"map",...}'></ml-map>
 * ```
 */

import { consoleText } from "../utils/console-text";
import { prefetchProtomapsBasemap } from "../formats/protomaps-style";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  YAMLParser,
  type MapBlock,
  type ParseError,
  type ValidationWarning,
} from "../parser/yaml-parser.js";
import { BaseElement } from "./base-element.js";
import { MapRenderer } from "../renderer/map-renderer.js";
import type {
  AppliedDocument,
  DiffHints,
  RejectionKind,
  UpdateResult,
  UpdateSummary,
} from "../renderer/update/types.js";
import { NO_HINTS, cameraChanged, emptySummary, needsRebuild } from "../renderer/update/rebuild.js";
import {
  toModel,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "../model/index.js";
import type { MapModel } from "../model/types.js";
import { createErrorCard, ERROR_CARD_CLASS, tomlReaderCard } from "./error-card.js";
import { findDocumentScript, noDocumentMessage } from "./document-script.js";
import { after, fetchDocument, readDocument, type DocumentText } from "./document-ingest.js";
import { MapNotice, appendMessage, type NoticeKind } from "./map-notice.js";
import { showAuthorHints } from "./author-hints.js";
import {
  createStrings,
  defaultStrings,
  documentLocale,
  type StringKey,
  type MapLibreStringKey,
  type StringParams,
  type Strings,
} from "../i18n/strings.js";
import {
  describeDataProblem,
  describeFetchRejection,
  describeHostLayerCollision,
  describeImageProblem,
  describeLayerProblem,
  describeRejectedUpdate,
  describeStyleRejection,
  describeMarkerIconProblem,
  describeSourceProblem,
  describeFitToProblem,
  describeSwappedCenter,
  filePageWorkerCard,
  isFilePage,
  styleFailureCard,
  type ErrorCardContent,
} from "./student-messages.js";
import {
  getEffectsHost,
  onEffectsHost,
  type EffectBlock,
  type EffectLayerRef,
  type EffectsAttachment,
} from "../effects-host.js";
import type {
  ChromeMount,
  MapErrorContext,
  MapRendererEvents,
  MapRendererOptions,
} from "../renderer/map-renderer.js";
import type { FeatureCollection } from "geojson";
import { DataFetcher } from "../data/data-fetcher.js";
import { isLoadedFromUrl, loadSourceData } from "../data/source-data.js";
import { geoParquetColumns, isGeoParquetSource } from "../formats/columns.js";
import { LoadingIndicator } from "./loading-indicator.js";
import { formatOfSource } from "../formats/detect.js";
import { cogUrl } from "../formats/cog-spec.js";
import { fileUrlOf } from "../formats/cog.js";
import { readCogHeaderAhead } from "../formats/cog-protocol.js";
import { absoluteUrl } from "../renderer/cloud-sources.js";
import { CHROME_CORNERS, type ChromeCorner } from "../renderer/chrome-layout.js";
import { displayPath } from "../parser/validation-utils.js";
import {
  applyDocumentBase,
  applyDocumentBaseToLayer,
  normalizeDocumentBase,
} from "../utils/document-base.js";

/**
 * Named slots v1 (KTD9): the four chrome corners plus `legend`, which
 * replaces the built-in legend. Light-DOM named containers, not shadow slots
 * — `<ml-map>` has no shadow root; a direct child carrying one of these
 * `slot` values is adopted into the renderer's corner system on load.
 */
export const ML_MAP_SLOTS: readonly string[] = [...CHROME_CORNERS, "legend"];

/**
 * `detail` of `ml-map:error`. Two shapes: a document that failed to load
 * (parse, validation, fetch, or a missing config) carries the structured
 * `errors`; a MapLibre error at runtime carries the `error` and whether it was
 * `fatal` (load-aborting) or not (a 404'd tile, for example).
 */
export type MLMapErrorDetail =
  | { errors: ParseError[]; error?: undefined; fatal?: undefined }
  | { error: Error; fatal: boolean; errors?: undefined };

/** Who owns the camera across document updates (KTD13): the `camera` attribute's values. */
export type MLMapCameraOwner = "document" | "host";

/**
 * Every event `<ml-map>` dispatches, by name, typed with its `detail`. All of
 * them bubble.
 *
 * @remarks
 * Drives the typed `addEventListener` overloads on {@link MLMap} and the
 * React 19 `onml-map:*` props in `@maplibre-yaml/core/react`. A test pins its
 * keys to the `new CustomEvent("ml-map:…")` calls in this file, so the map
 * cannot drift from what the element actually fires.
 */
export interface MLMapEventMap {
  "ml-map:load": CustomEvent<Record<string, never>>;
  "ml-map:error": CustomEvent<MLMapErrorDetail>;
  "ml-map:loading": CustomEvent<{ url: string }>;
  "ml-map:layer-added": CustomEvent<MapRendererEvents["layer:added"]>;
  "ml-map:layer-removed": CustomEvent<MapRendererEvents["layer:removed"]>;
  "ml-map:layer-data-loading": CustomEvent<MapRendererEvents["layer:data-loading"]>;
  "ml-map:layer-data-loaded": CustomEvent<MapRendererEvents["layer:data-loaded"]>;
  "ml-map:layer-data-error": CustomEvent<MapRendererEvents["layer:data-error"]>;
  "ml-map:layer-click": CustomEvent<MapRendererEvents["layer:click"]>;
  "ml-map:layer-hover": CustomEvent<MapRendererEvents["layer:hover"]>;
  "ml-map:markers-added": CustomEvent<MapRendererEvents["markers:added"]>;
  "ml-map:marker-click": CustomEvent<MapRendererEvents["marker:click"]>;
  "ml-map:marker-icon-error": CustomEvent<MapRendererEvents["marker:icon-error"]>;
  "ml-map:image-error": CustomEvent<MapRendererEvents["image:error"]>;
  "ml-map:parameter-change": CustomEvent<MapRendererEvents["parameter:change"]>;
  "ml-map:layer-visibility": CustomEvent<MapRendererEvents["layer:visibility"]>;
  "ml-map:camera-fit": CustomEvent<MapRendererEvents["camera:fit"]>;
  "ml-map:layer-classified": CustomEvent<MapRendererEvents["layer:classified"]>;
  "ml-map:update-applied": CustomEvent<MapRendererEvents["update:applied"]>;
  "ml-map:update-rejected": CustomEvent<MapRendererEvents["update:rejected"]>;
  "ml-map:state-change": CustomEvent<MapRendererEvents["state:change"]>;
}

/**
 * A serialisation of a config candidate, used to skip re-renders when an
 * equal config is assigned again (ml-i10). `JSON.stringify` is the structural
 * compare: linear in the document's size, which is noise next to rebuilding a
 * WebGL map, and it is exactly the equality the documents themselves have
 * (they are JSON/YAML data). Key order counts, so `{a, b}` and `{b, a}` are
 * "different" and re-render, the safe direction. `null` when the value cannot
 * be serialised (a cycle, a BigInt): such a value never compares equal, so it
 * always renders, as before.
 */
function configKey(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** One line of the non-fatal notice and how it was reported (see `reportProblem`). */
interface NoticeEntry {
  message: string;
  kind: NoticeKind;
  /**
   * What the line is about, so a successful retry or replacement withdraws
   * it: `layer:<id>` (a layer that didn't draw), `data:<id>` (a layer whose
   * data didn't load), `source:<id>` (a named source), `document` (the
   * parser's on-page warnings for the document shown). Absent for the rest.
   */
  about?: string;
}

/** How a line is reported: `console.error` it too (`log`), the kind, what it is about. */
type NoticeOptions = Omit<NoticeEntry, "message" | "kind"> & { log?: boolean; kind?: NoticeKind };

/** A line to put on the notice, held until its map is the one showing (a swap's next map, KTD8). */
type NoticeLine = [message: string, options: NoticeOptions];

/** The author hints the renderer reports through `onError` — never map errors: the line for the notice, if the context is one. */
function hintLine(error: Error, context: MapErrorContext | undefined): NoticeLine | undefined {
  if (!context) return undefined;
  // A fitTo.source typo (ml-aot.51): the renderer already warned on the console.
  if (context.kind === "fit" && context.sourceId) return [describeFitToProblem(context.sourceId, context.suggestion), { kind: "hint" }];
  // A classified field the data has no value for (ml-aot.95), a source's or a layer's hint: the message is the whole line.
  if (context.kind === "classify-field" || context.kind === "source-hint" || context.kind === "layer-hint") return [error.message, { kind: "hint" }];
  // `center: [lat, lng]` (ml-aot.65).
  if (context.kind === "center" && context.center && context.swapped) return [describeSwappedCenter(context.center, context.swapped), { kind: "hint" }];
  return undefined;
}

/** The normalized document as the renderer keeps it (KTD15): what `update()` takes. */
function toApplied(model: MapModel): AppliedDocument {
  return {
    config: denormalizeConfig(model),
    layers: denormalizeLayers(model),
    sources: denormalizeSources(model),
    options: denormalizeOptions(model),
  };
}

/** `errors` of an `ml-map:update-rejected`, from the parser's diagnostics. */
function toUpdateErrors(kind: RejectionKind, errors: ParseError[]): NonNullable<UpdateResult["errors"]> {
  return errors.map((e) => ({ kind, message: e.message, ...(e.path ? { path: e.path } : {}) }));
}

/** A map's camera as it is now: what a fallback rebuild carries across (KTD8). */
function currentCamera(map: MapLibreMap): NonNullable<MapRendererOptions["initialCamera"]> {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

/** A fallback rebuild in flight (KTD8): the next map, built off the page, until it loads or fails. */
interface PendingSwap {
  renderer: MapRenderer;
  container: HTMLDivElement;
  mapBlock: MapBlock;
  model: MapModel;
  /** Carry the old map's camera over (the document's camera didn't change, or the host owns it). */
  keepCamera: boolean;
  /** `documentLoaded` before the swap: restored when the new map never loads. */
  wasLoaded: boolean;
  failed: boolean;
  /** What the next map reported while it loaded: put on the notice when it takes the old map's place, dropped when it never does. */
  notices: NoticeLine[];
  resolve: (result: UpdateResult) => void;
}

/**
 * A document read and handed on (KTD8): its outcome, still to come. A
 * wrapper, because a promise resolved with a promise flattens: `reload()`
 * waits for the read, `update()` for the outcome.
 */
type Routed = { outcome: Promise<UpdateResult> | UpdateResult };

const SUPERSEDED: Routed = { outcome: { outcome: "superseded" } };

/** A document that arrived during a swap: applied once the swap settles (last wins, KTD5). */
interface QueuedDocument {
  mapBlock: MapBlock;
  hints: DiffHints;
  resolve: (result: UpdateResult | PromiseLike<UpdateResult>) => void;
}

/**
 * Whether the document's deferred and module scripts may still be waiting to
 * run, i.e. DOMContentLoaded has not fired yet.
 *
 * @remarks
 * `readyState` alone cannot tell: module and `defer` scripts run AFTER
 * parsing ends, when it already reads `"interactive"`, and DOMContentLoaded
 * fires only once they have all run. The navigation timing entry's
 * `domContentLoadedEventStart` stays 0 until that event starts, which
 * closes the gap. Without a navigation entry (jsdom, odd embeddings) an
 * `"interactive"` document counts as ready — the pre-0.7.1 behaviour.
 */
function pageScriptsPending(doc: Document): boolean {
  if (doc.readyState === "loading") return true;
  if (doc.readyState !== "interactive") return false;
  try {
    const perf = doc.defaultView?.performance;
    const nav = perf?.getEntriesByType?.("navigation")?.[0] as
      | PerformanceNavigationTiming
      | undefined;
    return nav !== undefined && nav.domContentLoadedEventStart === 0;
  } catch {
    return false;
  }
}

/** Class on the element's own map container — the only child it owns while a map renders. */
const MAP_CONTAINER_CLASS = "ml-map-container";

/**
 * A `fitTo` source's data, loading ahead of the map (ml-aot.75). See
 * {@link MLMap.fitToWaitMs}.
 */
interface FitPrefetch {
  /** The `sources:` name `fitTo` names. */
  sourceId: string;
  /** The load (shared with the renderer, so the data is requested once). */
  data: Promise<FeatureCollection>;
  /** The fetcher (and cache) that loads it, handed to the renderer. */
  fetcher: DataFetcher;
  /** Set once `data` settles. */
  result: { data: FeatureCollection } | { error: unknown } | null;
  /**
   * A COG (ml-aot.120): its header's extent, read ahead (the `cog://`
   * handler reuses the read); `data` then settles with it and `extent` is
   * set when the file has one.
   */
  extent?: [number, number, number, number];
}

/**
 * Start loading the data `fitTo` frames, when it is a fetched GeoJSON
 * source, so the map can be built already framed on it. `null` otherwise
 * (no `fitTo`, inline data, a tiled source, a name that matches nothing).
 */
function startFitPrefetch(model: MapModel): FitPrefetch | null {
  const fitTo = model.runtime.fitTo;
  if (!fitTo) return null;
  const sources = denormalizeSources(model);
  const source = sources?.[fitTo.source];
  if (isCogFitSource(source)) return startCogFitPrefetch(fitTo.source, source);
  if (!isLoadedFromUrl(source)) return null;
  // A GeoParquet file is read for the columns the document references
  // (ml-cnv.4) — the same list the renderer computes, since it reuses this load.
  const columns = isGeoParquetSource(source)
    ? geoParquetColumns(sources, denormalizeLayers(model)).get(fitTo.source)
    : undefined;
  const fetcher = new DataFetcher();
  const prefetch: FitPrefetch = {
    sourceId: fitTo.source,
    data: loadSourceData(columns ? { ...source, columns } : source, { fetcher }),
    fetcher,
    result: null,
  };
  // Settled either way here; the renderer reports a failure through its
  // usual data-error path when it awaits the same promise.
  prefetch.data.then(
    (data) => (prefetch.result = { data }),
    (error: unknown) => (prefetch.result = { error })
  );
  return prefetch;
}

/** A `raster` / `raster-dem` source reading a COG (ml-cnv.2). */
function isCogFitSource(source: unknown): source is Record<string, unknown> & { url: string } {
  if (!source || typeof source !== "object") return false;
  const s = source as Record<string, unknown>;
  return (
    (s["type"] === "raster" || s["type"] === "raster-dem") &&
    typeof s["url"] === "string" &&
    formatOfSource(s) === "cog"
  );
}

/**
 * Read a `fitTo` COG's header ahead of the map (ml-aot.120), so the map is
 * built framed on the file's extent like a fetched GeoJSON source — within
 * the same {@link MLMap.fitToWaitMs} wait. The `cog://` handler reuses the
 * read. A header without an extent (or a failed read, which the handler
 * reports) leaves the fit to the reader, once its metadata loads.
 */
function startCogFitPrefetch(sourceId: string, source: { url: string }): FitPrefetch {
  const fileUrl = fileUrlOf(cogUrl(source.url, { absolute: absoluteUrl }));
  const prefetch: FitPrefetch = {
    sourceId,
    data: Promise.resolve({ type: "FeatureCollection", features: [] }),
    fetcher: new DataFetcher(),
    result: null,
  };
  prefetch.data = readCogHeaderAhead(fileUrl).then((header) => {
    if (header?.bounds) prefetch.extent = header.bounds;
    return { type: "FeatureCollection", features: [] } as FeatureCollection;
  });
  return prefetch;
}

/**
 * MLMap custom element for rendering MapLibre maps from YAML/JSON configuration.
 *
 * @fires ml-map:load - Map loaded and ready for interaction
 * @fires ml-map:error - Error during initialization or runtime
 * @fires ml-map:loading - Loading configuration from URL
 * @fires ml-map:layer-added - Layer was added to the map
 * @fires ml-map:layer-removed - Layer was removed from the map
 * @fires ml-map:layer-data-loading - Layer data is being fetched
 * @fires ml-map:layer-data-loaded - Layer data loaded successfully
 * @fires ml-map:layer-data-error - Layer data failed to load
 * @fires ml-map:layer-click - User clicked on a layer feature
 * @fires ml-map:layer-hover - User hovered over a layer feature
 * @fires ml-map:markers-added - Standalone `markers:` pins were added
 * @fires ml-map:marker-click - User clicked a standalone marker
 * @fires ml-map:marker-icon-error - A marker icon failed (unsafe scheme or load error); the default pin was substituted
 * @fires ml-map:image-error - A declared `images:` entry failed (unsafe scheme, load or register error)
 * @fires ml-map:parameter-change - A params-panel control wrote a state key
 * @fires ml-map:layer-visibility - A params-panel checkbox toggled a layer
 * @fires ml-map:camera-fit - The `fitTo` camera framed its source's data (detail: source, bounds)
 * @fires ml-map:layer-classified - A `classify:` layer's classes as drawn (detail: layerId, classify), on load and when fetched data (re)computes them
 * @fires ml-map:update-applied - A changed document was applied to the running map (detail: summary; `summary.rebuild` when a basemap change rebuilt it)
 * @fires ml-map:update-rejected - A changed document was refused and the running map kept (detail: kind, errors)
 * @fires ml-map:state-change - The document's `state:` values changed (detail: values, changed)
 */
export class MLMap extends BaseElement {
  /** Internal MapRenderer instance */
  private renderer: MapRenderer | null = null;

  /** Whether the component has been initialized */
  private initialized = false;

  /**
   * Whether the DOCUMENT finished loading — set when the renderer's `load`
   * fires (basemap ready AND every document layer added), not MapLibre's
   * earlier map-`load`. `mapReady()`'s fast path keys on this so it resolves
   * on exactly the condition `ml-map:load` announces.
   */
  private documentLoaded = false;

  /**
   * Terminal document failure, kept so a `mapReady()` call arriving AFTER
   * `ml-map:error` fired rejects instead of waiting forever for events that
   * will never recur. Cleared on every re-render. Runtime maplibre errors
   * (non-fatal — the map still loads) do not land here.
   */
  private lastError: Error | null = null;

  /** Container element for the map */
  private mapContainer: HTMLDivElement | null = null;

  /** Parsed and validated configuration */
  private _config: MapBlock | null = null;

  /**
   * JSON serialisation of the last config handed to the element through the
   * `config` property or attribute and rendered (or rejected). An assignment
   * that serialises identically is a no-op (ml-i10): frameworks reassign the
   * property whenever the bound object's identity changes, and tearing the
   * map down for an equal document would reset the camera on every parent
   * re-render. Cleared whenever the map is rendered from another source.
   */
  private appliedConfigKey: string | null = null;

  /**
   * Bumped by every document handed in (KTD8): a read still waiting (a
   * fetch, the TOML reader) when a newer document arrives is dropped, and
   * its outcome is `superseded`.
   */
  private generation = 0;

  /** The document text being read, with its outcome: assigning the same text again joins it. */
  private pendingText: { text: string; routed: Promise<Routed> } | null = null;

  /** Document text assigned before the element connected: read when it does. */
  private textBeforeConnect: string | null = null;

  /**
   * Cancels the pending "No configuration provided" check (ml-mpm), or
   * `null` when none is pending. See {@link scheduleEmptyConfigCheck}.
   */
  private cancelPendingEmptyCheck: (() => void) | null = null;

  /**
   * Cancels a map construction waiting for DOMContentLoaded (ml-aot.2), or
   * `null` when none is waiting. See {@link renderMap}.
   */
  private cancelDeferredRender: (() => void) | null = null;

  /**
   * How long `<ml-map>` waits for a `fitTo` source's data before it builds
   * the map anyway, in milliseconds (ml-aot.75).
   *
   * @remarks
   * When `config.fitTo` names a `url:` GeoJSON source, the element fetches
   * that file as soon as the document is read and builds the map with the
   * data's bounds, so the first frame is already framed — no load at the
   * authored center/zoom followed by a jump. If the file takes longer than
   * this, the map is built at the authored `center`/`zoom` and jumps once
   * the data lands (the 0.8 behaviour); the file is still requested only
   * once. Set it before maps render (`MLMap.fitToWaitMs = 3000`); `0` turns
   * the wait off.
   */
  static fitToWaitMs = 1500;

  /**
   * The effects attached to the current map (experimental, 0.7), and the
   * subscription waiting for an effects host that registers late. Both are
   * torn down with the renderer, so a reload never leaks a custom layer.
   */
  private effectsAttachment: EffectsAttachment | null = null;
  private effectsWait: (() => void) | null = null;
  /** The model the effects were last set up from: what an update's re-attach rebuilds (set per update). */
  private effectsModel: MapModel | null = null;

  /** A fallback rebuild in flight (KTD8), or `null`. At most one: a second waits for it. */
  private swap: PendingSwap | null = null;
  /** The document that arrived during a swap; applied once the swap settles. */
  private queuedDocument: QueuedDocument | null = null;
  /** The outcome of the latest document routed through `config`, `src`, `base` or `reload()`: what {@link update} resolves with. */
  private lastUpdate: Promise<UpdateResult> | null = null;
  /**
   * The document to go back to if an in-place update is refused (KTD5): the
   * one the map shows, recorded by the first update in flight and moved by
   * each that applies, so a refusal never clobbers a later update's write.
   */
  private rollback: { config: MapBlock | null; effects: MapModel | null } | null = null;
  /** The rejected-update hint on the notice, taken down when a later document applies. */
  private rejectionHint: string | null = null;

  /**
   * Whether the one-time dev diagnostics have already run for this element.
   * Repeated `config`/`src` updates and `reload()` re-render the map but must
   * not re-spam the same console warnings.
   */
  private diagnosticsRun = false;

  /**
   * Whether the MapLibre-CSS diagnostic is still owed: armed by the one-time
   * diagnostics, run when the first map loads (ml-aot.10).
   */
  private cssCheckPending = false;

  /**
   * Whether the zero-height diagnostic is still owed. Like the CSS check it
   * runs once the map has loaded, not at construction (ml-aot.16): by then
   * slot children have moved into their corners — while they were still in
   * normal flow they gave the host a height the map itself never had — and
   * a stylesheet that sizes the element has had time to apply.
   */
  private heightCheckPending = false;

  /** The on-page "this map has no height" hint, while it is shown. */
  private heightHint: HTMLElement | null = null;

  /** Removes {@link heightHint} once the map gets a height. */
  private heightObserver: ResizeObserver | null = null;

  /**
   * The non-fatal "part of this map couldn't load" notice (ml-aot.15), created
   * on the first layer/source/data problem of the current render.
   */
  private notice: MapNotice | null = null;
  /**
   * Every line reported for the current render, shown or not — so turning
   * `debug` on (or `quiet` off) later can rebuild the notice (ml-aot.57).
   * `about` names the layer, its data, or the source a line describes
   * (`layer:<id>`, `data:<layerId>`, `source:<id>`), so an update that
   * retries or replaces it withdraws the line once it succeeds (KTD11).
   */
  private noticeEntries: NoticeEntry[] = [];
  /** The current document's `onPage` warnings, shown once its map renders. */
  private documentNotices: string[] = [];
  /**
   * The UI strings of the document being rendered (its `locale:`); English
   * until a document has been read.
   */
  private strings: Strings = defaultStrings;

  /** `aria-busy` and a delayed "Loading map…" until the basemap draws (ml-aot.121). */
  private readonly loading = new LoadingIndicator(
    this,
    () => this.mapContainer,
    () => this.strings("maplibre-yaml.Loading")
  );

  /**
   * Resolved URL of the YAML file the current document came from (`src`),
   * or `null` for inline/JSON/property documents. Only used to explain how
   * relative data paths resolve when one fails to load.
   */
  private documentUrl: string | null = null;

  /**
   * Basemap-style errors collected within one task, so a style that fails
   * validation several times over shows one card (ml-aot.14).
   */
  private pendingStyleErrors: Error[] | null = null;

  /**
   * Observed attributes that trigger attributeChangedCallback
   */
  static get observedAttributes(): string[] {
    return ["src", "config", "quiet", "base", "debug", "camera"];
  }

  /**
   * Where the site paths in this map start: the path a site is deployed
   * under, such as `"/my-repo/"` for a GitHub Pages project site. Reflects the
   * `base` attribute; `null` when unset.
   *
   * @remarks
   * With a base, every path to a file of your own — the `src` attribute and,
   * inside the document, source `url`/`tiles`/`data`, `images:`, marker
   * `icon:`, `mapStyle` and popup links — resolves against it:
   * `/data/x.geojson` and `data/x.geojson` both load
   * `/my-repo/data/x.geojson`, on every page of the site. A path that already
   * starts with the base is used as written, and full URLs (`https://…`,
   * `//cdn…`, `blob:`, `data:`) are never changed. Without a base, relative
   * paths resolve against the page and `/…` against the domain root, as
   * before. The Astro components set it from `import.meta.env.BASE_URL`.
   * Changing it re-renders the map.
   */
  get base(): string | null {
    return this.getAttribute("base");
  }

  set base(value: string | null) {
    if (value === null || value === undefined) this.removeAttribute("base");
    else this.setAttribute("base", String(value));
  }

  /**
   * Whether on-page notices for NON-fatal problems are suppressed — the
   * "part of this map couldn't load" notice and the zero-height hint. Reflects
   * the boolean `quiet` attribute.
   *
   * @remarks
   * For a production page that would rather fail quietly than show authors'
   * diagnostics to visitors. The problems are still logged to the console
   * and still dispatched as events. The error card for a document that
   * cannot render at all is never suppressed — it replaces a map that is not
   * there.
   */
  get quiet(): boolean {
    return this.hasAttribute("quiet");
  }

  set quiet(value: boolean) {
    this.toggleAttribute("quiet", Boolean(value));
  }

  /**
   * Whether author hints show on the page wherever it is served. Reflects the
   * boolean `debug` attribute.
   *
   * @remarks
   * The on-page notice always lists failures (a data file that didn't load,
   * a layer MapLibre rejected). Author hints — did-you-mean suggestions, a
   * key nested under `config:`, a `fitTo` typo, coordinates that look
   * swapped, a string starting with the reserved `=` — show only while you
   * develop: on a page served from this computer (`localhost` and
   * `*.localhost`, `127.x`, `[::1]`, a dev server bound to every interface
   * opened at `0.0.0.0` or `[::]`, `file:`) and in a bundler dev build
   * (`astro dev`, `vite`).
   * `debug` shows them on a published site too, for checking a deploy.
   * `quiet` still wins: it hides the notice entirely. The console always
   * gets every hint either way.
   */
  get debug(): boolean {
    return this.hasAttribute("debug");
  }

  set debug(value: boolean) {
    this.toggleAttribute("debug", Boolean(value));
  }

  /**
   * Who owns the camera when the document changes (live documents, KTD13).
   * Reflects the `camera` attribute: `document` (the default) or `host`.
   *
   * @remarks
   * `document`: a changed `center`, `zoom`, `bearing` or `pitch` eases the
   * map there, an added or re-targeted `fitTo` frames its source once, and a
   * basemap change rebuilds at the current camera unless the document's
   * camera changed. `host`: an update never moves the camera and a rebuild
   * always keeps the current one — for a page whose viewport is per-user.
   * Hosts that want the document camera re-applied on every update do it
   * themselves on `ml-map:update-applied`.
   */
  get camera(): MLMapCameraOwner {
    return this.getAttribute("camera") === "host" ? "host" : "document";
  }

  set camera(value: MLMapCameraOwner) {
    if (value === "host") this.setAttribute("camera", "host");
    else this.removeAttribute("camera");
  }

  /**
   * Get the current map configuration
   *
   * @remarks
   * While document text is being read (a TOML document waits for its
   * reader), this is still the last document applied; text assigned before
   * the element connects reads as `null` until it has been read.
   */
  get config(): MapBlock | null {
    return this._config;
  }

  /**
   * Set the map configuration programmatically.
   *
   * @remarks
   * Accepts a `MapBlock` object or document text in YAML, JSON or TOML;
   * both are validated like every other config path, whether assigned
   * before or after the element connects. Text reads with positions, and a
   * duplicate JSON key is an error. Assigning a value that is JSON-equal to
   * the config currently applied, or the same text again, is a no-op, so a
   * framework re-binding an equal object does not touch the map. A different document is applied to the running map in
   * place (live documents, 0.10): the camera stays unless the document's
   * camera changed, `getMap()` keeps its identity, and `ml-map:update-applied`
   * reports what changed; a document that fails validation is refused with
   * `ml-map:update-rejected` and the map untouched; a `mapStyle` change
   * rebuilds the map at the current camera. Assigning `null` clears the
   * stored config without touching a rendered map.
   */
  set config(value: MapBlock | string | null) {
    const text = typeof value === "string" ? value : null;
    // Before connect: store the candidate; initialize() validates it.
    if (!this.initialized || value === null) {
      this._config = typeof value === "string" ? null : value;
      this.textBeforeConnect = text;
      if (value === null) this.appliedConfigKey = null;
      return;
    }

    if (text !== null) {
      const routed = this.readText(text);
      if (routed) this.lastUpdate = routed.then((r) => r.outcome);
      return;
    }

    this.cancelEmptyConfigCheck();
    const key = configKey(value);
    if (key !== null && key === this.appliedConfigKey) return;

    this.applyValidatedConfig(value, key);
  }

  /**
   * Read document text from the `config` attribute or property, or
   * `update()` (KTD3): any format, through the front door. The same text as
   * the last handed in is a no-op, checked before anything is awaited, so a
   * re-render passing the same string reads nothing; while that text is
   * still being read, its outcome is shared. `force` (reload) reads anyway.
   */
  private readText(text: string, hints: DiffHints = NO_HINTS, force = false): Promise<Routed> | null {
    if (!force && text === this.appliedConfigKey) return this.pendingText?.text === text ? this.pendingText.routed : null;
    this.appliedConfigKey = text;
    const pending = { text, routed: this.ingest(() => ({ text, signals: {} }), hints) };
    this.pendingText = pending;
    void pending.routed.then(() => {
      if (this.pendingText === pending) this.pendingText = null;
    });
    return pending.routed;
  }

  /**
   * Validate a config object, then render it or show the error card.
   *
   * @remarks
   * The shared tail for the non-YAML entry points, so a JSON attribute and a
   * programmatic assignment get the same errors, unknown-key suggestions and
   * deprecation warnings the YAML paths have always produced.
   */
  private applyValidatedConfig(
    candidate: unknown,
    key: string | null = configKey(candidate)
  ): void {
    // A newer document than any read still in flight (KTD8).
    ++this.generation;
    this.appliedConfigKey = key;
    this.documentUrl = null;
    const result = YAMLParser.safeParseMapBlockValue(candidate);

    // Advisory, never in the error card (decision D11) — same as YAML.
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this.renderDocument(result.data);
    } else {
      this.documentFailed(result.errors);
    }
  }

  /**
   * Called when the element is added to the DOM
   */
  connectedCallback(): void {
    // A `config` assigned while the tag was still undefined (before the
    // element class was registered) is an own data property that shadows the
    // accessor and would be silently ignored. Re-route it through the setter
    // (the standard custom-element `_upgradeProperty` pattern).
    this.upgradeProperty("base");
    this.upgradeProperty("camera");
    this.upgradeProperty("config");

    // Create internal map container
    this.mapContainer = this.createMapContainer();

    // Ensure the component has display: block (custom elements default to inline)
    if (!this.style.display || this.style.display === "inline") {
      this.style.display = "block";
    }

    // A quiet "Loading map…" if the map takes a while (ml-aot.121).
    this.loading.start();

    // Initialize configuration loading
    this.initialize();
  }

  /**
   * Re-apply an own property set on the element before it was upgraded, so
   * it reaches the class accessor instead of shadowing it.
   */
  private upgradeProperty(name: "config" | "base" | "camera"): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const self = this as unknown as Record<string, unknown>;
      const value = self[name];
      delete self[name];
      self[name] = value;
    }
  }

  /**
   * Called when the element is removed from the DOM
   */
  disconnectedCallback(): void {
    this.destroy();
  }

  /**
   * Called when an observed attribute changes
   */
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    // Skip if value hasn't actually changed
    if (oldValue === newValue) return;

    if (name === "quiet") {
      if (newValue !== null) {
        this.notice?.clear();
        this.removeHeightHint();
      } else {
        this.rebuildNotice();
      }
      return;
    }

    if (name === "debug") {
      // Which hints may show changed (ml-aot.57): rebuild from what was reported.
      this.rebuildNotice();
      return;
    }

    if (name === "camera") {
      // From the next update on (KTD13); the next map is built with it.
      this.renderer?.setCameraOwner(this.camera);
      this.swap?.renderer.setCameraOwner(this.camera);
      return;
    }

    // Only process changes after initialization
    if (!this.initialized) return;

    if (name === "base") {
      // Every URL in the document may move: re-fetch `src` (its own path
      // depends on the base) or apply the document already loaded again,
      // with every URL-bearing source counted as changed (KTD11).
      if (normalizeDocumentBase(oldValue) === normalizeDocumentBase(newValue)) return;
      const hints: DiffHints = { failedSources: new Set(), urlsRebased: true, reload: true };
      const src = this.getAttribute("src");
      // During a swap, the document the swap is building (not the one it replaces): applied again once the new map is up.
      const current = this.swap?.mapBlock ?? this._config;
      // Without `src` no new document arrives, so a read in flight is not
      // superseded: it applies against the new base when it lands.
      if (src) void this.loadFromURL(src, hints);
      else if (current && (this.renderer || this.swap)) this.renderDocument(current, hints);
      return;
    }

    if (name === "src" && newValue) {
      void this.loadFromURL(newValue);
    } else if (name === "config" && newValue) {
      this.readText(newValue);
    }
  }

  /**
   * Initialize the component by detecting and loading configuration
   */
  private async initialize(): Promise<void> {
    this.initialized = true;

    // Priority 1: Programmatically set config property. Frameworks that set
    // properties at creation (React 19, Vue, Svelte) land here, so it is
    // validated and defaulted exactly like the attribute and YAML paths
    // (ml-jh6), never handed to the renderer raw.
    const text = this.textBeforeConnect;
    if (text !== null) {
      this.textBeforeConnect = null;
      this.readText(text);
      return;
    }
    if (this._config) {
      this.applyValidatedConfig(this._config);
      return;
    }

    // Priority 2: an inline document script (YAML, JSON or TOML, ml-4cn.2)
    const script = findDocumentScript(this);
    if (script?.textContent) {
      void this.loadFromScript(script);
      return;
    }

    // Priority 3: External document file
    const srcAttr = this.getAttribute("src");
    if (srcAttr) {
      await this.loadFromURL(srcAttr);
      return;
    }

    // Priority 4: the config attribute (document text in any format)
    const configAttr = this.getAttribute("config");
    if (configAttr) {
      this.readText(configAttr);
      return;
    }

    // No configuration yet. A `config` property may still be on its way
    // (ml-mpm); the setter cancels the check. A mapReady() called meanwhile
    // simply waits.
    this.scheduleEmptyConfigCheck();
  }

  /**
   * Report "No configuration provided" only if no config arrived by the end
   * of the next frame.
   *
   * @remarks
   * An element can connect empty and receive `.config` moments later: a
   * module script assigns it right after importing `register` (which upgrades
   * the element synchronously), and React 18 can only assign it from an
   * effect, which runs after the browser paints. A plain `setTimeout(0)`
   * loses that race in practice (measured: the effect landed after it), so
   * the check waits for the next animation frame and then one more task. A
   * background tab runs no frames, so a 500 ms timer bounds the wait there.
   */
  private scheduleEmptyConfigCheck(): void {
    this.cancelEmptyConfigCheck();

    const run = () => {
      this.cancelEmptyConfigCheck();
      if (!this.initialized || this._config || this.renderer) return;
      this.handleError([{ path: "", message: noDocumentMessage(this, false, "No configuration provided.") }], true);
    };

    let frame: number | undefined;
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        afterFrame = setTimeout(run, 0);
      });
      fallback = setTimeout(run, 500);
    } else {
      afterFrame = setTimeout(run, 0);
    }

    this.cancelPendingEmptyCheck = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(afterFrame);
      clearTimeout(fallback);
      this.cancelPendingEmptyCheck = null;
    };
  }

  private cancelEmptyConfigCheck(): void {
    this.cancelPendingEmptyCheck?.();
  }

  /**
   * The one way a document read from text comes in (KTD8): an inline
   * script, `src`, the `config` attribute or property, `update()` and
   * `reload()`. It bumps the generation before anything is awaited and
   * cancels the empty-document check, so neither a slow fetch nor the TOML
   * reader's download lets an older document land over a newer one, or "No
   * configuration provided" show meanwhile. YAML and JSON text is read and
   * routed in the same turn. `load` reports its own failures (a `src` that
   * didn't load) and gives `null`.
   */
  private ingest(
    load: (stale: () => boolean) => DocumentText | null | Promise<DocumentText | null>,
    hints: DiffHints
  ): Promise<Routed> {
    const generation = ++this.generation;
    this.cancelEmptyConfigCheck();
    const stale = () => generation !== this.generation || !this.initialized;
    return Promise.resolve(
      after(load(stale), (doc) => {
        if (stale()) return SUPERSEDED;
        if (!doc) return { outcome: this.lastUpdate! };
        return after(readDocument(doc, "map"), (read): Routed => {
          if (stale()) return SUPERSEDED;
          if ("chunk" in read) {
            // The reader may download next time: the same text must be read again.
            this.appliedConfigKey = null;
            const card = tomlReaderCard(read.chunk);
            this.documentFailed(card.errors, "chunk", card);
          } else {
            this.documentUrl = doc.url ?? null;
            // Warnings are advisory (unknown keys, deprecations, expression hints):
            // surface them on the console, never in the error card (per decision D11).
            this.logWarnings(read.warnings);
            if (read.success && read.data) this.renderDocument(read.data, hints);
            else this.documentFailed(read.errors);
          }
          return { outcome: this.lastUpdate! };
        });
      })
    );
  }

  /** Read the document in an inline script, its `type` naming the format. */
  private loadFromScript(script: HTMLScriptElement, hints: DiffHints = NO_HINTS): Promise<Routed> {
    this.appliedConfigKey = null;
    const doc = { text: script.textContent ?? "", signals: { scriptType: script.getAttribute("type") } };
    return this.ingest(() => doc, hints);
  }

  /**
   * Fetch and read the document at `src`.
   *
   * @remarks
   * Each way a fetch fails gets its own actionable card (ml-aot.13): a page
   * opened from disk (`file://`, where browsers refuse the request) says to
   * serve the folder; an HTTP error and an HTML page (what an SPA-fallback
   * server returns for a wrong path, with status 200) both show the URL the
   * browser actually requested, since a path resolved against the wrong
   * folder is the usual cause. On a running map none of those replace it
   * (KTD12): the document is refused with `ml-map:update-rejected`
   * (`kind: "fetch"`) and a dev-only hint, and the map stays.
   */
  private loadFromURL(url: string, hints: DiffHints = NO_HINTS): Promise<Routed> {
    this.appliedConfigKey = null;
    return this.ingest(async (stale) => {
      this.dispatchEvent(new CustomEvent("ml-map:loading", { bubbles: true, detail: { url } }));
      const got = await fetchDocument(url, this.base, this.ownerDocument);
      if (!("failed" in got)) return got;
      if (!stale()) this.fetchFailed(url, got.resolved, got.reason, got.failed);
      return null;
    }, hints);
  }

  /** A `src` that didn't load: the card with no map to keep, a rejection otherwise (KTD12). */
  private fetchFailed(src: string, resolved: string, reason: string, card: ErrorCardContent): void {
    if (!this.renderer && !this.swap) {
      this.lastUpdate = Promise.resolve({ outcome: "rejected", errors: toUpdateErrors("fetch", card.errors) });
      this.showFailure(card);
      return;
    }
    const message = card.errors[0]?.message ?? reason;
    this.lastUpdate = Promise.resolve(
      this.rejectUpdate("fetch", [{ kind: "fetch", message }], describeFetchRejection(src, resolved, reason))
    );
  }

  /**
   * A document that failed to parse or validate: on a running map it is
   * refused and the map kept (R2, KTD9); with no map, the error card as
   * before.
   */
  private documentFailed(
    errors: ParseError[],
    kind: RejectionKind = "validation",
    card: { title?: string; hint?: string } = {}
  ): void {
    const rejection = toUpdateErrors(kind, errors);
    if (this.renderer || this.swap) {
      this.lastUpdate = Promise.resolve(this.rejectUpdate(kind, rejection, describeRejectedUpdate(errors)));
      return;
    }
    this.lastUpdate = Promise.resolve({ outcome: "rejected", errors: rejection });
    this.handleError(errors, card);
  }

  /** The standalone element's one hard requirement beyond the schema: a basemap. */
  private basemapMissing(mapBlock: MapBlock): ParseError[] | null {
    // Standalone <ml-map> has no global config to inherit defaultMapStyle from,
    // so a missing basemap would die inside MapLibre with an opaque error.
    // Surface a friendly error instead. (Schema keeps it optional because
    // the Astro builders legitimately resolve it from globalConfig.) The base
    // style is `config.mapStyle` in v1 and `style.basemap` in v2, so the guard
    // reads whichever the document's version puts it under.
    const isV2 = (mapBlock as { version?: number }).version === 2;
    const basemap = isV2
      ? (mapBlock as unknown as { style?: { basemap?: unknown } }).style?.basemap
      : mapBlock.config?.mapStyle;
    if (basemap) return null;
    const path = isV2 ? "style.basemap" : "config.mapStyle";
    const key = isV2 ? "basemap" : "mapStyle";
    const where = isV2 ? "your style:" : "your config";
    return [
      {
        path,
        message:
          `${key} is required for standalone maps. Add it to ${where}, for example: ` +
          `${key}: "https://demotiles.maplibre.org/style.json" ` +
          "(inheriting a defaultMapStyle is a feature of the Astro builders, not the standalone <ml-map> element).",
      },
    ];
  }

  /**
   * Route a validated document (live documents, 0.10): to the running map
   * as an update, after a swap in flight (last wins), or — with no running
   * map: the first render, an error card, a construction still waiting for
   * DOM-ready — rendered fresh, as before.
   */
  private renderDocument(mapBlock: MapBlock, hints: DiffHints = NO_HINTS): void {
    if (this.swap) {
      // At most two maps alive (KTD8): the document waits for the swap.
      this.queuedDocument?.resolve({ outcome: "superseded" });
      this.lastUpdate = new Promise((resolve) => {
        this.queuedDocument = { mapBlock, hints, resolve };
      });
      return;
    }
    const renderer = this.renderer;
    if (renderer) {
      this.lastUpdate = this.updateDocument(renderer, mapBlock, hints);
      return;
    }
    this._config = mapBlock;
    this.lastUpdate = this.whenRendered();
    this.renderMap(mapBlock);
  }

  /** {@link update}'s outcome for a document rendered fresh: a map was built (a rebuild), or the error card. */
  private whenRendered(): Promise<UpdateResult> {
    return new Promise((resolve) => {
      const onLoad = () => {
        cleanup();
        resolve({ outcome: "fallback", summary: emptySummary(true) });
      };
      const onError = (event: Event) => {
        const detail = (event as CustomEvent<MLMapErrorDetail>).detail;
        if (detail?.fatal === false) return;
        cleanup();
        const errors = detail?.errors ?? [{ path: "", message: detail?.error?.message ?? "failed to load" }];
        resolve({ outcome: "rejected", errors: toUpdateErrors("validation", errors) });
      };
      const cleanup = () => {
        this.removeEventListener("ml-map:load", onLoad);
        this.removeEventListener("ml-map:error", onError);
      };
      this.addEventListener("ml-map:load", onLoad);
      this.addEventListener("ml-map:error", onError);
    });
  }

  /**
   * Apply a document to the running map (R1): normalized the way the map was
   * built, classified for a rebuild before anything is awaited (KTD7), and
   * otherwise handed to `renderer.update()`, whose outcome becomes
   * `ml-map:update-applied` or `ml-map:update-rejected`.
   */
  private async updateDocument(renderer: MapRenderer, mapBlock: MapBlock, hints: DiffHints): Promise<UpdateResult> {
    const missing = this.basemapMissing(mapBlock);
    if (missing) return this.rejectUpdate("validation", toUpdateErrors("validation", missing), describeRejectedUpdate(missing));
    let model: MapModel;
    try {
      model = applyDocumentBase(toModel(mapBlock as never), this.base);
    } catch (error) {
      const errors = [{ path: "", message: `Failed to read the document: ${error instanceof Error ? error.message : String(error)}` }];
      return this.rejectUpdate("validation", toUpdateErrors("validation", errors), describeRejectedUpdate(errors));
    }
    const next = toApplied(model);
    this.clearRejectionHint();
    // A basemap change or a constructor-only option: the two-map rebuild (KTD8).
    if (needsRebuild(renderer.getDocument().config, next.config)) return this.startRebuild(renderer, mapBlock, model, next);

    this.rollback ??= { config: this._config, effects: this.effectsModel };
    this._config = mapBlock;
    this.strings = createStrings(documentLocale(mapBlock));
    // An update's effects re-attach reads the next document's effect refs.
    this.effectsModel = model;
    // The notice as it is now: what the update itself reports is newer (see settleNotices).
    const before = new Set(this.noticeEntries);
    const result = await renderer.update(next, hints);
    if (this.renderer !== renderer) return result;
    // Whether this call's write is still the current one: a later update may have taken over (KTD5).
    const current = this._config === mapBlock;
    if (result.outcome === "applied") {
      // `ml-map:update-applied` was forwarded from the renderer's own event,
      // which fires only when something changed (R8: an equal document is
      // a no-op on every path, whether or not the element held its key).
      this.rollback = current ? null : { config: mapBlock, effects: model };
      if (result.summary) this.settleNotices(result.summary, before);
      this.withdrawNotices("document");
      for (const message of this.documentNotices) this.reportProblem(message, { kind: "hint", about: "document" });
    } else if (result.outcome === "rejected") {
      if (current && this.rollback) {
        this._config = this.rollback.config;
        this.effectsModel = this.rollback.effects;
        this.rollback = null;
      }
      const errors = result.errors ?? [];
      this.rejectUpdate(errors[0]?.kind ?? "chunk", errors, describeRejectedUpdate(errors));
    }
    return result;
  }

  /**
   * Refuse a document and keep the map (R2): the dev-only hint on the map,
   * `ml-map:update-rejected` for the host. The refused document does not
   * count as applied, so assigning it again tries again.
   */
  private rejectUpdate(kind: RejectionKind, errors: NonNullable<UpdateResult["errors"]>, hint: string): UpdateResult {
    this.appliedConfigKey = null;
    this.clearRejectionHint();
    this.rejectionHint = hint;
    this.reportProblem(hint, { kind: "hint" });
    this.dispatchEvent(
      new CustomEvent("ml-map:update-rejected", {
        bubbles: true,
        detail: { kind, errors },
      })
    );
    return { outcome: "rejected", errors };
  }

  /** Take the last rejection's hint off the notice: a later document is being applied. */
  private clearRejectionHint(): void {
    const hint = this.rejectionHint;
    if (!hint) return;
    this.rejectionHint = null;
    this.noticeEntries = this.noticeEntries.filter((entry) => entry.message !== hint);
    this.rebuildNotice();
  }

  /** Take every line about `about` off the notice: what it described was retried or replaced and succeeded. */
  private withdrawNotices(...about: string[]): void {
    this.keepNotices((entry) => !entry.about || !about.includes(entry.about));
  }

  /**
   * An update applied: the lines reported before it began about the layers
   * it added, replaced or removed, and the sources it replaced, go — what
   * the update itself reported about them (a layer that failed again) is
   * newer and stays, and a retried load's line goes when its data lands.
   */
  private settleNotices(summary: UpdateSummary, before: ReadonlySet<NoticeEntry>): void {
    const about = new Set<string>();
    for (const id of [...summary.added, ...summary.replaced, ...summary.removed]) about.add(`layer:${id}`).add(`data:${id}`);
    for (const id of summary.sourcesReplaced) about.add(`source:${id}`);
    this.keepNotices((entry) => !(entry.about && about.has(entry.about) && before.has(entry)));
  }

  private keepNotices(keep: (entry: NoticeEntry) => boolean): void {
    const kept = this.noticeEntries.filter(keep);
    if (kept.length === this.noticeEntries.length) return;
    this.noticeEntries = kept;
    this.rebuildNotice();
  }

  /**
   * The fallback rebuild (KTD8): the next map is built off the page while
   * the old one keeps showing, seeded with the old map's camera (unless the
   * document's camera changed and the document owns it) and the reader's
   * state and visibility; it takes the old map's place when it loads
   * ({@link commitSwap}) and is dropped when it never does
   * ({@link failSwap}). Everything here runs in the same turn as the
   * assignment: a `mapReady()` called right after waits for the new map.
   */
  private startRebuild(old: MapRenderer, mapBlock: MapBlock, model: MapModel, next: AppliedDocument): Promise<UpdateResult> {
    return new Promise<UpdateResult>((resolve) => {
      const wasLoaded = this.documentLoaded;
      this.documentLoaded = false;
      this.lastError = null;
      // No second set of fetches while the next map loads its own. Slot
      // children stay in the old map's chrome: the next renderer collects
      // them from there and moves them only when it loads (commit time).
      old.pause();
      const keepCamera = this.camera === "host" || !cameraChanged(old.getDocument().config, next.config);
      const block = mapBlock as { config?: { mapStyle?: unknown }; style?: { basemap?: unknown } };
      prefetchProtomapsBasemap(block.config?.mapStyle ?? block.style?.basemap);
      const container = this.createMapContainer();
      let renderer: MapRenderer;
      try {
        renderer = this.buildRenderer(mapBlock, container, null, {
          camera: this.camera,
          ...old.rebuildSeed(),
          ...(keepCamera ? { initialCamera: currentCamera(old.getMap()) } : {}),
        }, true).renderer;
      } catch (error) {
        this.documentLoaded = wasLoaded;
        old.resume();
        const errors = [{ path: "", message: `Failed to create map: ${error instanceof Error ? error.message : String(error)}` }];
        resolve(this.rejectUpdate("validation", toUpdateErrors("validation", errors), describeRejectedUpdate(errors)));
        return;
      }
      this.swap = { renderer, container, mapBlock, model, keepCamera, wasLoaded, failed: false, notices: [], resolve };
    });
  }

  /** The next map loaded: the old one is torn down and the new one takes its place, at the old map's current camera. */
  private commitSwap(swap: PendingSwap): void {
    this.swap = null;
    const { renderer, container, mapBlock, model } = swap;
    const oldMap = this.renderer?.getMap();
    // The camera as it is NOW: the reader may have moved it while the new map loaded.
    if (swap.keepCamera && oldMap) renderer.getMap().jumpTo(currentCamera(oldMap));
    this.teardownRenderer();
    this.removeErrorCards();
    this.mapContainer?.remove();
    this.mapContainer = container;
    this.appendChild(container);
    this.renderer = renderer;
    this._config = mapBlock;
    this.effectsModel = model;
    this.rollback = null;
    this.strings = createStrings(documentLocale(mapBlock));
    for (const message of this.documentNotices) this.reportProblem(message, { kind: "hint", about: "document" });
    // What the new map reported while it loaded, now that it is the one showing.
    for (const line of swap.notices) this.reportProblem(...line);
    // The slot children, parked by the teardown, go into the new map's corners now (KTD8).
    renderer.mountHostChrome();
    // Built off the page, at no size: measure now.
    renderer.getMap().resize();
  }

  /** The next map never loads (its basemap, its worker): it is dropped, the old map stays, the queue releases. */
  private failSwap(swap: PendingSwap, error: Error, context: MapErrorContext | undefined): void {
    if (swap.failed) return;
    swap.failed = true;
    this.swap = null;
    // What a reader wrote on the map that never loaded lands on the one that stays (KTD8).
    const written = this.pendingStateWrites(swap);
    if (Object.keys(written).length) {
      try {
        this.renderer?.setState(written);
      } catch {
        // Below the state floor (maplibre-gl < 5.6): nothing to carry.
      }
    }
    // Out of MapLibre's event dispatch before tearing its map down.
    setTimeout(() => swap.renderer.destroy(), 0);
    this.documentLoaded = swap.wasLoaded;
    // The old map stays: its pipelines run again.
    this.renderer?.resume();
    const isV2 = (swap.mapBlock as { version?: number }).version === 2;
    const key = isV2 ? "style.basemap" : "config.mapStyle";
    const url = context?.kind === "style" ? context.url : undefined;
    swap.resolve(
      this.rejectUpdate("style", [{ kind: "style", message: error.message }], describeStyleRejection(key, url, error.message))
    );
    this.drainQueued();
  }

  /** The `state:` values a reader wrote on a swap's next map (`setState` routes there), as far as the old document declares them. */
  private pendingStateWrites(swap: PendingSwap): Record<string, unknown> {
    const declared = this.renderer?.getDocument().options.state ?? {};
    return Object.fromEntries(Object.entries(swap.renderer.rebuildSeed().initialState).filter(([key]) => key in declared));
  }

  /**
   * A swap that will not complete: drop the next map. Both callers (the
   * element leaving the page, the error card) tear the old renderer down
   * right after, so its paused pipelines are not resumed here.
   */
  private abandonSwap(): void {
    const swap = this.swap;
    this.swap = null;
    if (swap) {
      swap.failed = true;
      swap.renderer.destroy();
      swap.resolve({ outcome: "superseded" });
    }
    this.queuedDocument?.resolve({ outcome: "superseded" });
    this.queuedDocument = null;
  }

  /** The document that waited for the swap, if any, goes next. */
  private drainQueued(): void {
    const queued = this.queuedDocument;
    if (!queued) return;
    this.queuedDocument = null;
    this.renderDocument(queued.mapBlock, queued.hints);
    queued.resolve(this.lastUpdate ?? { outcome: "superseded" });
  }

  /**
   * Render the map with the given configuration
   */
  private renderMap(mapBlock: MapBlock): void {
    // The document's own words for the library's UI (its `locale:`), for
    // everything this render puts on the page: notices, error cards, hints.
    this.strings = createStrings(documentLocale(mapBlock));

    const missing = this.basemapMissing(mapBlock);
    if (missing) {
      this.handleError(missing);
      return;
    }

    // Destroy existing renderer (slot children parked first — the renderer
    // only borrows them, and its teardown removes their corner containers).
    this.teardownRenderer();
    // The teardown cleared the notice; this document's on-page warnings
    // (logged as it was parsed, just before) go back on it.
    for (const message of this.documentNotices) this.reportProblem(message, { kind: "hint", about: "document" });

    // A fresh render resets the readiness state a pending or future
    // mapReady() reads.
    this.documentLoaded = false;
    this.lastError = null;

    // Targeted teardown (KTD9): remove only what this element owns — a
    // previous error card — never author children (the inline YAML script a
    // later reload() re-reads, slot children, anything else).
    this.removeErrorCards();

    if (!this.mapContainer) {
      this.mapContainer = this.createMapContainer();
    }

    this.appendChild(this.mapContainer);

    // A Protomaps basemap (`mapStyle: { pmtiles: … }`, ml-cnv.7): its style
    // generator and the PMTiles reader are on-demand chunks on the path to
    // the first frame, so their download starts as soon as the document is
    // known, before the DOM-ready wait below.
    const block = mapBlock as { config?: { mapStyle?: unknown }; style?: { basemap?: unknown } };
    prefetchProtomapsBasemap(block.config?.mapStyle ?? block.style?.basemap);

    // `fitTo` on a fetched source (ml-aot.75): start loading its data NOW,
    // alongside the rest of page start-up, so the map can be built already
    // framed on it instead of loading at center/zoom and jumping.
    let prefetch: FitPrefetch | null = null;
    if (MLMap.fitToWaitMs > 0) {
      try {
        prefetch = startFitPrefetch(applyDocumentBase(toModel(mapBlock as never), this.base));
      } catch {
        prefetch = null; // constructRenderer reports a document it cannot model
      }
    }

    // Never build the MapLibre map while the page's module scripts are still
    // evaluating (ml-aot.2). A bundler can hoist `register` ahead of the code
    // that sets maplibre-gl 6's worker URL (side-effect order is not kept
    // across shared chunks), and a map constructed in that window spawns its
    // workers from the wrong URL: "Worker failed to load", a blank map. Every
    // deferred and module script has run by DOMContentLoaded, so wait for it
    // when it is still ahead; otherwise (elements created later, frameworks,
    // maplibre-gl 4/5) this is the same synchronous path as before.
    const doc = this.ownerDocument;
    const scriptsPending = pageScriptsPending(doc);
    if (!prefetch) {
      if (!scriptsPending) {
        this.constructRenderer(mapBlock);
        return;
      }
      const resume = () => {
        this.cancelDeferredRender = null;
        if (this.initialized && this.isConnected) this.constructRenderer(mapBlock);
      };
      doc.addEventListener("DOMContentLoaded", resume, { once: true });
      this.cancelDeferredRender = () => {
        doc.removeEventListener("DOMContentLoaded", resume);
        this.cancelDeferredRender = null;
      };
      return;
    }

    // Wait for whichever applies: the page's scripts, and the fitTo data —
    // the latter at most `fitToWaitMs`, then the map is built anyway.
    let cancelled = false;
    let stopWaitingForDom: (() => void) | null = null;
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    const waits: Promise<unknown>[] = [
      Promise.race([
        prefetch.data.then(
          () => undefined,
          () => undefined
        ),
        new Promise<void>((resolve) => {
          fitTimer = setTimeout(resolve, MLMap.fitToWaitMs);
        }),
      ]),
    ];
    if (scriptsPending) {
      waits.push(
        new Promise<void>((resolve) => {
          const ready = () => resolve();
          doc.addEventListener("DOMContentLoaded", ready, { once: true });
          stopWaitingForDom = () => doc.removeEventListener("DOMContentLoaded", ready);
        })
      );
    }
    this.cancelDeferredRender = () => {
      cancelled = true;
      stopWaitingForDom?.();
      clearTimeout(fitTimer);
      this.cancelDeferredRender = null;
    };
    void Promise.all(waits).then(() => {
      clearTimeout(fitTimer);
      if (cancelled) return;
      this.cancelDeferredRender = null;
      if (this.initialized && this.isConnected) this.constructRenderer(mapBlock, prefetch);
    });
  }

  /**
   * Build the MapRenderer for a validated document into the (already
   * attached) map container and make it the element's. Split from
   * {@link renderMap} so the DOM-ready deferral can run it later.
   */
  private constructRenderer(mapBlock: MapBlock, prefetch: FitPrefetch | null = null): void {
    if (!this.mapContainer) return;
    try {
      const { renderer, model } = this.buildRenderer(mapBlock, this.mapContainer, prefetch, {}, false);
      this.renderer = renderer;
      this.effectsModel = model;

      // Surface the classic silent-blank-map failure modes on the console.
      this.checkEnvironment();
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Failed to create map: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Construct a MapRenderer for a validated document into `container`, with
   * its events forwarded and its effects set up — without tearing anything
   * down or touching the element's own renderer (KTD8): the first render
   * attaches the result at once; a fallback rebuild keeps it off the page
   * until it loads.
   *
   * @param extra - Renderer options beyond the document's: the camera owner
   *   and, for a rebuild, the previous map's camera, state and visibility.
   * @param swapping - Built for a swap: no loading indicator over the old map.
   * @throws When the document cannot be modelled or MapLibre refuses to construct.
   */
  private buildRenderer(
    mapBlock: MapBlock,
    container: HTMLDivElement,
    prefetch: FitPrefetch | null,
    extra: Partial<MapRendererOptions>,
    swapping: boolean
  ): { renderer: MapRenderer; model: MapModel } {
    const slots = this.collectSlots();
    const isV2 = (mapBlock as { version?: number }).version === 2;

    // Normalize the v1 document into the v2 internal model, then render from
    // it. The model is what the emitter is written against (R30); routing the
    // production path through it here is what proves the normalization loses
    // nothing — every component and renderer test now exercises the round
    // trip, so a dropped or invented key fails the suite rather than shipping.
    // `base` (GitHub Pages project sites) resolves every URL in the
    // document in one pass, before anything fetches (ml-aot.30).
    const model = applyDocumentBase(toModel(mapBlock as never), this.base);

    // The fitTo prefetch (ml-aot.75). Data that arrived in time rides in as
    // the source's `prefetchedData`, so the renderer builds the map framed
    // on it; data still on its way is handed over as the pending load, so
    // the source awaits it (one request) and the map fits when it lands.
    let sources = denormalizeSources(model);
    let sourceData: MapRendererOptions["sourceData"];
    // A COG's extent read ahead (ml-aot.120): no data to hand over.
    const prefetchedExtents = prefetch?.extent ? { [prefetch.sourceId]: prefetch.extent } : undefined;
    if (prefetch && !isCogFitSource(sources?.[prefetch.sourceId]) && sources?.[prefetch.sourceId]) {
      sourceData = {
        fetcher: prefetch.fetcher,
        pending: { [prefetch.sourceId]: prefetch.data },
      };
      if (prefetch.result && "data" in prefetch.result) {
        sources = {
          ...sources,
          [prefetch.sourceId]: {
            ...sources[prefetch.sourceId],
            prefetchedData: prefetch.result.data,
          } as (typeof sources)[string],
        };
      }
    }

    const renderer: MapRenderer = new MapRenderer(
      container,
      denormalizeConfig(model),
      denormalizeLayers(model),
      {
        ...denormalizeOptions(model),
        chrome: slots.chrome,
        legendElement: slots.legendElement,
        ...(sourceData ? { sourceData } : {}),
        ...(prefetchedExtents ? { prefetchedExtents } : {}),
        camera: this.camera,
        // A swap's map mounts the slot children when it is shown (KTD8).
        ...(swapping ? { deferChrome: true } : {}),
        ...extra,
        // An update that adds, removes, rebuilds or moves an `effect:`
        // layer (live documents, KTD6b): detach, then attach again from
        // the document the effects were last set up from.
        onReattachEffects: () => this.reattachEffects(),
      onLoad: () => {
        // Load event is also emitted via the event system
      },
      onError: (error, fatal, context) => {
        // The next map of a fallback rebuild (KTD8), or a map already
        // replaced or abandoned, which has nothing more to say. What the
        // next map reports goes on the notice once it is the one showing.
        const pending = this.swap?.renderer === renderer ? this.swap : null;
        if (!pending && this.renderer !== renderer) return;
        const report = (line: NoticeLine | undefined) => {
          if (!line) return;
          if (pending) pending.notices.push(line);
          else this.reportProblem(...line);
        };
        // An author hint, not a map error: the renderer warned on the console; on the map too.
        const hint = hintLine(error, context);
        if (hint) {
          report(hint);
          return;
        }
        // Loud by default: with no `ml-map:error` listener attached, a
        // dispatched event is invisible and the document fails silently
        // (ml-tfd.8 contract audit). Hosts still get the event.
        // A basemap notice was already logged by the renderer, as a warning
        // in plain words: once is enough (ml-aot.125).
        if (context?.kind !== "basemap") console.error("[maplibre-yaml] map error:", error);
        // MapLibre reports a worker that could not start as a runtime
        // error, but the map can never load without one: treat it as
        // terminal and put it on the page, not only on the console — a
        // student otherwise sees an empty box (ml-aot.2).
        const workerFailure = /worker failed to load/i.test(error.message);
        const terminal = fatal !== false || workerFailure;
        if (pending) {
          // Never fatal to the element and never the card: the old map
          // is still there. A failure that aborts the new map's load
          // fails the swap (`kind: "style"`) and keeps the old map.
          this.dispatchEvent(
            new CustomEvent("ml-map:error", {
              bubbles: true,
              detail: { error, fatal: false },
            })
          );
          if (terminal) this.failSwap(pending, error, context);
          else report(this.problemLine(error, context));
          return;
        }
        // Only load-aborting failures are terminal for mapReady();
        // runtime maplibre errors (a 404'd tile) precede a successful
        // load all the time and must not poison readiness.
        if (terminal) this.lastError = error;
        this.dispatchEvent(
          new CustomEvent("ml-map:error", {
            bubbles: true,
            detail: { error, fatal: terminal },
          })
        );
        if (workerFailure) {
          // Out of MapLibre's event dispatch before tearing its map down;
          // once only, however many workers in the pool report it. A page
          // opened from disk is the classroom cause, and the bundler
          // advice in the message would send a student the wrong way
          // (ml-aot.13).
          queueMicrotask(() => {
            if (this.renderer !== renderer) return;
            if (isFilePage(this.ownerDocument)) {
              this.showContentCard(filePageWorkerCard(this.strings));
            } else {
              this.showErrorCard([{ path: "", message: error.message }], {
                title: this.strings("maplibre-yaml.ErrorCard.MapError"),
              });
            }
          });
          return;
        }
        if (context?.kind === "style") {
          this.queueStyleFailure(renderer, error, context.url, isV2);
          return;
        }
        // Part of the document failed but the map keeps working: say so
        // on the map, not only on the console (ml-aot.15).
        if (!terminal) report(this.problemLine(error, context));
      },
      },
      sources
    );

    // Set up event forwarding
    this.setupEventForwarding(renderer, swapping);

    // Experimental effects (`effect:` layers) attach once the map loads.
    this.setupEffects(model, renderer);

    return { renderer, model };
  }

  /**
   * The line for a part of the document that failed while the map keeps
   * working (ml-aot.15): a layer that didn't draw, a classified layer whose
   * classes can't be computed, the basemap's own file, a named source.
   */
  private problemLine(error: Error, context: MapErrorContext | undefined): NoticeLine | undefined {
    if (context?.kind === "layer" && context.layerId) {
      const about = `layer:${context.layerId}`;
      // A document layer whose id the page already used (KTD1): an author hint, not a draw failure.
      return context.reason === "host-layer-collision"
        ? [describeHostLayerCollision(context.layerId), { kind: "hint", about }]
        : [describeLayerProblem(context.layerId, error.message), { about }];
    }
    // The message is the whole notice (renderer/classify-runtime; a pmtiles: file that is not a Protomaps basemap, ml-cnv.7).
    if (context?.kind === "classify" || context?.kind === "basemap") return [error.message, {}];
    if (context?.kind === "source" && context.sourceId) {
      return [
        describeSourceProblem(context.sourceId, error.message, error, {
          pageUrl: this.ownerDocument.baseURI,
          base: this.base,
          ...(context.basemap ? { basemap: true } : {}),
        }),
        { about: `source:${context.sourceId}` },
      ];
    }
    return undefined;
  }

  /**
   * Log parser warnings to the console.
   *
   * @remarks
   * Warnings (unknown keys, deprecated fields, expression hints) are advisory
   * and console-only per decision D11 — they never appear in the on-map error
   * card, which is reserved for hard failures.
   */
  private logWarnings(warnings: ValidationWarning[] | undefined): void {
    this.documentNotices = [];
    if (!warnings || warnings.length === 0) return;
    for (const warning of warnings) {
      const location =
        warning.line !== undefined
          ? ` (line ${warning.line}${
              warning.column !== undefined ? `, column ${warning.column}` : ""
            })`
          : "";
      const path = displayPath(warning) ? `${displayPath(warning)}: ` : "";
      // A note explains how a valid value is read: information, not a warning.
      (warning.kind === "note" ? console.info : console.warn)(`[ml-map] ${path}${warning.message}${location}`);
      // A valid document where part of it silently does nothing (a root key
      // nested under config:): also say so on the page (ml-aot.48). Still
      // the non-fatal notice, never the error card.
      if (warning.onPage) this.documentNotices.push(`${warning.message}${location}`);
    }
  }

  /**
   * Put one line in this map's non-fatal notice. For `<ml-scrollytelling>`,
   * which reports its own document's problems on its map (ml-aot.48,
   * ml-aot.51) — author hints by default (a chapter naming a missing layer),
   * so they follow the hint rules (ml-aot.57). Respects `quiet`.
   *
   * @internal
   */
  _reportNotice(message: string, kind: NoticeKind = "hint"): void {
    this.reportProblem(message, { kind });
  }

  /**
   * Arm the two classic silent-blank-map checks, which run once the map has
   * loaded:
   *
   * 1. The map has zero height, so it is invisible ({@link checkHeight}).
   * 2. MapLibre's CSS is not loaded ({@link warnIfMapLibreCssMissing}).
   */
  private checkEnvironment(): void {
    if (typeof window === "undefined") return;

    // Run at most once per element: re-renders (config/src updates, reload())
    // must not re-emit identical warnings.
    if (this.diagnosticsRun) return;
    this.diagnosticsRun = true;

    // Both checks run on the first load (see setupEventForwarding). Not at
    // construction: under Vite dev the stylesheet that sizes the element or
    // loads MapLibre's CSS may apply after the element upgrades (ml-aot.10,
    // ml-ohh.13), and slot children still in normal flow give the host a
    // height the map does not have (ml-aot.16).
    if (this.renderer) {
      this.cssCheckPending = true;
      this.heightCheckPending = true;
    }
  }

  /**
   * Warn, and show a hint on the page, when the map has zero height — the
   * single most common "blank map" cause.
   *
   * @remarks
   * Measures the map container, not the host: the container is what MapLibre
   * draws into, and a host can have height (slot children in its flow, an
   * in-flow sibling) while the container's `height: 100%` of an auto-height
   * host is 0. Only flagged when the element is laid out — a hidden map
   * (`offsetParent === null`, an ancestor with `display: none`) legitimately
   * has zero height. The on-page hint (not under `quiet`) sits in the
   * element's own flow, so it is visible exactly when the map is not, and it
   * removes itself once the map gets a height.
   */
  private checkHeight(): void {
    const container = this.mapContainer;
    if (!container || !container.isConnected) return;
    if (this.offsetParent === null) return;
    if (container.getBoundingClientRect().height > 0) return;

    console.warn(
      "[ml-map] The <ml-map> element has zero height, so the map will " +
        "not be visible. Give it a height, for example: `ml-map { height: 400px; }`."
    );
    if (!this.quiet) this.showHeightHint();
  }

  private showHeightHint(): void {
    if (this.heightHint || !this.mapContainer) return;
    const doc = this.ownerDocument;
    const hint = doc.createElement("div");
    hint.className = "ml-map-height-hint";
    hint.setAttribute("role", "status");
    hint.style.cssText =
      "box-sizing: border-box; margin: 4px 0; padding: 10px 12px; background: #fffbeb; " +
      "color: #78350f; border: 1px solid #f59e0b; border-radius: 6px; " +
      "font: 14px/1.5 system-ui, -apple-system, sans-serif;";
    // `backticked` spans of the (translatable) message render as code.
    appendMessage(doc, hint, this.strings("maplibre-yaml.HeightHint"));
    this.appendChild(hint);
    this.heightHint = hint;

    if (typeof ResizeObserver === "function") {
      const container = this.mapContainer;
      this.heightObserver = new ResizeObserver(() => {
        if (container.getBoundingClientRect().height > 0) this.removeHeightHint();
      });
      this.heightObserver.observe(container);
    }
  }

  private removeHeightHint(): void {
    this.heightObserver?.disconnect();
    this.heightObserver = null;
    this.heightHint?.remove();
    this.heightHint = null;
  }

  /**
   * Put one non-fatal document problem on the page (unless `quiet`).
   *
   * @param options.log - also `console.error` it; for problems nothing else
   *   logs (a data file that 404'd). MapLibre errors are already logged by the
   *   renderer's `onError` handler.
   * @param options.kind - `"failure"` (default: something didn't load) always
   *   shows; `"hint"` (a did-you-mean, a misplaced key) shows only while the
   *   author is developing, per {@link showAuthorHints} (ml-aot.57).
   * @param options.about - what the line describes (see `noticeEntries`),
   *   so a successful retry or replacement withdraws it.
   */
  private reportProblem(message: string, options: NoticeOptions = {}): void {
    if (options.log) console.error(`[maplibre-yaml] ${consoleText(message)}`);
    const kind = options.kind ?? "failure";
    const entry: NoticeEntry = { message, kind, ...(options.about ? { about: options.about } : {}) };
    // Reported again (an update's layer failing as before): a fresh entry,
    // newer than the lines the update settles (`settleNotices`).
    const at = this.noticeEntries.findIndex((e) => e.message === message);
    if (at >= 0) this.noticeEntries[at] = entry;
    else this.noticeEntries.push(entry);
    this.showNoticeLine(message, kind);
  }

  /** Add one line to the notice, if `quiet` and the hint rules allow it. */
  private showNoticeLine(message: string, kind: NoticeKind): void {
    if (this.quiet || !this.mapContainer) return;
    const hints = showAuthorHints(this);
    if (kind === "hint" && !hints) return;
    this.notice ??= new MapNotice(this.mapContainer, { openDetails: hints, strings: this.strings });
    this.notice.add(message, kind);
  }

  /** Rebuild the notice from every line reported for this render. */
  private rebuildNotice(): void {
    this.notice?.clear();
    this.notice = null;
    for (const { message, kind } of this.noticeEntries) this.showNoticeLine(message, kind);
  }

  /**
   * Collect basemap-style errors fired within one task and show them as one
   * card: a style that fails validation fires one error per problem.
   */
  private queueStyleFailure(
    renderer: MapRenderer,
    error: Error,
    url: string | undefined,
    isV2: boolean
  ): void {
    if (this.pendingStyleErrors) {
      this.pendingStyleErrors.push(error);
      return;
    }
    this.pendingStyleErrors = [error];
    // Out of MapLibre's event dispatch before tearing its map down.
    setTimeout(() => {
      const errors = this.pendingStyleErrors;
      this.pendingStyleErrors = null;
      if (!errors || this.renderer !== renderer) return;
      this.showContentCard(
        styleFailureCard(errors, {
          url,
          isV2,
          filePage: isFilePage(this.ownerDocument),
          strings: this.strings,
        })
      );
    }, 0);
  }

  /**
   * Warn once if MapLibre's stylesheet is still not applied, after giving
   * any stylesheet that is still loading in this element's document the
   * chance to finish.
   */
  private async warnIfMapLibreCssMissing(): Promise<void> {
    const doc = this.ownerDocument;
    if (MLMap.isMapLibreCssLoaded(doc)) return;

    const pending = Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')
    ).filter((link) => !link.sheet);
    if (pending.length > 0) {
      await Promise.race([
        Promise.all(
          pending.map(
            (link) =>
              new Promise<void>((resolve) => {
                link.addEventListener("load", () => resolve(), { once: true });
                link.addEventListener("error", () => resolve(), { once: true });
              })
          )
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    // One more task: a `media="print"` → `"all"` swap runs in the link's
    // own load handler, which may queue after ours.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!this.isConnected || MLMap.isMapLibreCssLoaded(doc)) return;

    console.warn(
      "[ml-map] MapLibre GL CSS does not appear to be loaded, so the map " +
        "canvas and controls may render incorrectly. Import it from the " +
        'maplibre-gl package you installed (`import "maplibre-gl/dist/maplibre-gl.css"`), ' +
        "or load the matching version from a CDN, for example: " +
        '`<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@<version>/dist/maplibre-gl.css">`.'
    );
  }

  /**
   * Probe whether MapLibre's CSS is loaded in `doc` (the element's own
   * document, so a map inside an iframe checks the iframe's stylesheets).
   *
   * @remarks
   * Two signatures, either one counts. maplibre-gl up to 4.x paints a
   * `.maplibregl-canary` salmon (`rgb(250, 128, 114)`), the check MapLibre
   * itself used. 5.x dropped the canary rule, so the probe also carries the
   * `.maplibregl-map` class, which every version's stylesheet makes
   * `position: relative; overflow: hidden`. Checking only the canary warned
   * "CSS not loaded" on every maplibre-gl 5 page, CSS or not.
   */
  private static isMapLibreCssLoaded(doc: Document): boolean {
    try {
      const view = doc.defaultView;
      if (!view || !doc.body) return true;
      const probe = doc.createElement("div");
      probe.className = "maplibregl-canary maplibregl-map";
      probe.style.display = "none";
      doc.body.appendChild(probe);
      const style = view.getComputedStyle(probe);
      const loaded =
        style.backgroundColor === "rgb(250, 128, 114)" ||
        (style.position === "relative" && style.overflow === "hidden");
      doc.body.removeChild(probe);
      return loaded;
    } catch {
      // If we cannot probe (unusual DOM), do not nag.
      return true;
    }
  }

  /**
   * Forward MapRenderer events to custom element events
   *
   * @param swapping - The renderer is a fallback rebuild's next map (KTD8):
   *   no loading indicator over the old map; its `load` commits the swap
   *   before `ml-map:load` fires, so listeners see the new map.
   */
  private setupEventForwarding(renderer: MapRenderer, swapping: boolean): void {
    if (!swapping) {
      // The basemap's first full draw ends the loading state (ml-aot.121).
      this.loading.start();
      const map = (renderer as { getMap?: () => unknown }).getMap?.() as
        | { once?: (type: string, listener: () => void) => unknown }
        | undefined;
      map?.once?.("load", () => this.loading.stop());
    }

    // Map load event — the renderer emits this after the basemap is ready
    // AND every document layer was added, so it is the document-level
    // readiness signal mapReady()'s fast path keys on.
    renderer.on("load", () => {
      const swap = this.swap?.renderer === renderer ? this.swap : null;
      if (swap) this.commitSwap(swap);
      // A map that was replaced or abandoned meanwhile has nothing to announce.
      if (this.renderer !== renderer) return;
      this.documentLoaded = true;
      this.loading.stop();
      if (this.cssCheckPending) {
        this.cssCheckPending = false;
        void this.warnIfMapLibreCssMissing();
      }
      if (this.heightCheckPending) {
        this.heightCheckPending = false;
        this.checkHeight();
      }
      this.dispatchEvent(
        new CustomEvent("ml-map:load", {
          bubbles: true,
          detail: {},
        })
      );
      if (swap) {
        // The update that rebuilt: every document layer was (re)added.
        const summary = emptySummary(true, denormalizeLayers(swap.model).map((layer) => layer.id));
        this.dispatchEvent(
          new CustomEvent("ml-map:update-applied", {
            bubbles: true,
            detail: { summary },
          })
        );
        swap.resolve({ outcome: "fallback", summary });
        this.drainQueued();
      }
    });

    // An update applied in place (live documents, KTD9): the renderer emits
    // this only when something changed (or on a reload), so an equal
    // document fires nothing. The notice is settled by `updateDocument`.
    renderer.on("update:applied", ({ summary }) => {
      if (this.renderer !== renderer) return;
      this.dispatchEvent(
        new CustomEvent("ml-map:update-applied", {
          bubbles: true,
          detail: { summary },
        })
      );
    });

    // The document's `state:` values (live documents, KTD9)
    renderer.on("state:change", ({ values, changed }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:state-change", {
          bubbles: true,
          detail: { values, changed },
        })
      );
    });

    // Layer added
    renderer.on("layer:added", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-added", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer removed
    renderer.on("layer:removed", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-removed", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loading
    renderer.on("layer:data-loading", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loading", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loaded — a retried load that succeeded takes its line off
    // the notice (a `reload()` after a reader failed, KTD11).
    renderer.on("layer:data-loaded", ({ layerId, featureCount }) => {
      this.withdrawNotices(`data:${layerId}`);
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loaded", {
          bubbles: true,
          detail: { layerId, featureCount },
        })
      );
    });

    // Layer data error — also on the page: the layer is silently empty
    // otherwise, and nothing reached the console either (ml-aot.15).
    renderer.on("layer:data-error", ({ layerId, error }) => {
      this.reportProblem(
        describeDataProblem(layerId, error, {
          pageUrl: this.ownerDocument.baseURI,
          documentUrl: this.documentUrl ?? undefined,
          filePage: isFilePage(this.ownerDocument),
          base: this.base,
        }),
        { log: true, about: `data:${layerId}` }
      );
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-error", {
          bubbles: true,
          detail: { layerId, error },
        })
      );
    });

    // Layer click
    renderer.on("layer:click", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-click", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Layer hover
    renderer.on("layer:hover", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-hover", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Standalone markers (U5): added / clicked / icon fell back to the pin
    renderer.on("markers:added", ({ count }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:markers-added", {
          bubbles: true,
          detail: { count },
        })
      );
    });
    renderer.on("marker:click", ({ index, at }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-click", {
          bubbles: true,
          detail: { index, at },
        })
      );
    });
    renderer.on("marker:icon-error", ({ index, icon }) => {
      this.reportProblem(describeMarkerIconProblem(index, icon));
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-icon-error", {
          bubbles: true,
          detail: { index, icon },
        })
      );
    });

    // fitTo (U14): the initial camera framed its source's data
    renderer.on("camera:fit", ({ source, bounds }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:camera-fit", {
          bubbles: true,
          detail: { source, bounds },
        })
      );
    });

    // Declared images (U6): a failed entry — the document keeps rendering
    renderer.on("image:error", ({ name, url }) => {
      this.reportProblem(describeImageProblem(name, url));
      this.dispatchEvent(
        new CustomEvent("ml-map:image-error", {
          bubbles: true,
          detail: { name, url },
        })
      );
    });

    // classify: (0.9) — the classes as drawn, once the layers settle and
    // whenever fetched data (re)computes them (a story's legend listens).
    renderer.on("layer:classified", ({ layerId, classify }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-classified", {
          bubbles: true,
          detail: { layerId, classify },
        })
      );
    });

    // Params panel (U8): control writes, observable like every other action
    renderer.on("parameter:change", ({ key, value }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:parameter-change", {
          bubbles: true,
          detail: { key, value },
        })
      );
    });
    renderer.on("layer:visibility", ({ layerId, visible }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-visibility", {
          bubbles: true,
          detail: { layerId, visible },
        })
      );
    });
  }

  /**
   * Handle and display errors
   */
  private createMapContainer(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = MAP_CONTAINER_CLASS;
    // Positioned, so the loading label centres on it before MapLibre's own
    // class (which is positioned too) arrives.
    el.style.cssText = "position: relative; width: 100%; height: 100%;";
    return el;
  }

  /**
   * The children carrying a v1 slot name, split into corner mounts and the
   * legend override: direct children (parked, or added since the last
   * render) and the ones mounted in the running map's chrome, which a
   * fallback rebuild's next renderer takes over when it loads (KTD8).
   */
  private collectSlots(): { chrome: ChromeMount[]; legendElement?: HTMLElement } {
    const chrome: ChromeMount[] = [];
    let legendElement: HTMLElement | undefined;
    const mounted = this.querySelectorAll<HTMLElement>(`.${MAP_CONTAINER_CLASS} [slot]`);
    for (const child of [...Array.from(this.children), ...Array.from(mounted)]) {
      if (!(child instanceof HTMLElement)) continue;
      const name = child.getAttribute("slot");
      if (name === null) continue;
      if (name === "legend") {
        if (legendElement) {
          console.warn(
            '[ml-map] more than one slot="legend" child; only the first replaces the legend.'
          );
          continue;
        }
        legendElement = child;
      } else if ((CHROME_CORNERS as readonly string[]).includes(name)) {
        chrome.push({ position: name as ChromeCorner, element: child });
      } else {
        console.warn(
          `[ml-map] unknown slot "${name}" — expected one of: ${ML_MAP_SLOTS.join(", ")}. ` +
            "The child is left where it is."
        );
      }
    }
    return { chrome, legendElement };
  }

  /**
   * Move slot children the renderer borrowed back onto this element (where
   * the stylesheet hides them until the next mount), so tearing the map down
   * — re-render, error card, disconnect — never destroys author markup.
   */
  private parkSlots(): void {
    for (const el of Array.from(
      this.querySelectorAll<HTMLElement>(`.${MAP_CONTAINER_CLASS} [slot]`)
    )) {
      if (ML_MAP_SLOTS.includes(el.getAttribute("slot") ?? "")) {
        this.appendChild(el);
      }
    }
  }

  /** Park slot children, then destroy the renderer (if any). */
  /**
   * Every path that drops the map — re-render, error card, disconnect —
   * comes through here: effects detach first (they live on the renderer's
   * map), then slot children are parked (the renderer only borrows them),
   * then the renderer is destroyed.
   */
  private teardownRenderer(): void {
    this.cancelDeferredRender?.();
    this.teardownEffects();
    this.notice?.clear();
    this.notice = null;
    this.noticeEntries = [];
    this.pendingStyleErrors = null;
    this.rollback = null;
    this.removeHeightHint();
    this.parkSlots();
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  private removeErrorCards(): void {
    for (const el of Array.from(this.children)) {
      if (el.classList.contains(ERROR_CARD_CLASS)) el.remove();
    }
  }

  /** Dispatch `ml-map:error` and show the card for a prepared failure. */
  private showFailure(content: ErrorCardContent): void {
    this.handleError(content.errors, { title: content.title, hint: content.hint });
  }

  /** Show the card for a prepared failure (no event; see {@link showErrorCard}). */
  private showContentCard(content: ErrorCardContent): void {
    this.showErrorCard(content.errors, { title: content.title, hint: content.hint });
  }

  private handleError(
    errors: ParseError[],
    options: boolean | { showHelp?: boolean; title?: string; hint?: string } = {}
  ): void {
    const cardOptions = typeof options === "boolean" ? { showHelp: options } : options;
    // Persist the failure so a mapReady() call arriving after this event
    // rejects with the structured errors instead of waiting forever.
    this.lastError = Object.assign(
      new Error(
        `[ml-map] ${errors
          .map((e) => (displayPath(e) ? `${displayPath(e)}: ${e.message}` : e.message))
          .join("; ")}`
      ),
      { errors }
    );

    // Dispatch error event
    this.dispatchEvent(
      new CustomEvent("ml-map:error", {
        bubbles: true,
        detail: { errors },
      })
    );

    this.showErrorCard(errors, cardOptions);
  }

  /**
   * Replace the map with the on-page error card (no event; callers dispatch
   * their own `ml-map:error`). The card itself is built by
   * {@link createErrorCard}.
   */
  private showErrorCard(
    errors: ParseError[],
    {
      showHelp = false,
      title = this.strings("maplibre-yaml.ErrorCard.ConfigurationError"),
      hint,
    }: { showHelp?: boolean; title?: string; hint?: string } = {}
  ): void {
    this.loading.stop();
    // Targeted replacement (KTD9): the error card takes the map container's
    // place; author children (inline YAML, parked slot children) survive so
    // a fixed document can reload() into the same element.
    this.abandonSwap();
    this.teardownRenderer();
    this.removeErrorCards();
    this.mapContainer?.remove();

    this.appendChild(
      createErrorCard(this.ownerDocument, { title, errors, hint, showHelp, strings: this.strings })
    );
  }

  /**
   * Attach the document's experimental effects once the map has loaded.
   *
   * @remarks
   * Core never imports `@maplibre-yaml/effects`: the package registers an
   * effects host (see `effects-host.ts`) and this reads it. A document
   * without `effect:` layers returns immediately — no host lookup, no
   * listener. When the host registers after the map loads (a dynamic
   * import), the effects attach then; without a host at all the layers
   * stay static and say so once.
   */
  private setupEffects(model: MapModel, renderer: MapRenderer): void {
    const refs: EffectLayerRef[] = [];
    for (const layer of model.style.layers) {
      const effect = layer.runtime["effect"];
      const id = layer.spec["id"];
      if (effect && typeof effect === "object" && typeof id === "string") {
        refs.push({ layerId: id, effect: effect as EffectBlock });
      }
    }
    if (refs.length === 0) return;

    const attach = () => {
      if (this.renderer !== renderer || this.effectsAttachment) return;
      const map = renderer.getMap();
      const host = getEffectsHost();
      if (!map || !host) return;
      try {
        this.effectsAttachment = host.attach(map, refs);
      } catch (error) {
        // A host must declare absence rather than throw; if one throws
        // anyway, the static layers are still on the map — say so, don't
        // kill the document.
        console.error("[maplibre-yaml] effects failed to attach:", error);
      }
    };

    const whenLoaded = () => {
      if (getEffectsHost()) {
        attach();
        return;
      }
      console.warn(
        `[maplibre-yaml] ${refs.length} layer(s) declare an effect ` +
          `(${[...new Set(refs.map((r) => r.effect.type))].join(", ")}) but ` +
          "@maplibre-yaml/effects is not loaded — they render as their static " +
          'fallback. Import "@maplibre-yaml/effects/register" to enable them.'
      );
      this.effectsWait = onEffectsHost(() => {
        this.effectsWait = null;
        attach();
      });
    };
    // Once the document loads — or now, when it already has (an update's re-attach).
    if (this.documentLoaded) whenLoaded();
    else renderer.on("load", whenLoaded);
  }

  /** Detach the effects and attach them again from the last document (an update moved or rebuilt an effect layer). */
  private reattachEffects(): void {
    this.teardownEffects();
    if (this.effectsModel && this.renderer) this.setupEffects(this.effectsModel, this.renderer);
  }

  /** Detach effects and drop any pending host subscription. */
  private teardownEffects(): void {
    this.effectsWait?.();
    this.effectsWait = null;
    const attachment = this.effectsAttachment;
    this.effectsAttachment = null;
    if (attachment) {
      try {
        attachment.detach();
      } catch (error) {
        console.warn("[maplibre-yaml] effects failed to detach cleanly:", error);
      }
    }
  }

  /**
   * Clean up resources when component is removed
   */
  private destroy(): void {
    this.loading.stop();
    this.cancelEmptyConfigCheck();
    this.abandonSwap();
    this.teardownRenderer();
    this.appliedConfigKey = null;
    this._config = null;
    this.initialized = false;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get the underlying MapLibre GL map instance
   *
   * @returns The MapLibre GL map instance, or null if not initialized
   *
   * @see {@link MLMap.mapReady} — the promise form; resolves once loaded and
   * removes the need for the load-listener + null-guard shown below.
   *
   * @example
   * ```javascript
   * const mapEl = document.querySelector('ml-map');
   *
   * mapEl.addEventListener('ml-map:load', () => {
   *   const map = mapEl.getMap();
   *   map.flyTo({ center: [-122.4, 37.8], zoom: 14 });
   * });
   * ```
   */
  getMap(): MapLibreMap | null {
    return this.renderer?.getMap() ?? null;
  }

  /**
   * One of the UI strings for this map: the document's `locale:` entry for
   * `key`, else the English default.
   *
   * @remarks
   * For hosts that draw their own chrome next to the map (slot content,
   * Astro's `<FullPageMap>` buttons) and want it in the map's language.
   * Takes maplibre-yaml keys (`maplibre-yaml.Legend.Title`, ...) and the
   * MapLibre keys the library reads (`Map.Title`,
   * `NavigationControl.ZoomIn`, `NavigationControl.ZoomOut`). English until a
   * document has been read.
   *
   * @example
   * ```javascript
   * const el = document.querySelector("ml-map");
   * await el.mapReady();
   * button.ariaLabel = el.uiString("NavigationControl.ZoomIn"); // "Zoom in", or its translation
   * ```
   */
  uiString(key: StringKey | MapLibreStringKey, params?: StringParams): string {
    return this.strings(key, params);
  }

  /**
   * Resolve with the underlying MapLibre map once the document has loaded.
   *
   * @remarks
   * The readiness idiom (R3): replaces the `ml-map:load` listener +
   * `getMap()` null-guard boilerplate every page-code snippet needed.
   * Resolves immediately when the map is already loaded; otherwise resolves
   * on the next `ml-map:load` and rejects on `ml-map:error` (config parse
   * failure, renderer construction failure, or a runtime map error).
   *
   * @example
   * ```javascript
   * const map = await document.querySelector('ml-map').mapReady();
   * map.flyTo({ center: [-122.4, 37.8], zoom: 14 });
   * ```
   */
  mapReady(): Promise<MapLibreMap> {
    // Fast paths mirror the event contract exactly: resolve on the same
    // condition ml-map:load announces (document loaded — basemap AND every
    // layer), reject when a terminal failure already fired (its ml-map:error
    // will never recur for a late subscriber).
    if (this.documentLoaded) {
      const map = this.getMap();
      if (map) return Promise.resolve(map);
    }
    if (this.lastError) return Promise.reject(this.lastError);

    return new Promise<MapLibreMap>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        const map = this.getMap();
        if (map) resolve(map);
        else reject(new Error("[ml-map] loaded without a map instance"));
      };
      const onError = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        // Non-fatal runtime errors (a 404'd tile before load) don't decide
        // readiness — the map still loads after them. Keep waiting.
        if (detail?.fatal === false) return;
        cleanup();
        if (detail?.error instanceof Error) {
          reject(detail.error);
        } else if (Array.isArray(detail?.errors)) {
          // handleError's shape: structured ParseError[] — keep it readable
          // and attach the array for programmatic consumers.
          reject(
            Object.assign(
              new Error(
                `[ml-map] ${detail.errors
                  .map((e: { path?: string; message: string }) =>
                    displayPath(e) ? `${displayPath(e)}: ${e.message}` : e.message
                  )
                  .join("; ")}`
              ),
              { errors: detail.errors }
            )
          );
        } else {
          reject(new Error(`[ml-map] failed to load: ${JSON.stringify(detail ?? {})}`));
        }
      };
      const onRejected = (event: Event) => {
        // A basemap change whose new map never loaded (KTD8): the map that
        // was loaded before it is still the map, and still loaded.
        if ((event as CustomEvent<{ kind: RejectionKind }>).detail?.kind !== "style" || !this.documentLoaded) return;
        onLoad();
      };
      const cleanup = () => {
        this.removeEventListener("ml-map:load", onLoad);
        this.removeEventListener("ml-map:error", onError);
        this.removeEventListener("ml-map:update-rejected", onRejected);
      };
      this.addEventListener("ml-map:load", onLoad);
      this.addEventListener("ml-map:error", onError);
      this.addEventListener("ml-map:update-rejected", onRejected);
    });
  }

  /**
   * Get the MapRenderer instance
   *
   * @returns The MapRenderer instance, or null if not initialized
   */
  getRenderer(): MapRenderer | null {
    return this.renderer;
  }

  /**
   * Check if the map is loaded
   *
   * @returns True if the map has finished loading
   */
  isLoaded(): boolean {
    return this.renderer?.isMapLoaded() ?? false;
  }

  /**
   * Add a layer to the map
   *
   * @param layer - Layer configuration object
   * @returns Promise that resolves when the layer is added
   *
   * @example
   * ```javascript
   * await mapEl.addLayer({
   *   id: 'new-layer',
   *   type: 'circle',
   *   source: {
   *     type: 'geojson',
   *     data: { type: 'FeatureCollection', features: [] }
   *   },
   *   paint: { 'circle-radius': 6, 'circle-color': '#ff0000' }
   * });
   * ```
   */
  async addLayer(layer: any): Promise<void> {
    await this.renderer?.addLayer(applyDocumentBaseToLayer(layer, this.base));
  }

  /**
   * Remove a layer from the map
   *
   * @param layerId - ID of the layer to remove
   */
  removeLayer(layerId: string): void {
    this.renderer?.removeLayer(layerId);
  }

  /**
   * Set layer visibility
   *
   * @param layerId - ID of the layer
   * @param visible - Whether the layer should be visible
   */
  setLayerVisibility(layerId: string, visible: boolean): void {
    this.renderer?.setLayerVisibility(layerId, visible);
  }

  /**
   * Update layer data
   *
   * @param layerId - ID of the layer
   * @param data - New GeoJSON data
   */
  updateLayerData(layerId: string, data: GeoJSON.GeoJSON): void {
    this.renderer?.updateLayerData(layerId, data);
  }

  /**
   * Apply a new document to the running map (live documents, 0.10): the
   * method form of assigning `config`.
   *
   * @remarks
   * Takes a `MapBlock` or document text (YAML, JSON or TOML), validates it
   * like every other path, and resolves when the outcome is final: `applied` with the summary
   * of what changed (`ml-map:update-applied` fired), `rejected` with the
   * diagnostics (`ml-map:update-rejected` fired, map untouched), `fallback`
   * when a basemap change rebuilt the map or there was no running map yet,
   * or `superseded` when a later document replaced this one before it
   * applied (a TOML document still waiting for its reader included). A
   * document equal to the applied one resolves `applied` with nothing in the
   * summary. Text that is TOML when the TOML reader can't be downloaded is
   * refused with `kind: "chunk"`, the map untouched.
   *
   * @example
   * ```javascript
   * const { outcome, summary } = await el.update({ ...el.getDocument(), layers });
   * ```
   */
  update(doc: MapBlock | string): Promise<UpdateResult> {
    this.lastUpdate = null;
    this.config = doc;
    const started = this.lastUpdate as Promise<UpdateResult> | null;
    if (started) return started;
    // Before the element connects, the document renders when it does: the
    // outcome is that first render's (`fallback`, or `rejected` on the error
    // card). Connected, nothing started means nothing to do (an equal document).
    return this.initialized ? Promise.resolve({ outcome: "applied", summary: emptySummary() }) : this.whenRendered();
  }

  /**
   * The document the running map shows: the parsed `MapBlock`, the same
   * shape `config` returns and {@link update} takes (KTD15). `null` with no
   * running map. The renderer's `getDocument()` returns its normalized
   * model instead; neither is the other's input.
   */
  getDocument(): MapBlock | null {
    return this.renderer ? this._config : null;
  }

  /**
   * Write `state:` values (live documents, R12): each goes through the
   * map's global state, the params panel follows, and one
   * `ml-map:state-change` fires. Declared keys only: an undeclared key
   * refuses the whole call. During a basemap rebuild the values land on the
   * new map once it loads.
   *
   * @throws With no running map, for an undeclared key, or on a maplibre-gl
   *   without `setGlobalStateProperty` (below 5.6).
   */
  setState(values: Record<string, unknown>): void {
    const target = this.swap?.renderer ?? this.renderer;
    if (!target) throw new Error("[ml-map] setState: no map is running yet");
    target.setState(values);
  }

  /** The document's current `state:` values: its defaults, the panel's seeds and every write since. `{}` with no running map. */
  getState(): Record<string, unknown> {
    const values = this.renderer?.getState() ?? {};
    // During a swap `setState` writes to the next map: read back as written.
    return this.swap ? { ...values, ...this.pendingStateWrites(this.swap) } : values;
  }

  /**
   * Reload configuration from the current source
   *
   * @remarks
   * Re-fetches `src` (or re-reads the inline script, or the `config`
   * attribute) and applies the result to the running map as an update
   * (KTD11): sources whose last load failed are retried even when the
   * document is unchanged, and so is a TOML reader that couldn't be
   * downloaded. From an error card, a valid document renders fresh.
   *
   * @returns Promise that resolves when reload is complete
   */
  async reload(): Promise<void> {
    const running = this.renderer;
    const hints: DiffHints = running ? { failedSources: running.failedSources(), urlsRebased: false, reload: true } : NO_HINTS;
    const src = this.getAttribute("src");

    const script = findDocumentScript(this);
    const attr = this.getAttribute("config");
    if (src) await this.loadFromURL(src, hints);
    else if (script?.textContent) await this.loadFromScript(script, hints);
    else if (attr) await this.readText(attr, hints, true);
  }
}

/**
 * Typed listener overloads: `el.addEventListener("ml-map:layer-click", (e) =>
 * e.detail.layerId)` type-checks without a cast. Declaration merging adds
 * overloads only; there is no runtime code.
 */
export interface MLMap {
  addEventListener<K extends keyof MLMapEventMap>(
    type: K,
    listener: (this: MLMap, event: MLMapEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLMap, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof MLMapEventMap>(
    type: K,
    listener: (this: MLMap, event: MLMapEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLMap, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

declare global {
  /**
   * Types `document.querySelector("ml-map")` and
   * `document.createElement("ml-map")` as {@link MLMap}, so `mapReady()` /
   * `getMap()` type-check without a cast.
   */
  interface HTMLElementTagNameMap {
    "ml-map": MLMap;
  }
}

/**
 * Register the ml-map custom element
 */
export function registerMLMap(): void {
  if (typeof window !== "undefined" && !customElements.get("ml-map")) {
    customElements.define("ml-map", MLMap);
  }
}
