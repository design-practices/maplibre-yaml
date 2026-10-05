/**
 * @file Shader assembly — the library half of every effect's GLSL
 * @module @maplibre-yaml/effects
 *
 * @description
 * An effect supplies only `vec4 effect_color(EffectInput i)`. This module
 * wraps it: the vertex stage (shared by every effect on the extrusions
 * backend), the `EffectInput` struct, the `fx_*` helpers, the uniform and
 * sampler declarations inferred from the effect's `uniforms()`/`textures()`,
 * and `main()`. The effect's source is appended last under `#line 1`, so a
 * compile error's line number points into the author's own string.
 */

import type { UniformValue } from "./contract";

/** GLSL type of an inferred uniform. @experimental */
export type UniformType = "float" | "bool" | "vec2" | "vec3" | "vec4";

/** A uniform after inference: its GLSL type and the numbers to upload. @experimental */
export interface ResolvedUniform {
  name: string;
  type: UniformType;
  value: number[];
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = /^(gl_|fx_|u_fx_)/;

/** `#rgb` / `#rrggbb` → 0–1 RGB, or null. @experimental */
export function parseHexColor(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Check a uniform/sampler name an effect chose. */
export function checkUniformName(effect: string, name: string): void {
  if (!NAME.test(name)) {
    throw new Error(`[effects] ${effect}: "${name}" is not a valid GLSL identifier.`);
  }
  if (RESERVED.test(name)) {
    throw new Error(
      `[effects] ${effect}: "${name}" uses a reserved prefix (gl_, fx_, u_fx_ belong to the library).`
    );
  }
}

/** Infer one uniform's GLSL type from its value. @experimental */
export function resolveUniform(effect: string, name: string, value: UniformValue): ResolvedUniform {
  checkUniformName(effect, name);
  if (typeof value === "number") return { name, type: "float", value: [value] };
  if (typeof value === "boolean") return { name, type: "bool", value: [value ? 1 : 0] };
  if (typeof value === "string") {
    const rgb = parseHexColor(value);
    if (!rgb) {
      throw new Error(
        `[effects] ${effect}: uniform "${name}" is the string ${JSON.stringify(value)}; ` +
          "only hex colors (#rgb, #rrggbb) convert to a uniform."
      );
    }
    return { name, type: "vec3", value: rgb };
  }
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((v) => typeof v === "number")) {
    return { name, type: `vec${value.length}` as UniformType, value: [...value] };
  }
  throw new Error(
    `[effects] ${effect}: uniform "${name}" has an unsupported value ${JSON.stringify(value)} ` +
      "(use a number, boolean, hex color, or a 2–4 number array)."
  );
}

/**
 * The shared vertex stage.
 *
 * Attributes (packed, 20 bytes — see backends/extrusions/vertex-format.ts):
 * `a_posz` = (x, y) tile position × posScale and this vertex's height at the
 * tile's zoom and zoom + 1 (metres × 16), all uint16 — heights evaluated
 * from the static layer's own expressions, MapLibre's composite-expression
 * scheme; `a_uv` = (u along the whole wall, v up the wall); `a_fh` = the
 * face height at zoom and zoom + 1; `a_nrm` = the outward normal, (0, 0)
 * marking a roof; `a_facew` = the whole wall's length in metres.
 *
 * @experimental
 */
export const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_posz;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec2 a_fh;
layout(location = 3) in vec2 a_nrm;
layout(location = 4) in float a_facew;
uniform mat4 u_fx_matrix;   // tile units (x, y) + metres (z) -> clip
uniform float u_fx_unit;    // tile units per position unit (1 / posScale)
uniform float u_fx_zt;      // zoom interpolation factor between the two heights
uniform float u_fx_zex;     // heightScale
uniform float u_fx_mpu;     // metres per tile unit
uniform vec2 u_fx_origin;   // tile's north-west corner, metres from the anchor (x east, y north)
invariant gl_Position;      // the depth prepass and the colour pass must agree exactly
out vec2 fx_v_uv;
out vec2 fx_v_face;
out vec3 fx_v_normal;
out float fx_v_diffuse;
out vec3 fx_v_world;
out float fx_v_roof;
// Tangram crosshatch's lights, fixed in a north-up world frame: a
// directional light (-0.2, -0.7, 0.5) and a point light south of and above
// the scene (0, -1, 1), both pre-normalized.
const vec3 FX_LD = vec3(-0.2264554, -0.7925939, 0.5661385);
const vec3 FX_LP = vec3(0.0, -0.7071068, 0.7071068);
void main() {
  vec2 pos = a_posz.xy * u_fx_unit;
  float z = mix(a_posz.z, a_posz.w, u_fx_zt) * (0.0625 * u_fx_zex);
  bool roof = a_nrm.x == 0.0 && a_nrm.y == 0.0;
  vec3 n = roof ? vec3(0.0, 0.0, 1.0) : vec3(normalize(a_nrm), 0.0);
  fx_v_normal = n;
  fx_v_diffuse = max(0.0, dot(n, FX_LD)) + 0.5 * max(0.0, dot(n, FX_LP));
  fx_v_uv = roof ? vec2(0.5) : a_uv;
  fx_v_face = vec2(a_facew, mix(a_fh.x, a_fh.y, u_fx_zt) * u_fx_zex);
  fx_v_roof = roof ? 1.0 : 0.0;
  fx_v_world = vec3(u_fx_origin + vec2(pos.x, -pos.y) * u_fx_mpu, z);
  gl_Position = u_fx_matrix * vec4(pos, z, 1.0);
}`;

/**
 * The depth prepass's vertex stage: one 8-byte attribute. Its
 * `gl_Position` is computed by exactly the same expressions as
 * {@link VERTEX_SHADER}'s, and both are `invariant`, so the colour pass's
 * depth test (LEQUAL) passes only the front-most fragment.
 *
 * @experimental
 */
export const DEPTH_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_posz;
uniform mat4 u_fx_matrix;
uniform float u_fx_unit;
uniform float u_fx_zt;
uniform float u_fx_zex;
invariant gl_Position;
void main() {
  vec2 pos = a_posz.xy * u_fx_unit;
  float z = mix(a_posz.z, a_posz.w, u_fx_zt) * (0.0625 * u_fx_zex);
  gl_Position = u_fx_matrix * vec4(pos, z, 1.0);
}`;

/** Depth-only fragment stage for the prepass. */
export const DEPTH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 fx_fragColor;
void main() { fx_fragColor = vec4(0.0); }`;

/**
 * The `EffectInput` struct and the `fx_*` helpers, available to every
 * effect's fragment.
 *
 * @experimental
 */
export const FRAGMENT_PRELUDE = `struct EffectInput {
  vec2 uv;
  vec2 faceSize;
  vec3 normal;
  float diffuse;
  float height;
  bool isRoof;
  vec2 screen;
  float time;
  vec3 world;
};

float fx_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Smooth value noise in [0, 1].
float fx_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fx_hash(i), fx_hash(i + vec2(1.0, 0.0)), u.x),
             mix(fx_hash(i + vec2(0.0, 1.0)), fx_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fx_tonal_cell(sampler2D atlas, float b, vec2 st, vec2 dx, vec2 dy) {
  vec2 p = fract(vec2(floor(b * 9.0) / 3.0, floor(b * 3.0) / 3.0) + st);
  return textureGrad(atlas, vec2(p.x, 1.0 - p.y), dx, dy).a;
}

// Tonal lookup in a 3x3 atlas of 9 ink densities (Tangram's hatch atlas):
// the ink coverage (0 = paper, 1 = ink) for a brightness in [0, 1], blended
// between the two nearest tones. The mip level follows the MINOR derivative
// axis, so strokes on long thin faces don't smear (cheap anti-aliasing;
// hardware anisotropy costs ~3x in software GL).
float fx_tonal(sampler2D atlas, vec2 uv, float brightness) {
  vec2 st = fract(uv) / 3.0;
  vec2 dx = dFdx(uv / 3.0), dy = dFdy(uv / 3.0);
  float lx = length(dx), ly = length(dy);
  float k = min(lx, ly) / max(max(lx, ly), 1e-8);
  dx *= k; dy *= k;
  brightness = clamp(brightness, 0.0, 0.9999999);
  float lower = clamp(brightness - 0.111111111, 0.0, 1.0);
  return mix(fx_tonal_cell(atlas, brightness, st, dx, dy),
             fx_tonal_cell(atlas, lower, st, dx, dy),
             1.0 - fract(brightness * 9.0));
}

// Distance in pixels to the nearest face edge: left, right and top always;
// the bottom edge too when \`bottom\` is true.
float fx_edge_px(vec2 uv, bool bottom) {
  vec2 fw = max(fwidth(uv), vec2(1e-5));
  float d = min(min(uv.x, 1.0 - uv.x) / fw.x, (1.0 - uv.y) / fw.y);
  return bottom ? min(d, uv.y / fw.y) : d;
}

// Anti-aliased face outline of about \`widthPx\` pixels (1 = on the line).
float fx_outline(vec2 uv, float widthPx) {
  return 1.0 - smoothstep(widthPx - 0.4, widthPx + 0.4, fx_edge_px(uv, false));
}
`;

/** Assemble an effect's full fragment shader. @experimental */
export function buildFragmentShader(
  fragment: string,
  uniforms: ResolvedUniform[],
  samplers: string[]
): string {
  const decls = [
    ...uniforms.map((u) => `uniform ${u.type} ${u.name};`),
    ...samplers.map((s) => `uniform sampler2D ${s};`),
  ].join("\n");
  // gl_FragCoord is read only when the effect uses `screen`: under ANGLE it
  // can cost the early depth test, so the depth prepass stops saving shading.
  const usesScreen = /\.screen\b/.test(fragment);
  return `#version 300 es
precision highp float;
in vec2 fx_v_uv;
in vec2 fx_v_face;
in vec3 fx_v_normal;
in float fx_v_diffuse;
in vec3 fx_v_world;
in float fx_v_roof;
uniform float u_fx_time;
${decls}
${FRAGMENT_PRELUDE}
out vec4 fx_fragColor;
vec4 effect_color(EffectInput i);
void main() {
  EffectInput i;
  i.uv = fx_v_uv;
  i.faceSize = fx_v_face;
  i.normal = fx_v_normal;
  i.diffuse = fx_v_diffuse;
  i.height = fx_v_world.z;
  i.isRoof = fx_v_roof > 0.5;
  i.screen = ${usesScreen ? "gl_FragCoord.xy" : "vec2(0.0)"};
  i.time = u_fx_time;
  i.world = fx_v_world;
  fx_fragColor = effect_color(i);
}
#line 1
${fragment}
`;
}
