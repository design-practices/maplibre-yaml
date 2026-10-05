/**
 * @file The built-in effects: tonal-hatch and blueprint (D-A4)
 * @module @maplibre-yaml/effects
 */

import type { EffectRegistry } from "../registry";
import { tonalHatch } from "./tonal-hatch";
import { blueprint } from "./blueprint";

export { tonalHatch, TonalHatchParams, tangramExaggeration } from "./tonal-hatch";
export { blueprint, BlueprintParams } from "./blueprint";

/** Register the built-ins into a registry (skipping any already there). @experimental */
export function registerBuiltins(registry: EffectRegistry): void {
  for (const definition of [tonalHatch, blueprint]) {
    if (!registry.has(definition.type)) registry.register(definition as never);
  }
}
