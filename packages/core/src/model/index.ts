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
  normalizeMapBlock,
  normalizeLayer,
  normalizeSource,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "./normalize";

export { toModel } from "./to-model";
