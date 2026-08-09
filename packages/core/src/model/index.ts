/**
 * The v2 internal model: one shape the renderer and the emitter share.
 *
 * @module model
 */

export type {
  MapModel,
  StyleHalf,
  RuntimeHalf,
  CameraModel,
  LayerModel,
  SourceModel,
  V1MapInput,
} from "./types";

export {
  SOURCE_RUNTIME_KEYS,
  LAYER_RUNTIME_KEYS,
  CAMERA_KEYS,
  partition,
  normalizeMapBlock,
  normalizeLayer,
  normalizeSource,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "./normalize";

export { toModel } from "./to-model";
export { readV2Block } from "./read-v2";

export type { SugarKey, SugarError, ExpandResult } from "./sugar";
export {
  SUGAR_KEYS,
  detectSugarKey,
  project,
  expandGeoSugar,
  isSugarError,
} from "./sugar";
