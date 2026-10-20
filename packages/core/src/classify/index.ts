/**
 * @file `classify:` — thematic maps from YAML (0.9, ml-6x0)
 * @module @maplibre-yaml/core/classify
 */

export {
  CLASSIFY_METADATA_KEY,
  CLASSIFY_COLOR_PROPERTIES,
  DEFAULT_NO_DATA_COLOR,
  DEFAULT_OTHER_COLOR,
  resolveClassify,
  withData,
  compileClassify,
  applyClassifyToSpec,
  classifyRecordOf,
  classifyLegendEntries,
  classLabels,
  isPending,
  type ClassifyRecord,
  type ClassifyCategory,
  type ClassifyStats,
  type CompiledClassify,
  type ClassifyLegendEntry,
} from "./compile";
export {
  CLASSIFY_METHODS,
  computeBreaks,
  quantileBreaks,
  equalBreaks,
  jenksBreaks,
  numericValue,
  fieldStats,
  type ClassifyMethod,
} from "./breaks";
export {
  listPalettes,
  findPalette,
  paletteColors,
  DEFAULT_SEQUENTIAL_PALETTE,
  DEFAULT_QUALITATIVE_PALETTE,
  type PaletteData,
} from "./palettes";
export {
  lowerClassifyInModel,
  bakeClassify,
  layerDataLocation,
  updateClassifySpec,
  type ClassifyDataLoader,
  type ClassifyBakeError,
} from "./lower";
export { checkClassify } from "./checks";
