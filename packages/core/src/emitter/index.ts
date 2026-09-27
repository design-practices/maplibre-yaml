/**
 * @file Emitter module exports
 * @module @maplibre-yaml/core/emitter
 */

export { projectStyle, EmitError } from "./project";
export { mergeBasemap, resolveBasemap } from "./basemap";
export { applyRuntimeGate } from "./modes";
export {
  DOCUMENT_SPRITE_ID,
  contentHash8,
  assetName,
  hatchTileSvg,
  buildSpriteIndex,
  attachSpriteAssets,
} from "./assets";
export type { BasemapFetcher } from "./basemap";
export type { EmitMode, EmitWarning, EmitWarningKind, EmitResult, LayerPlacement } from "./project";
export type {
  EmitAsset,
  HatchTileOptions,
  SpriteIndexEntry,
  SpriteSheetLayout,
} from "./assets";
