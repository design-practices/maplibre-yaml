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
} from "./types";
export { defineInteraction, stateless } from "./types";

export {
  CLICK_INTERACTIONS,
  HOVER_INTERACTIONS,
  HOVER_FEATURE_STATE_KEY,
} from "./built-ins";

export { InteractionRegistry, createInteractionRegistry } from "./registry";
export type { InteractionDenial } from "./registry";
