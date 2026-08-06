/**
 * hatch-fill — procedural cross-hatching for polygons, screen-aligned so
 * stroke density stays constant as you zoom (the property that makes shader
 * hatching feel hand-drawn, and that fill-pattern alone can't provide
 * because patterns scale with tiles).
 *
 * Civic use cases: proposed/under-review parcels, phasing diagrams,
 * "area of study" overlays — the planner's hatch, finally native.
 *
 * YAML:
 *   runtime:
 *     effects:
 *       study-area:
 *         layer: parcels-proposed
 *         type: hatch-fill
 *         angle: 45
 *         spacing: 8
 *         thickness: 1.2
 *         cross: true
 *         color: $color.ink
 *
 * Why this is the canonical "static shader" example: it never animates
 * (no triggerRepaint), and its fallback demonstrates the SpriteRequest
 * path — the compiler rasterizes a deterministic SVG hatch tile into the
 * project sprite sheet and emits a plain fill-pattern layer. Degradation
 * is visible (pattern scales with zoom instead of staying screen-fixed)
 * but faithful in spirit, and it proves fallbacks can carry assets.
 */

import { z } from "zod";
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
} from "maplibre-gl";
import {
  registerEffect,
  type EffectContext,
  type FallbackResult,
} from "../types";
import {
  resolveColor,
  polygonsToTriangles,
  compileProgram,
  bindAttributes,
  setUniforms,
  setProjectionUniforms,
  type AttributeBuffer,
  type RGBA,
} from "../util";

const paramsSchema = z.object({
  angle: z.number().min(0).max(180).default(45),
  spacing: z.number().min(3).max(48).default(8), // px between strokes
  thickness: z.number().min(0.5).max(6).default(1.2), // px
  cross: z.boolean().default(false), // second pass at +90°
  color: z.string().default("#1a202c"),
  background: z.string().nullable().default(null), // optional wash behind
});
type Params = z.infer<typeof paramsSchema>;

const VERT = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;
void main() { gl_Position = projectTile(a_pos); }`;

// Screen-space hatching: stripe field computed from gl_FragCoord, clipped
// to the polygon by the geometry itself. Distance-to-stripe gives
// antialiased strokes at any density.
const FRAG = `#version 300 es
precision mediump float;
uniform float u_angle;      // radians
uniform float u_spacing;    // device px
uniform float u_thickness;  // device px
uniform bool  u_cross;
uniform vec4  u_ink;
uniform vec4  u_wash;       // a=0 disables
out vec4 fragColor;

float stripes(vec2 p, float angle) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float d = dot(p, vec2(-dir.y, dir.x));                 // signed dist across strokes
  float m = abs(fract(d / u_spacing) - 0.5) * u_spacing; // px to nearest line
  return 1.0 - smoothstep(u_thickness * 0.5 - 0.5, u_thickness * 0.5 + 0.5, m);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float ink = stripes(p, u_angle);
  if (u_cross) ink = max(ink, stripes(p, u_angle + 1.5707963));
  vec3 rgb = mix(u_wash.rgb, u_ink.rgb, ink);
  float a = max(ink * u_ink.a, u_wash.a);
  fragColor = vec4(rgb, a);
}`;

function create(params: Params, ctx: EffectContext): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let attributes: AttributeBuffer[] = [];
  let indexBuffer: WebGLBuffer | null = null;
  let indexCount = 0;
  let variant = "";
  const ink = resolveColor(params.color, ctx.globals);
  const wash: RGBA = params.background
    ? resolveColor(params.background, ctx.globals)
    : [0, 0, 0, 0];

  return {
    id: `${ctx.layerId}__fx`,
    type: "custom",
    renderingMode: "2d",

    onAdd(_map, gl: WebGL2RenderingContext) {
      const { positions, indices } = polygonsToTriangles(ctx.data);
      indexCount = indices.length;
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const pbuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      attributes = [{ name: "a_pos", buffer: pbuf, size: 2 }];

      indexBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    },

    render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
      const { shaderData, defaultProjectionData } = args as any;
      if (!vao) return;
      if (!program || variant !== shaderData.variantName) {
        variant = shaderData.variantName;
        if (program) gl.deleteProgram(program);
        program = compileProgram(
          gl,
          VERT(shaderData.vertexShaderPrelude, shaderData.define),
          FRAG,
        );
        bindAttributes(gl, program, vao, attributes);
        // element array binding is VAO state; ensure it's attached
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      }
      gl.useProgram(program);
      setProjectionUniforms(gl, program, defaultProjectionData);

      const dpr = globalThis.devicePixelRatio ?? 1;
      setUniforms(gl, program, {
        u_angle: (params.angle * Math.PI) / 180,
        u_spacing: params.spacing * dpr,
        u_thickness: params.thickness * dpr,
        u_cross: params.cross,
        u_ink: ink,
        u_wash: wash,
      });

      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      // NOTE: no triggerRepaint — static effects render only on map redraws.
    },

    onRemove(_map, gl: WebGL2RenderingContext) {
      if (program) gl.deleteProgram(program);
      if (vao) gl.deleteVertexArray(vao);
      for (const a of attributes) gl.deleteBuffer(a.buffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
    },
  };
}

/**
 * Fallback: generated hatch sprite + fill-pattern layer. The SVG is a
 * deterministic function of params, so builds are reproducible and the
 * sprite name is param-derived (debuggable; see open question on
 * content-addressing in the proposal doc).
 */
function fallback(
  params: Params,
  globals: Record<string, unknown>,
): FallbackResult {
  const size = params.spacing * 2;
  const css = resolveColor(params.color, globals, "css");
  const strokes = [
    hatchLine(size, params.angle, params.thickness, css),
    ...(params.cross
      ? [hatchLine(size, params.angle + 90, params.thickness, css)]
      : []),
  ].join("");
  const name = `fx-hatch-${params.angle}-${params.spacing}-${params.thickness}${
    params.cross ? "-x" : ""
  }`;
  return {
    sprites: [
      {
        name,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${strokes}</svg>`,
      },
    ],
    layers: [
      ...(params.background
        ? [
            {
              type: "fill" as const,
              idSuffix: "wash",
              paint: {
                "fill-color": resolveColor(params.background, globals, "css"),
              },
            },
          ]
        : []),
      {
        type: "fill" as const,
        paint: { "fill-pattern": name, "fill-opacity": 1 },
      },
    ],
  };
}

/** One stroke through the tile center at the given angle, tiling seamlessly. */
function hatchLine(
  size: number,
  angleDeg: number,
  w: number,
  color: string,
): string {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a) * size * 1.5;
  const dy = Math.sin(a) * size * 1.5;
  const cx = size / 2;
  const cy = size / 2;
  return `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${
    cy + dy
  }" stroke="${color}" stroke-width="${w}"/>`;
}

registerEffect<Params>({
  type: "hatch-fill",
  description: "Screen-aligned procedural cross-hatching for polygons",
  geometry: ["polygon"],
  paramsSchema,
  ui: {
    angle: { label: "Angle", control: "slider", min: 0, max: 180, unit: "°" },
    spacing: {
      label: "Spacing",
      control: "slider",
      min: 3,
      max: 48,
      unit: "px",
    },
    thickness: {
      label: "Stroke",
      control: "slider",
      min: 0.5,
      max: 6,
      step: 0.1,
      unit: "px",
    },
    cross: { label: "Cross-hatch", control: "toggle" },
    color: { label: "Ink", control: "color" },
    background: { label: "Wash", control: "color" },
  },
  requirements: { webgl2: true },
  create,
  fallback,
});
