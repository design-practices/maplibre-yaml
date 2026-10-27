/**
 * @file Live documents: the update engine's shared types (0.10, ml-4ug)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * The shapes the pure differ (`diff.ts`) produces and the apply step consumes,
 * plus the result and summary a host sees, named by the plan's cross-surface
 * naming contract (docs/plans/2026-10-27-001-feat-live-documents-plan.md).
 *
 * Types only. The engine ships as a lazy chunk that shares nothing with the
 * main bundle (KTD10), so nothing in `update/` may value-import a renderer
 * module; every reference to one below is `import type`.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type {
  MapConfig,
  FitToConfig,
  ImageConfig,
  LegendConfig,
  MarkerConfig,
  StandalonePopupConfig,
} from "../../schemas/map.schema";
import type { Layer } from "../../schemas/layer.schema";
import type { LayerSource } from "../../schemas/source.schema";
import type { MapErrorContext, MapRendererOptions } from "../map-renderer";
import type { LayerManager } from "../layer-manager";
import type { EventHandler } from "../event-handler";
import type { LegendBuilder } from "../legend-builder";
import type { ParamsBuilder } from "../params-builder";
import type { ControlsManager } from "../controls-manager";
import type { ClassifyRuntime } from "../classify-runtime";
import type { Strings } from "../../i18n";

/**
 * The option blocks a document carries outside `config:`, as
 * `denormalizeOptions` reassembles them. Host-supplied renderer options
 * (`onError`, `chrome`, `sourceData`, ...) are not part of the document and
 * never compared.
 */
export type DocumentOptions = Pick<
  MapRendererOptions,
  | "title"
  | "description"
  | "controls"
  | "legend"
  | "state"
  | "parameters"
  | "markers"
  | "popups"
  | "images"
  | "terrain"
  | "sky"
  | "projection"
  | "light"
>;

/**
 * The normalized document the renderer applies: the four values its
 * constructor receives (KTD1, KTD15). What `renderer.getDocument()` returns.
 */
export interface AppliedDocument {
  config: MapConfig;
  layers: Layer[];
  sources: Record<string, LayerSource>;
  options: DocumentOptions;
}

/**
 * What the renderer knows that the documents do not (KTD1, KTD11): sources
 * whose last load failed (`reload()` retries them even when the document is
 * unchanged) and whether a `base` change re-resolved every relative URL.
 * When both are empty, equal documents short-circuit to no operations.
 */
export interface DiffHints {
  failedSources: ReadonlySet<string>;
  urlsRebased: boolean;
}

/**
 * Where a layer goes in the document: its index among document layers and
 * the layer it is inserted before — the next document layer in document
 * order, or the layer's own `before:` when that names a layer the document
 * does not declare (a basemap layer, KTD3). Absent for the last layer with
 * no anchor: it goes on top.
 */
export interface LayerPosition {
  index: number;
  beforeId?: string;
}

/** Which setter a `layerSetProperty` goes through. */
export type LayerPropertyTarget =
  | "paint"
  | "layout"
  | "filter"
  | "zoom"
  | "visibility"
  /**
   * A key the renderer owns rather than MapLibre (`interactive`, `classify`,
   * `legend`, `label`, `toggleable`, `metadata`, ...): applied by the
   * runtime re-sync, keyed on the layer.
   */
  | "runtime";

/** Why a source or layer is replaced rather than patched (the KTD2 table). */
export type ReplaceReason = string;

/** A map option the runtime applies in place, or a derived option block. */
export type OptionKey =
  | "projection"
  | "terrain"
  | "sky"
  | "light"
  | "minZoom"
  | "maxZoom"
  | "maxBounds"
  | "title"
  | "description"
  | "controls"
  | "legend"
  | "parameters"
  | "markers"
  | "popups"
  | "images"
  /** The layers' `effect:` blocks by layer id: a change re-attaches effects (KTD6b). */
  | "effects"
  | "state";

/** The camera keys the document owns (KTD13). */
export interface CameraValues {
  center?: MapConfig["center"];
  zoom?: MapConfig["zoom"];
  bearing?: MapConfig["bearing"];
  pitch?: MapConfig["pitch"];
}

