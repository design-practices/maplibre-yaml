/**
 * @file Public surface of the export-class registry (0.7 doctrine, R4-R6)
 * @module @maplibre-yaml/core/export
 */

export {
  ExportClassRegistry,
  type ExportClass,
  type ExportClassDefinition,
  type ExportContext,
  type ExportLowering,
} from "./registry";

export { exportClasses } from "./registrations";
