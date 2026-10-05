/**
 * @file Built-in effect: `blueprint` — a metre-scaled drafting grid
 * @module @maplibre-yaml/effects
 *
 * @description
 * The worked example in the Effects guide: every face gets a grid whose
 * lines sit a fixed number of METRES apart (so they never stretch with the
 * face), faint diffuse shading, and glowing edges. Roofs grid in world
 * (x, y); walls grid in (along the wall, height), the wall's direction
 * taken from the face normal. Draws the layer's true heights.
 */

import { z } from "zod";
import type { EffectDefinition } from "../contract";
import { extrusions } from "../backends/extrusions/backend";

const hex = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "expected a hex color like #cfeeff");

/** Params of `blueprint`. @experimental */
export const BlueprintParams = z
  .object({
    /** Grid and edge color. */
    line: hex.default("#cfeeff"),
    /** Face color. */
    ground: hex.default("#1a56b0"),
    /** Metres between grid lines. */
    grid: z.number().positive().max(1000).default(4),
    /** Shading exposure. */
    gain: z.number().min(0).max(4).default(0.72),
  })
  .strict();

export type BlueprintParams = z.infer<typeof BlueprintParams>;

/** The built-in `blueprint` effect. @experimental */
export const blueprint: EffectDefinition<BlueprintParams> = {
  type: "blueprint",
  description: "A metre-scaled drafting grid on every face, with glowing edges.",
  backend: extrusions,
  params: BlueprintParams,
  uniforms: (p) => ({ u_line: p.line, u_ground: p.ground, u_grid: p.grid, u_gain: p.gain }),
  fallback: (_p, layer) => layer,
  animated: false,
  fragment: /* glsl */ `
// 1 on a grid line, anti-aliased to about a pixel.
float gridLine(vec2 p) {
  vec2 w = max(fwidth(p), vec2(1e-5));
  vec2 g = abs(fract(p - 0.5) - 0.5) / w;
  return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
}

vec4 effect_color(EffectInput i) {
  // The face's own 2D frame, in metres: roofs (x, y); walls (along, up).
  vec2 q;
  if (i.isRoof) {
    q = i.world.xy;
  } else {
    vec2 along = normalize(vec2(-i.normal.y, i.normal.x));
    q = vec2(dot(i.world.xy, along), i.world.z);
  }
  q /= u_grid;
  // Fade the grid out where its lines would crowd closer than ~3 px.
  float density = max(length(fwidth(q.x)), length(fwidth(q.y)));
  float g = gridLine(q) * (1.0 - smoothstep(0.12, 0.35, density));

  float wall = i.isRoof ? 0.0 : 1.0;
  float px = fx_edge_px(i.uv, true);
  float edge = wall * (1.0 - smoothstep(0.5, 1.6, px));
  float glow = wall * exp(-px * 0.18) * 0.35;

  float shade = 0.55 + 0.45 * clamp(u_gain * i.diffuse, 0.0, 1.0);
  vec3 c = u_ground * shade;
  c = mix(c, u_line, glow);
  c = mix(c, u_line, max(g * 0.45, edge * 0.95));
  return vec4(c, 1.0);
}
`,
};
