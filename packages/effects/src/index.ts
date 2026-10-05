/**
 * @file `@maplibre-yaml/effects` — EXPERIMENTAL shader effects
 * @module @maplibre-yaml/effects
 *
 * @description
 * **Experimental (0.7):** this API may change in minor releases.
 *
 * A document references an effect by name on an ordinary static layer:
 *
 * ```yaml
 * - id: buildings
 *   type: fill-extrusion
 *   ...
 *   effect: { type: tonal-hatch, gain: 0.72 }
 * ```
 *
 * Page JavaScript registers effects (documents never carry GLSL):
 *
 * ```ts
 * import { registerEffect, backends, z } from "@maplibre-yaml/effects";
 * registerEffect({
 *   type: "my-effect",
 *   backend: backends.extrusions,
 *   params: z.object({ color: z.string().default("#ff0000") }),
 *   uniforms: (p) => ({ u_color: p.color }),
 *   fragment: `vec4 effect_color(EffectInput i) { return vec4(u_color * i.diffuse, 1.0); }`,
 *   fallback: (_p, layer) => layer,
 * });
 * ```
 *
 * `import "@maplibre-yaml/effects/register"` adds the built-ins
 * (`tonal-hatch`, `blueprint`) and hooks the package into core's
 * `<ml-map>`.
 */

import { setOnRegister } from "./registry";
import { installEffectsHost } from "./host";

// registerEffect() hooks the registry into core (idempotent).
setOnRegister(installEffectsHost);

export { z } from "zod";
export { registerEffect, effectRegistry, EffectRegistry } from "./registry";
export { backends, extrusions } from "./backends";
export {
  attachEffects,
  validateEffect,
  getAttachedEffects,
  type EffectBlock,
  type EffectIssue,
  type EffectLayerRef,
  type AttachedEffect,
  type EffectsHandle,
} from "./attach";
export { createEffectsHost, installEffectsHost, type EffectsHostV1 } from "./host";
export {
  tonalHatch,
  TonalHatchParams,
  tangramExaggeration,
  blueprint,
  BlueprintParams,
  registerBuiltins,
} from "./builtins";
export {
  VERTEX_SHADER,
  FRAGMENT_PRELUDE,
  buildFragmentShader,
  resolveUniform,
  parseHexColor,
  type ResolvedUniform,
  type UniformType,
} from "./glsl";
export type {
  EffectDefinition,
  Backend,
  BackendContext,
  BackendHandle,
  AttachOptions,
  UniformValue,
  TextureSource,
  LayerSpec,
  EffectInputDoc,
} from "./contract";
