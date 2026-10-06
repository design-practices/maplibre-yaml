/**
 * @file Built-in effect: `tonal-hatch` — the Mapzen/Tangram crosshatch
 * @module @maplibre-yaml/effects
 *
 * @description
 * After Tangram's crosshatch style (tangrams/tangram-sandbox
 * `styles/crosshatch.yaml`, @patriciogv 2015, MIT) and the tangrams/blocks
 * hatch filter (MIT): stroke DENSITY follows light per face — lit faces go
 * to paper, shaded faces to dense ink — through a 3×3 atlas of nine pen
 * densities, with a noisy paper margin and inked wall outlines.
 *
 * Written against the same public `registerEffect()` API as any third-party
 * effect: nothing here is privileged.
 *
 * The atlas is a document image (`images:`), not a bundled asset — the
 * crosshatch classic ships Tangram's `hatch.png` (blocks/filter/imgs).
 */

import { z } from "zod";
import type { EffectDefinition } from "../contract";
import { extrusions } from "../backends/extrusions/backend";

const hex = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "expected a hex color like #4d4d4e");

/** Params of `tonal-hatch`. @experimental */
export const TonalHatchParams = z
  .object({
    /** Stroke and outline color. */
    ink: hex.default("#4d4d4e"),
    /** Paper (unhatched) color. */
    paper: hex.default("#f9f3e3"),
    /** Name of the 3×3 tonal atlas image in the document's `images:`. */
    atlas: z.string().min(1).default("hatch-atlas"),
    /** Exposure: brightness multiplier before the tonal lookup (~0.72 matches the reference). */
    gain: z.number().min(0).max(4).default(0.72),
    /** Wall-outline ink strength, 0 (none) – 1. */
    outline: z.number().min(0).max(1).default(0.85),
    /**
     * Apply Tangram's zoom-dependent height exaggeration,
     * `max(1, 0.5 + (1 - zoom / 20) * 5)`, on top of the layer's own
     * heights. Off by default: the crosshatch classic already encodes the
     * curve in its static `fill-extrusion-height`, which the effect honours.
     */
    exaggerate: z.boolean().default(false),
  })
  .strict();

export type TonalHatchParams = z.infer<typeof TonalHatchParams>;

/** Tangram crosshatch: position.z *= max(1, 0.5 + (1 - zoom/20) * 5). @experimental */
export const tangramExaggeration = (zoom: number): number => Math.max(1, 0.5 + (1 - zoom / 20) * 5);

/** The built-in `tonal-hatch` effect. @experimental */
export const tonalHatch: EffectDefinition<TonalHatchParams> = {
  type: "tonal-hatch",
  description: "Tangram's crosshatch: pen-stroke density follows light per face.",
  backend: extrusions,
  params: TonalHatchParams,
  textures: (p) => ({ u_atlas: p.atlas }),
  uniforms: (p) => ({ u_ink: p.ink, u_paper: p.paper, u_gain: p.gain, u_outline: p.outline }),
  heightScale: (zoom, p) => (p.exaggerate ? tangramExaggeration(zoom) : 1),
  // The static layer (a single-tone hatch pattern on every face) IS the
  // fallback: export ships it as authored.
  fallback: (_p, layer) => layer,
  animated: false,
  fragment: /* glsl */ `
vec4 effect_color(EffectInput i) {
  // Roofs take one constant texel: clean, unhatched roofs (Tangram's look).
  vec2 uv = i.isRoof ? vec2(0.5, 0.6) : i.uv;
  // Tangram's base gradient: darker toward the ground.
  float b = u_gain * i.diffuse * (clamp(uv.y * 1.5, 0.0, 1.0) + 0.2);
  float paper = 1.0 - fx_tonal(u_atlas, uv, b);
  // A noisy paper margin around each face.
  vec2 edge = vec2(0.1, 0.05) * fx_noise(uv * 20.0);
  vec2 blend = smoothstep(vec2(0.0), edge, uv) * smoothstep(vec2(0.0), edge, vec2(1.0) - uv);
  float t = mix(1.0, paper, blend.x * blend.y);
  float line = (i.isRoof ? 0.0 : 1.0) * fx_outline(uv, 1.0);
  return vec4(mix(mix(u_ink, u_paper, t), u_ink, line * u_outline), 1.0);
}
`,
};
