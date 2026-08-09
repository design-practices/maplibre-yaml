/**
 * @maplibre-yaml/core/interactions
 *
 * Named-interaction registry: the type surface interactions are written
 * against, and the built-in entries dispatched by `EventHandler`.
 *
 * @packageDocumentation
 */

export type {
  InteractionContext,
  InteractionDeps,
  Interaction,
  InteractionRuntime,
  PopupContent,
  InteractiveConfig,
  ClickConfig,
  FlyToConfig,
  ZoomToFeatureConfig,
  EmitConfig,
  EmitPayload,
  InteractionHostHandlers,
} from "./types";

export {
  CLICK_INTERACTIONS,
  HOVER_INTERACTIONS,
  HOVER_FEATURE_STATE_KEY,
} from "./built-ins";

export { geometryBounds } from "./geometry-bounds";
export type { Bounds } from "./geometry-bounds";

export { InteractionRegistry, createInteractionRegistry } from "./registry";
export type { InteractionDenial } from "./registry";

export { projectInteractions } from "./manifest";
export type {
  InteractionsProjection,
  ProjectedLayerInteractions,
  ProjectedInteractiveConfig,
} from "./manifest";

export { attachInteractions } from "./attach";
export type {
  AttachInteractionsOptions,
  InteractionsHandle,
} from "./attach";
