/**
 * @file Public surface of the eject-class registry (0.7 doctrine, R4-R6)
 * @module @maplibre-yaml/core/eject
 */

export {
  EjectClassRegistry,
  type EjectClass,
  type EjectClassDefinition,
  type EjectContext,
  type EjectLowering,
  type EjectAssetDescriptor,
} from "./registry";

export { ejectClasses } from "./registrations";
