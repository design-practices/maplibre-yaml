/**
 * flow-lines — animated dashes traveling along line features in their
 * digitized direction. Civic use cases: water/sewer flow, one-way streets,
 * bus route direction, pedestrian desire lines.
 *
 * YAML:
 *   runtime:
 *     effects:
 *       storm-sewers:
 *         layer: sewers
 *         type: flow-lines
 *         speed: 0.6
 *         dash: 24
 *         width: 3
 *         color: $color.primary
 *
 * Why this is the canonical "animated" example: its fallback is nearly
 * lossless. A moving dash degrades to a static dash — same geometry, same
 * palette, minus motion. The eject story costs almost nothing here.
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
  lineToQuads,
  compileProgram,
  bindAttributes,
  setUniforms,
  setProjectionUniforms,
  type AttributeBuffer,
} from "../util";

const paramsSchema = z.object({
  speed: z.number().min(0).max(5).default(0.5), // dash periods / second
  dash: z.number().min(4).max(128).default(24), // dash period in px
  duty: z.number().min(0.1).max(0.9).default(0.5), // lit fraction of period
  width: z.number().min(0.5).max(24).default(3), // px
  color: z.string().default("#2b6cb0"), // may be a $global token
});
type Params = z.infer<typeof paramsSchema>;

const VERT = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;        // web-mercator 0..1
in vec2 a_normal;     // miter-scaled extrusion normal
in float a_progress;  // cumulative distance along line, mercator units
uniform float u_width_px;
uniform vec2 u_inv_viewport; // 2 / viewport px
out float v_progress;
void main() {
  vec4 p = projectTile(a_pos);
  // extrude in clip space so width stays constant in px at any zoom
  p.xy += a_normal * u_width_px * u_inv_viewport * p.w;
  v_progress = a_progress;
  gl_Position = p;
}`;

const FRAG = `#version 300 es
precision mediump float;
in float v_progress;
uniform float u_time;       // seconds
uniform float u_speed;      // dash periods / second
uniform float u_dash_merc;  // dash period in mercator units at current zoom
uniform float u_duty;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  float phase = fract(v_progress / u_dash_merc - u_time * u_speed);
  float lit = step(phase, u_duty);
  // soft trailing edge so motion doesn't shimmer
  float edge = smoothstep(u_duty, u_duty - 0.08, phase);
  float a = max(lit * 0.55, edge);
  fragColor = vec4(u_color.rgb, u_color.a * a);
}`;

function create(params: Params, ctx: EffectContext): CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let attributes: AttributeBuffer[] = [];
  let vertexCount = 0;
  let variant = ""; // cache key: shaderData.variantName (mercator vs globe)
  const start = performance.now();
  const color = resolveColor(params.color, ctx.globals);

  return {
    id: `${ctx.layerId}__fx`,
    type: "custom",
    renderingMode: "2d",

    onAdd(_map, gl: WebGL2RenderingContext) {
      // Tessellate once: whole-source contract means data is already local.
      const { positions, normals, progress } = lineToQuads(ctx.data);
      vertexCount = positions.length / 2;
      vao = gl.createVertexArray();
      const make = (data: Float32Array): WebGLBuffer => {
        const buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return buf;
      };
      attributes = [
        { name: "a_pos", buffer: make(positions), size: 2 },
        { name: "a_normal", buffer: make(normals), size: 2 },
        { name: "a_progress", buffer: make(progress), size: 1 },
      ];
      // attribute pointers are bound per-program in render(): locations
      // are program-specific and the program varies with projection.
    },

    // Modern signature: MapLibre passes projection shader data per frame so
    // the same effect works under mercator and globe without forking code.
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
      }
      gl.useProgram(program);
      setProjectionUniforms(gl, program, defaultProjectionData);

      const t = (performance.now() - start) / 1000;
      // px → mercator: world is tileSize * 2^z px wide and 1 mercator unit.
      const worldPx = 512 * Math.pow(2, ctx.map.getZoom());
      setUniforms(gl, program, {
        u_time: t,
        u_speed: params.speed,
        u_duty: params.duty,
        u_width_px: params.width * (globalThis.devicePixelRatio ?? 1),
        u_dash_merc: params.dash / worldPx,
        u_color: color,
        u_inv_viewport: [2 / gl.canvas.width, 2 / gl.canvas.height],
      });

      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

      // Animation contract: request the next frame explicitly.
      ctx.map.triggerRepaint();
    },

    onRemove(_map, gl: WebGL2RenderingContext) {
      if (program) gl.deleteProgram(program);
      if (vao) gl.deleteVertexArray(vao);
      for (const a of attributes) gl.deleteBuffer(a.buffer);
    },
  };
}

/**
 * Fallback: static dashed line. Near-lossless — identical color, width,
 * and dash rhythm; only motion is lost. line-dasharray units are multiples
 * of line width, hence the division.
 */
function fallback(
  params: Params,
  globals: Record<string, unknown>,
): FallbackResult {
  const period = params.dash / params.width;
  return {
    layers: [
      {
        type: "line",
        layout: { "line-cap": "round" },
        paint: {
          "line-color": resolveColor(params.color, globals, "css"),
          "line-width": params.width,
          "line-dasharray": [period * params.duty, period * (1 - params.duty)],
          "line-opacity": 0.85,
        },
      },
    ],
  };
}

registerEffect<Params>({
  type: "flow-lines",
  description: "Dashes travel along lines in digitized direction",
  geometry: ["line"],
  paramsSchema,
  ui: {
    speed: {
      label: "Flow speed",
      control: "slider",
      min: 0,
      max: 5,
      step: 0.1,
    },
    dash: {
      label: "Dash length",
      control: "slider",
      min: 4,
      max: 128,
      unit: "px",
    },
    duty: {
      label: "Dash density",
      control: "slider",
      min: 0.1,
      max: 0.9,
      step: 0.05,
    },
    width: { label: "Width", control: "slider", min: 0.5, max: 24, unit: "px" },
    color: { label: "Color", control: "color" },
  },
  requirements: { webgl2: true },
  create,
  fallback,
});
