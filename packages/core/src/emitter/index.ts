/**
 * @file Emitter module exports
 * @module @maplibre-yaml/core/emitter
 */

export { projectStyle, EmitError } from "./project";
export { mergeBasemap, resolveBasemap } from "./basemap";
export { applyRuntimeGate } from "./modes";
export {
  DOCUMENT_SPRITE_ID,
  DEFAULT_PIN_COLOR,
  contentHash8,
  assetName,
  hatchTileSvg,
  pinSvg,
  buildSpriteIndex,
  attachSpriteAssets,
  attachSpriteImages,
  dedupeAssets,
  finalizeSpriteBaseUrl,
  imageAssetName,
  DEFAULT_PIN_WIDTH,
  DEFAULT_PIN_HEIGHT,
} from "./assets";
export {
  lowerMarkers,
  buildMarkersLowering,
  MARKERS_SOURCE_ID,
  MARKERS_LAYER_ID,
} from "./lower-markers";
export type { LoweredMarkers, MarkersLowering } from "./lower-markers";
export {
  lowerFitTo,
  buildFitToLowering,
  cameraForBounds,
  FIT_TO_REFERENCE_VIEWPORT,
} from "./lower-fit-to";
export type { LoweredFitTo, FitToLowering } from "./lower-fit-to";
export type { PinOptions } from "./assets";
export type { BasemapFetcher } from "./basemap";
export type { EmitMode, EmitWarning, EmitWarningKind, EmitResult, LayerPlacement } from "./project";
export type {
  EmitAsset,
  EmitImageRef,
  HatchTileOptions,
  SpriteIndexEntry,
  SpriteLayoutItem,
  SpriteSheetLayout,
} from "./assets";
