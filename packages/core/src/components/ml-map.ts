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
 * ### 3. JSON Config Attribute (Programmatic)
 * ```html
 * <ml-map config='{"type":"map",...}'></ml-map>
 * ```
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  YAMLParser,
  type MapBlock,
  type ParseError,
  type ValidationWarning,
} from "../parser/yaml-parser.js";
import { MapRenderer } from "../renderer/map-renderer.js";
import {
  toModel,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "../model/index.js";
import type { MapModel } from "../model/types.js";
import { createErrorCard, ERROR_CARD_CLASS } from "./error-card.js";
import { MapNotice } from "./map-notice.js";
import {
  describeDataProblem,
  describeImageProblem,
  describeLayerProblem,
  describeMarkerIconProblem,
  describeSourceProblem,
  describeFitToProblem,
  describeSwappedCenter,
  filePageWorkerCard,
  isFilePage,
  looksLikeHtml,
  resolveUrl,
  srcFetchFailedCard,
  srcHtmlCard,
  srcHttpErrorCard,
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
import type { ChromeMount, MapRendererEvents } from "../renderer/map-renderer.js";
import { CHROME_CORNERS, type ChromeCorner } from "../renderer/chrome-layout.js";
import { displayPath } from "../parser/validation-utils.js";
import {
  applyDocumentBase,
  applyDocumentBaseToLayer,
  normalizeDocumentBase,
  resolveDocumentUrl,
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
 */
export class MLMap extends HTMLElement {
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
   * The effects attached to the current map (experimental, 0.7), and the
   * subscription waiting for an effects host that registers late. Both are
   * torn down with the renderer, so a reload never leaks a custom layer.
   */
  private effectsAttachment: EffectsAttachment | null = null;
  private effectsWait: (() => void) | null = null;

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
  /** The current document's `onPage` warnings, shown once its map renders. */
  private documentNotices: string[] = [];

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
    return ["src", "config", "quiet", "base"];
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
   * Get the current map configuration
   */
  get config(): MapBlock | null {
    return this._config;
  }

  /**
   * Set the map configuration programmatically.
   *
   * @remarks
   * Accepts a `MapBlock` object or its JSON string; both are validated like
   * every other config path, whether assigned before or after the element
   * connects. Assigning a value that is JSON-equal to the config currently
   * applied is a no-op, so a framework re-binding an equal object does not
   * rebuild the map. Assigning `null` clears the stored config without
   * touching a rendered map.
   */
  set config(value: MapBlock | string | null) {
    if (value === null) {
      this._config = null;
      this.appliedConfigKey = null;
      return;
    }

    let parsed: unknown;

    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (e) {
        this.cancelEmptyConfigCheck();
        this.appliedConfigKey = null;
        this.handleError([
          { path: "", message: "Invalid JSON in config property" },
        ]);
        return;
      }
    } else {
      parsed = value;
    }

    // Before connect: store the candidate; initialize() validates it.
    if (!this.initialized) {
      this._config = parsed as MapBlock;
      return;
    }

    this.cancelEmptyConfigCheck();
    const key = configKey(parsed);
    if (key !== null && key === this.appliedConfigKey) return;

    this._config = parsed as MapBlock;
    this.applyValidatedConfig(parsed, key);
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
    this.appliedConfigKey = key;
    this.documentUrl = null;
    const result = YAMLParser.safeParseMapBlockValue(candidate);

    // Advisory, never in the error card (decision D11) — same as YAML.
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this._config = result.data;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
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
    this.upgradeProperty("config");

    // Create internal map container
    this.mapContainer = this.createMapContainer();

    // Ensure the component has display: block (custom elements default to inline)
    if (!this.style.display || this.style.display === "inline") {
      this.style.display = "block";
    }

    // Initialize configuration loading
    this.initialize();
  }

  /**
   * Re-apply an own property set on the element before it was upgraded, so
   * it reaches the class accessor instead of shadowing it.
   */
  private upgradeProperty(name: "config" | "base"): void {
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
      }
      return;
    }

    // Only process changes after initialization
    if (!this.initialized) return;

    if (name === "base") {
      // Every URL in the document may move: re-fetch `src` (its own path
      // depends on the base) or re-render the document already loaded.
      if (normalizeDocumentBase(oldValue) === normalizeDocumentBase(newValue)) return;
      const src = this.getAttribute("src");
      if (src) void this.loadFromURL(src);
      else if (this._config && this.renderer) this.renderMap(this._config);
      return;
    }

    if (name === "src" && newValue) {
      this.loadFromURL(newValue);
    } else if (name === "config" && newValue) {
      this.loadFromJSONAttribute(newValue);
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
    if (this._config) {
      this.applyValidatedConfig(this._config);
      return;
    }

    // Priority 2: Script tag with YAML
    const yamlScript = this.querySelector('script[type="text/yaml"]');
    if (yamlScript?.textContent) {
      this.loadFromScriptTag(yamlScript.textContent);
      return;
    }

    // Priority 3: External YAML file
    const srcAttr = this.getAttribute("src");
    if (srcAttr) {
      await this.loadFromURL(srcAttr);
      return;
    }

    // Priority 4: JSON config attribute
    const configAttr = this.getAttribute("config");
    if (configAttr) {
      this.loadFromJSONAttribute(configAttr);
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
      this.handleError(
        [
          {
            path: "",
            message: "No configuration provided.",
          },
        ],
        true
      );
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
   * Load and parse YAML from a script tag's text content
   */
  private loadFromScriptTag(yamlContent: string): void {
    this.cancelEmptyConfigCheck();
    this.appliedConfigKey = null;
    this.documentUrl = null;
    const result = YAMLParser.safeParseMapBlock(yamlContent);

    // Warnings are advisory (unknown keys, deprecations, expression hints):
    // surface them on the console, never in the error card (per decision D11).
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this._config = result.data;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
    }
  }

  /**
   * Load and parse YAML from an external URL.
   *
   * @remarks
   * Each way a fetch fails gets its own actionable card (ml-aot.13): a page
   * opened from disk (`file://`, where browsers refuse the request) says to
   * serve the folder; an HTTP error and an HTML page (what an SPA-fallback
   * server returns for a wrong path, with status 200) both show the URL the
   * browser actually requested, since a path resolved against the wrong
   * folder is the usual cause.
   */
  private async loadFromURL(url: string): Promise<void> {
    this.cancelEmptyConfigCheck();
    this.appliedConfigKey = null;

    // Emit loading event
    this.dispatchEvent(
      new CustomEvent("ml-map:loading", {
        bubbles: true,
        detail: { url },
      })
    );

    const doc = this.ownerDocument;
    // With a `base`, `src` is a site path like every path inside the document.
    const target = resolveDocumentUrl(url, this.base);
    const resolved = resolveUrl(target, doc.baseURI);
    const filePage = isFilePage(doc);

    let response: Response;
    let yamlContent: string;
    try {
      response = await fetch(target);
      if (!response.ok) {
        this.showFailure(
          srcHttpErrorCard(url, resolved, response.status, response.statusText, {
            pageUrl: doc.baseURI,
            base: this.base,
          })
        );
        return;
      }
      yamlContent = await response.text();
    } catch (error) {
      this.showFailure(srcFetchFailedCard(url, resolved, error, filePage));
      return;
    }

    if (looksLikeHtml(yamlContent, response.headers?.get?.("content-type") ?? null)) {
      this.showFailure(srcHtmlCard(url, resolved, { pageUrl: doc.baseURI, base: this.base }));
      return;
    }

    const result = YAMLParser.safeParseMapBlock(yamlContent);
    this.logWarnings(result.warnings);

    if (result.success && result.data) {
      this._config = result.data;
      this.documentUrl = resolved;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
    }
  }

  /**
   * Parse and validate JSON from the config attribute
   */
  private loadFromJSONAttribute(jsonString: string): void {
    this.cancelEmptyConfigCheck();
    try {
      const parsed = JSON.parse(jsonString);
      // Validated like the YAML paths. Well-formed JSON that fails the schema
      // used to go straight to the renderer, producing a broken map with no
      // diagnostic — the same "accepted but does not work" shape this release
      // is closing, on the entry path least likely to be noticed.
      this.applyValidatedConfig(parsed);
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Invalid JSON in config attribute: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Render the map with the given configuration
   */
  private renderMap(mapBlock: MapBlock): void {
    // Standalone <ml-map> has no global config to inherit defaultMapStyle from,
    // so a missing basemap would die inside MapLibre with an opaque error.
    // Surface a friendly error card instead. (Schema keeps it optional because
    // the Astro builders legitimately resolve it from globalConfig.) The base
    // style is `config.mapStyle` in v1 and `style.basemap` in v2, so the guard
    // reads whichever the document's version puts it under.
    const isV2 = (mapBlock as { version?: number }).version === 2;
    const basemap = isV2
      ? (mapBlock as unknown as { style?: { basemap?: unknown } }).style?.basemap
      : mapBlock.config?.mapStyle;
    if (!basemap) {
      const path = isV2 ? "style.basemap" : "config.mapStyle";
      const key = isV2 ? "basemap" : "mapStyle";
      const where = isV2 ? "your style:" : "your config";
      this.handleError([
        {
          path,
          message:
            `${key} is required for standalone maps. Add it to ${where}, for example: ` +
            `${key}: "https://demotiles.maplibre.org/style.json" ` +
            "(inheriting a defaultMapStyle is a feature of the Astro builders, not the standalone <ml-map> element).",
        },
      ]);
      return;
    }

    // Destroy existing renderer (slot children parked first — the renderer
    // only borrows them, and its teardown removes their corner containers).
    this.teardownRenderer();
    // The teardown cleared the notice; this document's on-page warnings
    // (logged as it was parsed, just before) go back on it.
    for (const message of this.documentNotices) this.reportProblem(message);

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

    // Never build the MapLibre map while the page's module scripts are still
    // evaluating (ml-aot.2). A bundler can hoist `register` ahead of the code
    // that sets maplibre-gl 6's worker URL (side-effect order is not kept
    // across shared chunks), and a map constructed in that window spawns its
    // workers from the wrong URL: "Worker failed to load", a blank map. Every
    // deferred and module script has run by DOMContentLoaded, so wait for it
    // when it is still ahead; otherwise (elements created later, frameworks,
    // maplibre-gl 4/5) this is the same synchronous path as before.
    const doc = this.ownerDocument;
    if (pageScriptsPending(doc)) {
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
    this.constructRenderer(mapBlock);
  }

  /**
   * Build the MapRenderer for a validated document into the (already
   * attached) map container. Split from {@link renderMap} so the DOM-ready
   * deferral can run it later.
   */
  private constructRenderer(mapBlock: MapBlock): void {
    if (!this.mapContainer) return;
    const slots = this.collectSlots();
    const isV2 = (mapBlock as { version?: number }).version === 2;

    try {
      // Normalize the v1 document into the v2 internal model, then render from
      // it. The model is what the emitter is written against (R30); routing the
      // production path through it here is what proves the normalization loses
      // nothing — every component and renderer test now exercises the round
      // trip, so a dropped or invented key fails the suite rather than shipping.
      // `base` (GitHub Pages project sites) resolves every URL in the
      // document in one pass, before anything fetches (ml-aot.30).
      const model = applyDocumentBase(toModel(mapBlock as never), this.base);

      const renderer: MapRenderer = new MapRenderer(
        this.mapContainer,
        denormalizeConfig(model),
        denormalizeLayers(model),
        {
          ...denormalizeOptions(model),
          chrome: slots.chrome,
          legendElement: slots.legendElement,
        onLoad: () => {
          // Load event is also emitted via the event system
        },
        onError: (error, fatal, context) => {
          // A fitTo.source typo (ml-aot.51): the renderer already warned on
          // the console; put it on the map too. Not a map error.
          if (context?.kind === "fit" && context.sourceId) {
            this.reportProblem(describeFitToProblem(context.sourceId, context.suggestion));
            return;
          }
          // `center: [lat, lng]` (ml-aot.65): the renderer warned; show it.
          if (context?.kind === "center" && context.center && context.swapped) {
            this.reportProblem(describeSwappedCenter(context.center, context.swapped));
            return;
          }
          // Loud by default: with no `ml-map:error` listener attached, a
          // dispatched event is invisible and the document fails silently
          // (ml-tfd.8 contract audit). Hosts still get the event.
          console.error("[maplibre-yaml] map error:", error);
          // MapLibre reports a worker that could not start as a runtime
          // error, but the map can never load without one: treat it as
          // terminal and put it on the page, not only on the console — a
          // student otherwise sees an empty box (ml-aot.2).
          const workerFailure = /worker failed to load/i.test(error.message);
          const terminal = fatal !== false || workerFailure;
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
                this.showContentCard(filePageWorkerCard());
              } else {
                this.showErrorCard([{ path: "", message: error.message }], {
                  title: "Map Error",
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
          if (!terminal && context?.kind === "layer" && context.layerId) {
            this.reportProblem(describeLayerProblem(context.layerId, error.message));
          } else if (!terminal && context?.kind === "source" && context.sourceId) {
            this.reportProblem(
              describeSourceProblem(context.sourceId, error.message, error, {
                pageUrl: this.ownerDocument.baseURI,
                base: this.base,
              })
            );
          }
        },
        },
        denormalizeSources(model)
      );
      this.renderer = renderer;

      // Set up event forwarding
      this.setupEventForwarding();

      // Experimental effects (`effect:` layers) attach once the map loads.
      this.setupEffects(model);

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
      console.warn(`[ml-map] ${path}${warning.message}${location}`);
      // A valid document where part of it silently does nothing (a root key
      // nested under config:): also say so on the page (ml-aot.48). Still
      // the non-fatal notice, never the error card.
      if (warning.onPage) this.documentNotices.push(`${warning.message}${location}`);
    }
  }

  /**
   * Put one line in this map's non-fatal notice ("part of this map didn't
   * load"). For `<ml-scrollytelling>`, which reports its own document's
   * problems on its map (ml-aot.48, ml-aot.51). Respects `quiet`.
   *
   * @internal
   */
  _reportNotice(message: string): void {
    this.reportProblem(message);
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
    const code = (text: string) => {
      const el = doc.createElement("code");
      el.textContent = text;
      el.style.cssText = "font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;";
      return el;
    };
    hint.append(
      doc.createTextNode("This map is invisible because the "),
      code("<ml-map>"),
      doc.createTextNode(" element has no height. Give it one, for example "),
      code('<ml-map style="display:block; height:400px">'),
      doc.createTextNode(" — or in your CSS: "),
      code("ml-map { display: block; height: 400px; }")
    );
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
   */
  private reportProblem(message: string, options: { log?: boolean } = {}): void {
    if (options.log) console.error(`[maplibre-yaml] ${message.replace(/`/g, '"')}`);
    if (this.quiet || !this.mapContainer) return;
    this.notice ??= new MapNotice(this.mapContainer);
    this.notice.add(message);
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
        styleFailureCard(errors, { url, isV2, filePage: isFilePage(this.ownerDocument) })
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
   */
  private setupEventForwarding(): void {
    if (!this.renderer) return;

    // Map load event — the renderer emits this after the basemap is ready
    // AND every document layer was added, so it is the document-level
    // readiness signal mapReady()'s fast path keys on.
    this.renderer.on("load", () => {
      this.documentLoaded = true;
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
    });

    // Layer added
    this.renderer.on("layer:added", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-added", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer removed
    this.renderer.on("layer:removed", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-removed", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loading
    this.renderer.on("layer:data-loading", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loading", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loaded
    this.renderer.on("layer:data-loaded", ({ layerId, featureCount }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loaded", {
          bubbles: true,
          detail: { layerId, featureCount },
        })
      );
    });

    // Layer data error — also on the page: the layer is silently empty
    // otherwise, and nothing reached the console either (ml-aot.15).
    this.renderer.on("layer:data-error", ({ layerId, error }) => {
      this.reportProblem(
        describeDataProblem(layerId, error, {
          pageUrl: this.ownerDocument.baseURI,
          documentUrl: this.documentUrl ?? undefined,
          filePage: isFilePage(this.ownerDocument),
          base: this.base,
        }),
        { log: true }
      );
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-error", {
          bubbles: true,
          detail: { layerId, error },
        })
      );
    });

    // Layer click
    this.renderer.on("layer:click", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-click", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Layer hover
    this.renderer.on("layer:hover", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-hover", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Standalone markers (U5): added / clicked / icon fell back to the pin
    this.renderer.on("markers:added", ({ count }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:markers-added", {
          bubbles: true,
          detail: { count },
        })
      );
    });
    this.renderer.on("marker:click", ({ index, at }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-click", {
          bubbles: true,
          detail: { index, at },
        })
      );
    });
    this.renderer.on("marker:icon-error", ({ index, icon }) => {
      this.reportProblem(describeMarkerIconProblem(index, icon));
      this.dispatchEvent(
        new CustomEvent("ml-map:marker-icon-error", {
          bubbles: true,
          detail: { index, icon },
        })
      );
    });

    // fitTo (U14): the initial camera framed its source's data
    this.renderer.on("camera:fit", ({ source, bounds }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:camera-fit", {
          bubbles: true,
          detail: { source, bounds },
        })
      );
    });

    // Declared images (U6): a failed entry — the document keeps rendering
    this.renderer.on("image:error", ({ name, url }) => {
      this.reportProblem(describeImageProblem(name, url));
      this.dispatchEvent(
        new CustomEvent("ml-map:image-error", {
          bubbles: true,
          detail: { name, url },
        })
      );
    });

    // Params panel (U8): control writes, observable like every other action
    this.renderer.on("parameter:change", ({ key, value }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:parameter-change", {
          bubbles: true,
          detail: { key, value },
        })
      );
    });
    this.renderer.on("layer:visibility", ({ layerId, visible }) => {
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
    el.style.cssText = "width: 100%; height: 100%;";
    return el;
  }

  /**
   * The direct children carrying a v1 slot name, split into corner mounts
   * and the legend override. Parked slot children are direct children again,
   * so every render (including `reload()`) re-collects them — and picks up
   * slot children added since the last render.
   */
  private collectSlots(): { chrome: ChromeMount[]; legendElement?: HTMLElement } {
    const chrome: ChromeMount[] = [];
    let legendElement: HTMLElement | undefined;
    for (const child of Array.from(this.children)) {
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
    this.pendingStyleErrors = null;
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
      title = "Configuration Error",
      hint,
    }: { showHelp?: boolean; title?: string; hint?: string } = {}
  ): void {
    // Targeted replacement (KTD9): the error card takes the map container's
    // place; author children (inline YAML, parked slot children) survive so
    // a fixed document can reload() into the same element.
    this.teardownRenderer();
    this.removeErrorCards();
    this.mapContainer?.remove();

    this.appendChild(
      createErrorCard(this.ownerDocument, { title, errors, hint, showHelp })
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
  private setupEffects(model: MapModel): void {
    const refs: EffectLayerRef[] = [];
    for (const layer of model.style.layers) {
      const effect = layer.runtime["effect"];
      const id = layer.spec["id"];
      if (effect && typeof effect === "object" && typeof id === "string") {
        refs.push({ layerId: id, effect: effect as EffectBlock });
      }
    }
    if (refs.length === 0 || !this.renderer) return;

    const renderer = this.renderer;
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

    renderer.on("load", () => {
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
    });
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
    this.cancelEmptyConfigCheck();
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
      const cleanup = () => {
        this.removeEventListener("ml-map:load", onLoad);
        this.removeEventListener("ml-map:error", onError);
      };
      this.addEventListener("ml-map:load", onLoad);
      this.addEventListener("ml-map:error", onError);
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
   * Reload configuration from the current source
   *
   * @returns Promise that resolves when reload is complete
   */
  async reload(): Promise<void> {
    const src = this.getAttribute("src");

    if (src) {
      await this.loadFromURL(src);
    } else {
      const yamlScript = this.querySelector('script[type="text/yaml"]');
      if (yamlScript?.textContent) {
        this.loadFromScriptTag(yamlScript.textContent);
      }
    }
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