/**
 * One source operation. `inline` marks a layer's own source
 * (`${layerId}-source`), which `LayerManager` adds and removes with its layer.
 */
interface SourceOpBase {
  sourceId: string;
  source: LayerSource;
  inline: boolean;
}

export interface SourceAddOp extends SourceOpBase {
  op: "sourceAdd";
}
export interface SourceReplaceOp extends SourceOpBase {
  op: "sourceReplace";
  reason: ReplaceReason;
}
export interface SourceSetDataOp extends SourceOpBase {
  op: "sourceSetData";
}
export interface SourceSetUrlOp extends SourceOpBase {
  op: "sourceSetUrl";
}
export interface SourceSetTilesOp extends SourceOpBase {
  op: "sourceSetTiles";
}
export interface SourceRemoveOp {
  op: "sourceRemove";
  sourceId: string;
  inline: boolean;
}

export interface LayerAddOp {
  op: "layerAdd";
  layerId: string;
  layer: Layer;
  position: LayerPosition;
}
export interface LayerRemoveOp {
  op: "layerRemove";
  layerId: string;
}
export interface LayerReplaceOp {
  op: "layerReplace";
  layerId: string;
  layer: Layer;
  position: LayerPosition;
  reason: ReplaceReason;
}
export interface LayerSetPropertyOp {
  op: "layerSetProperty";
  layerId: string;
  target: LayerPropertyTarget;
  /** The MapLibre property name (`fill-color`, `visibility`, `minzoom`) or the runtime key. */
  property: string;
  /** The next value; `undefined` clears the property. */
  value: unknown;
}
export interface LayerMoveOp {
  op: "layerMove";
  layerId: string;
  /** As {@link LayerPosition.beforeId}. */
  beforeId?: string;
}

export interface CameraSetOp {
  op: "cameraSet";
  /** Only the keys that changed and are present in the next document. */
  camera: CameraValues;
}
export interface FitToOp {
  op: "fitTo";
  fitTo: FitToConfig;
}
export interface OptionSetOp {
  op: "optionSet";
  option: OptionKey;
  /** The next value; `undefined` when the block was removed. */
  value: unknown;
}
/** The whole update is a rebuild (KTD7); the only operation when present. */
export interface FallbackOp {
  op: "fallback";
  /** The `config:` key that forced it (`mapStyle`, `interactive`, ...). */
  reason: string;
}

export type UpdateOp =
  | SourceAddOp
  | SourceReplaceOp
  | SourceSetDataOp
  | SourceSetUrlOp
  | SourceSetTilesOp
  | SourceRemoveOp
  | LayerAddOp
  | LayerRemoveOp
  | LayerReplaceOp
  | LayerSetPropertyOp
  | LayerMoveOp
  | CameraSetOp
  | FitToOp
  | OptionSetOp
  | FallbackOp;

/** What an applied update did, by id, so hosts re-apply only where touched. */
export interface UpdateSummary {
  added: string[];
  removed: string[];
  moved: string[];
  replaced: string[];
  propertiesSet: { layerId: string; property: string }[];
  sourcesReplaced: string[];
  cameraMoved: boolean;
  rebuild: boolean;
  failures: { op: string; message: string }[];
}

/** Why a document was rejected (KTD9). */
export type RejectionKind = "validation" | "fetch" | "chunk" | "style";

export interface UpdateResult {
  outcome: "applied" | "superseded" | "rejected" | "fallback";
  summary?: UpdateSummary;
  errors?: { kind: RejectionKind; message: string; path?: string }[];
}

/** The differ's answer: the ordered operations and the summary derived from them. */
export interface DiffResult {
  changed: boolean;
  ops: UpdateOp[];
  summary: UpdateSummary;
}

/**
 * What `MapRenderer.update` hands the engine chunk (KTD10): the engine
 * reaches the map and the renderer's collaborators only through this, since
 * it imports nothing from the main bundle. The methods U2 to U4 add to the
 * collaborators are reached through the collaborators themselves.
 */
