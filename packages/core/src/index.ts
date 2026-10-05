/**
 * Declarative web maps with YAML configuration: the schemas, parser,
 * renderer, interactions, and data layer behind `<ml-map>`.
 *
 * The `<ml-map>` element itself lives in `@maplibre-yaml/core/components`
 * (or auto-registers via `@maplibre-yaml/core/register`); the Zod schemas are
 * also available standalone from `@maplibre-yaml/core/schemas`.
 *
 * @module @maplibre-yaml/core
 */

// Schemas
export * from "./schemas";

// Parser
export * from "./parser";

// Renderer
export * from "./renderer";

// Interactions — the named-interaction registry (types + built-in entries).
// Previously barrel-private inside renderer/; made public here.
export * from "./interactions";

// Data
export * from "./data";

// UI
export * from "./ui";

// The v2 internal model — public because it is the emitter's input type
// (`projectStyle(model)`), so ejecting requires it. Named rather than
// `export *`, so widening the surface is a deliberate edit, not a side effect
// of adding a file under model/.
export {
  normalizeMapBlock,
  toModel,
  readV2Block,
  normalizeLayer,
  normalizeSource,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
  SOURCE_RUNTIME_KEYS,
  LAYER_RUNTIME_KEYS,
} from "./model";
export type {
  MapModel,
  StyleHalf,
  RuntimeHalf,
  CameraModel,
  LayerModel,
  SourceModel,
  V1MapInput,
} from "./model";
// GeoJSON authoring sugar (location/locations/region/route) — surfaced at the
// package root so `@maplibre-yaml/astro` can single-source its base-Feature
// shape against the core expander (U4/ml-4jq). U1 exported these from
// `./model` but not from the package root, which uses explicit named
// re-exports rather than `export *`; without this line the API is unreachable
// from `@maplibre-yaml/core`.
export {
  SUGAR_KEYS,
  detectSugarKey,
  project,
  expandGeoSugar,
  isSugarError,
} from "./model";
export type { SugarKey, SugarError, ExpandResult } from "./model";

// Extension registry — validated, normalized `x-*` blocks
export { ExtensionRegistry } from "./extensions";
export type {
  ExtensionDefinition,
  ExtensionBlock,
  ExtensionWarning,
  ExtractResult,
} from "./extensions";

// Emitter — projects the model's style half to spec-valid style.json
export {
  projectStyle,
  EmitError,
  mergeBasemap,
  resolveBasemap,
  applyRuntimeGate,
  DOCUMENT_SPRITE_ID,
  contentHash8,
  assetName,
  hatchTileSvg,
  pinSvg,
  lowerMarkers,
  buildMarkersLowering,
  MARKERS_SOURCE_ID,
  MARKERS_LAYER_ID,
  lowerFitTo,
  buildFitToLowering,
  cameraForBounds,
  FIT_TO_REFERENCE_VIEWPORT,
  DEFAULT_PIN_COLOR,
  buildSpriteIndex,
  attachSpriteAssets,
  attachSpriteImages,
  dedupeAssets,
  finalizeSpriteBaseUrl,
  imageAssetName,
  DEFAULT_PIN_WIDTH,
  DEFAULT_PIN_HEIGHT,
} from "./emitter";
export type {
  EmitAsset,
  EmitImageRef,
  HatchTileOptions,
  PinOptions,
  LoweredMarkers,
  MarkersLowering,
  LoweredFitTo,
  FitToLowering,
  SpriteIndexEntry,
  SpriteLayoutItem,
  SpriteSheetLayout,
} from "./emitter";
export {
  EjectClassRegistry,
  ejectClasses,
  type EjectClass,
  type EjectClassDefinition,
  type EjectContext,
  type EjectLowering,
} from "./eject";
export type {
  EmitMode,
  EmitWarning,
  EmitWarningKind,
  EmitResult,
  LayerPlacement,
  BasemapFetcher,
} from "./emitter";

// Effects host hook (experimental, 0.7) — how @maplibre-yaml/effects plugs in
// without core importing it. Also the `effect:` lowering the emitter uses.
export {
  registerEffectsHost,
  getEffectsHost,
  onEffectsHost,
} from "./effects-host";
export type {
  EffectsHost,
  EffectBlock,
  EffectIssue,
  EffectLayerRef,
  EffectsAttachment,
} from "./effects-host";
export { lowerEffectLayer, EFFECT_ON_EMIT } from "./emitter/lower-effects";
export type { EffectLowering } from "./emitter/lower-effects";

// Capability policy — what a document may do, given where it is compiled
export {
  STATE_RUNTIME_FLOOR,
  TERRAIN_RUNTIME_FLOOR,
  SKY_RUNTIME_FLOOR,
  GLOBE_RUNTIME_FLOOR,
  COLOR_RELIEF_RUNTIME_FLOOR,
  DEFAULT_POLICY,
  meetsVersion,
  supportsState,
  allowsHtml,
  allowsOrigin,
} from "./capabilities";
export type { CapabilityPolicy, TrustContext } from "./capabilities";

// Utils
export { escapeHtml, safeUrl, POPUP_TAGS, LINK_TARGETS, html, isHtmlMarker } from "./utils/html";
export type { HtmlMarker } from "./utils/html";
export { EventEmitter } from "./utils/event-emitter";
export type { EventHandler } from "./utils/event-emitter";
export {
  resolveMapConfig,
  resolveMapBlock,
  isMapConfigComplete,
  createSimpleMapConfig,
  ConfigResolutionError,
} from "./utils/config-resolver";

// Note: Components are exported separately via './components' entry point
// to avoid auto-registering custom elements when not needed