export interface UpdateHost {
  readonly map: MapLibreMap;
  readonly layerManager: LayerManager;
  readonly eventHandler: EventHandler;
  readonly legendBuilder: LegendBuilder;
  readonly paramsBuilder: ParamsBuilder | null;
  readonly controlsManager: ControlsManager;
  readonly classify: ClassifyRuntime | null;
  readonly strings: Strings;
  /** The renderer's non-fatal error path: every per-operation failure goes here too (KTD7). */
  onError(error: Error, context?: MapErrorContext): void;
  /** Detach and re-attach `@maplibre-yaml/effects` (KTD6b). */
  reattachEffects(): void;
  /**
   * The renderer's per-layer preparation before `layerManager.addLayer`,
   * the same first render does (`MapRenderer.addLayer`: the version gate,
   * protocol registration, image references, the basemap text font).
   * Returns the layer to add; `undefined` when the renderer skips it with
   * its own warning; throws when the layer cannot be added.
   */
  prepareLayer(layer: Layer): Layer | undefined;
  /** The per-layer lifecycle events first render fires, so hosts see update adds and removes alike. */
  emit(event: "layer:added" | "layer:removed", payload: { layerId: string }): void;
  /** Who owns the camera (KTD13): under `host` the engine never moves it. */
  readonly camera: "document" | "host";
  /** The runtime features the renderer builds from its own state (see {@link RuntimeHost}). */
  readonly runtime: RuntimeHost;
}

/**
 * The runtime features the engine cannot rebuild itself — they need the
 * renderer's private state (the legend's container, the panel's mount and
 * callbacks, the managers' constructors, the scene helpers) or a value
 * import the chunk must not make. The engine decides *whether* and in what
 * order each re-syncs (resync.ts, KTD6b); the renderer supplies *how*. Every
 * method is a whole-feature rebuild from the next document, never a patch.
 */
export interface RuntimeHost {
  /** Redraw the legend over `layers` under `legend` (create, redraw keeping `<details>.open`, or remove). */
  syncLegend(layers: Layer[], legend: LegendConfig | false | undefined): void;
  /** Rebuild the params panel into its mount from `layers` and the option blocks, seeded from current values. */
  syncParamsPanel(layers: Layer[], options: DocumentOptions): void;
  /** Destroy the markers and create the next block's (`undefined`: none). */
  syncMarkers(markers: MarkerConfig[] | undefined): void;
  /** Destroy the standalone popups and open the next block's (`undefined`: none). */
  syncPopups(popups: StandalonePopupConfig[] | undefined): void;
  /** Re-seed classify templates for `layerIds` from the next document and catch up (`layersReady`). */
  syncClassify(layers: Layer[], sources: Record<string, LayerSource>, layerIds: readonly string[]): void;
  /** Apply the next document's `state:` defaults for `changedKeys` (U5 adds provenance). */
  syncState(state: Record<string, unknown> | undefined, changedKeys: readonly string[]): void;
  /** Rename and re-describe the map (`locale["Map.Title"]`, the canvas's `aria-*`). */
  setTitle(title: string | undefined, description: string | undefined): void;
  /** Register `images` on the map (never rejects: a failed image warns). */
  loadImages(images: Record<string, ImageConfig>): Promise<void>;
  /** Apply or clear one 3D/projection/light block through the feature-detecting helpers. */
  applyScene(option: "projection" | "sky" | "terrain" | "light", value: unknown): void;
  /** Frame `fitTo`'s source once, now or when its data lands, as first render does. */
  fitTo(fitTo: FitToConfig, sources: Record<string, LayerSource>): void;
}

/** What `runUpdate` takes: both documents and the renderer's hints (KTD1). */
export interface UpdateRequest {
  applied: AppliedDocument;
  next: AppliedDocument;
  hints: DiffHints;
}

/** What `applyOps` needs beside the host: both documents, the operations and the summary to complete. */
export interface ApplyRequest {
  applied: AppliedDocument;
  next: AppliedDocument;
  ops: readonly UpdateOp[];
  /** The differ's summary; `applyOps` appends failures and reconciled adds to it. */
  summary: UpdateSummary;
}
