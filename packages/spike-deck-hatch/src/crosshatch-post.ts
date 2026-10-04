/**
 * @file U12 SPIKE — route 3: crosshatch as a screen-space post-process
 *
 * @description
 * MapLibre draws the buildings itself (its own fill-extrusion — no second
 * tile fetch, no deck): the static layer is recoloured to a reserved key
 * colour and lit by MapLibre's light, so each pixel's brightness IS the
 * face's diffuse term, and fill-extrusion-vertical-gradient supplies
 * Tangram's darker-at-the-base gradient. A custom layer inserted directly
 * above the buildings (below labels) then:
 *
 *  1. copies what MapLibre has drawn so far into a texture
 *     (copyTexSubImage2D from the bound framebuffer);
 *  2. draws one full-screen pass: pixels carrying the key colour become
 *     Tangram's tonal hatch (the same 9-tone atlas, brightness → density),
 *     key-colour boundaries and brightness steps become ink outlines
 *     (Sobel), everything else is discarded (left as drawn).
 *
 * Trade-off vs deck/custom-geometry routes: strokes live in SCREEN space —
 * they don't follow wall orientation and they "shower-door" (stay put while
 * the camera moves). Cost is one framebuffer copy + one full-screen pass,
 * independent of building count.
 */
import type { Map as MapLibreMap, CustomLayerInterface } from "maplibre-gl";

/**
 * Reserved key colour for building pixels: magenta (r = b) with a small
 * per-building id in green (0..21 of 255, 8 values) so the edge pass can
 * separate NEIGHBOURING buildings of equal brightness. Lighting scales all
 * three channels alike, so g/max(r,b) survives shading.
 */
const KEY = [
  "rgb",
  255,
  ["*", 3, ["%", ["+", ["to-number", ["id"], 0], ["round", ["coalesce", ["get", "render_height"], 0]]], 8]],
  255,
];

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
uniform sampler2D u_atlas;
uniform vec2 u_size;      // drawing-buffer px
uniform float u_cellPx;   // on-screen size of one hatch cell
uniform float u_gain;
out vec4 fragColor;

const vec3 INK = vec3(0.302, 0.302, 0.306);
const vec3 PAPER = vec3(0.976, 0.953, 0.890);

// Building pixel: magenta key under any white-light shading => r ~ b, g
// small. Lit roofs saturate r/b at 1.0 while the id-bearing green keeps
// scaling, so the green tolerance is generous (no other layer is magenta).
float keyMask(vec3 c) {
  float m = max(c.r, c.b);
  return (m > 0.02 && c.g < 0.35 * m + 0.02 && abs(c.r - c.b) < 0.15 * m + 0.02) ? 1.0 : 0.0;
}
float bright(vec3 c) { return max(c.r, c.b); }
// Per-building id (0..7) from the green channel, relative to brightness.
float bid(vec3 c) { return floor(c.g / max(bright(c), 1e-3) * 255.0 / 3.0 + 0.5); }

float hatch_sample(float b, vec2 st, vec2 dx, vec2 dy) {
  vec2 p = fract(vec2(floor(b * 9.0) / 3.0, floor(b * 3.0) / 3.0) + st);
  return textureGrad(u_atlas, vec2(p.x, 1.0 - p.y), dx, dy).a;
}
float getHatch(vec2 uv, float brightness) {
  vec2 st = fract(uv) / 3.0;
  vec2 dx = dFdx(uv / 3.0), dy = dFdy(uv / 3.0);
  brightness = clamp(brightness, 0.0, 0.9999999);
  float minB = clamp(brightness - 0.111111111, 0.0, 1.0);
  return mix(hatch_sample(brightness, st, dx, dy), hatch_sample(minB, st, dx, dy),
             1.0 - fract(brightness * 9.0));
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 c = texelFetch(u_frame, ivec2(px), 0).rgb;
  float here = keyMask(c);
  // Sobel over (mask, brightness): silhouettes and face-to-face steps.
  float gx = 0.0, gy = 0.0, mx = 0.0, my = 0.0, ix = 0.0, iy = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 s = texelFetch(u_frame, ivec2(px) + ivec2(i, j), 0).rgb;
    float m = keyMask(s), v = bright(s) * m;
    float wx = float(i) * (j == 0 ? 2.0 : 1.0), wy = float(j) * (i == 0 ? 2.0 : 1.0);
    gx += wx * v; gy += wy * v; mx += wx * m; my += wy * m;
    float d = m * here * step(0.5, abs(bid(s) - bid(c))); // id change inside buildings
    ix += abs(wx) * d; iy += abs(wy) * d;
  }
  float faceEdge = max(step(0.08, length(vec2(gx, gy))), step(0.5, ix + iy));
  float silhouette = step(0.5, length(vec2(mx, my)));
  if (here < 0.5) {
    // Outside buildings: only the silhouette line may spill one pixel out.
    if (silhouette < 0.5) discard;
    fragColor = vec4(INK, 1.0);
    return;
  }
  float b = u_gain * bright(c);
  float pattern = 1.0 - getHatch(px / u_cellPx, b);
  vec3 col = mix(INK, PAPER, pattern);
  col = mix(col, INK, max(faceEdge, silhouette) * 0.85);
  fragColor = vec4(col, 1.0);
}`;

export interface PostHandle {
  layerId: string;
  beforeId: string | undefined;
  placementOk: boolean;
  loaded(): Promise<void>;
  destroy(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`[crosshatch-post] shader: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

export async function attachCrosshatchPost(
  map: MapLibreMap,
  doc: { layers: Array<{ id: string; "x-effect"?: { type: string; gain?: number } }> },
  opts: { atlasUrl: string; cellPx?: number; gainScale?: number }
): Promise<PostHandle> {
  const layer = doc.layers.find((l) => l["x-effect"]?.type === "crosshatch-buildings");
  if (!layer) throw new Error("[crosshatch-post] no crosshatch-buildings effect in the document");
  const atlas = await createImageBitmap(await (await fetch(opts.atlasUrl)).blob());
  // Same knob as the deck route (0.72 = reference tone there); MapLibre's
  // light saturates lit faces near 1.0, so this route needs ~0.72 x 1.05.
  const gain = (layer["x-effect"]!.gain ?? 0.72) * (opts.gainScale ?? 1.05);

  if (!map.isStyleLoaded()) await new Promise<void>((r) => map.once("idle", () => r()));
  const order = map.getLayersOrder();
  const idx = order.indexOf(layer.id);
  const beforeId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;

  // Recolour the static layer to the key; MapLibre's light + vertical
  // gradient now encode Tangram's brightness per face.
  const saved = {
    pattern: map.getPaintProperty(layer.id, "fill-extrusion-pattern"),
    color: map.getPaintProperty(layer.id, "fill-extrusion-color"),
    light: map.getLight?.(),
  };
  map.setPaintProperty(layer.id, "fill-extrusion-pattern", undefined as never);
  map.setPaintProperty(layer.id, "fill-extrusion-color", KEY as never);
  // Tangram's key light: from the south, above (dir [0.2,0.7,-0.5] + point).
  map.setLight({ anchor: "map", color: "#ffffff", intensity: 0.55, position: [1.5, 200, 40] });

  let program: WebGLProgram, vao: WebGLVertexArrayObject, frameTex: WebGLTexture, atlasTex: WebGLTexture;
  let texW = 0, texH = 0;
  const id = `${layer.id}__post`;
  const custom: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "2d",
    onAdd(_map, glAny) {
      const gl = glAny as WebGL2RenderingContext;
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`[crosshatch-post] link: ${gl.getProgramInfoLog(program)}`);
      }
      vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      frameTex = gl.createTexture()!;
      atlasTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    },
    render(glAny) {
      const gl = glAny as WebGL2RenderingContext;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      if (w !== texW || h !== texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        texW = w; texH = h;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);

      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "u_atlas"), 1);
      gl.uniform2f(gl.getUniformLocation(program, "u_size"), w, h);
      gl.uniform1f(gl.getUniformLocation(program, "u_cellPx"), (opts.cellPx ?? 170) * devicePixelRatio);
      gl.uniform1f(gl.getUniformLocation(program, "u_gain"), gain);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
  map.addLayer(custom, beforeId);
  const after = map.getLayersOrder();
  const placementOk = after[after.indexOf(id) - 1] === layer.id && (!beforeId || after[after.indexOf(id) + 1] === beforeId);

  return {
    layerId: layer.id,
    beforeId,
    placementOk,
    loaded: () => new Promise<void>((r) => (map.loaded() ? r() : map.once("idle", () => r()))),
    destroy() {
      if (map.getLayer(id)) map.removeLayer(id);
      map.setPaintProperty(layer.id, "fill-extrusion-color", saved.color as never);
      map.setPaintProperty(layer.id, "fill-extrusion-pattern", saved.pattern as never);
      if (saved.light) map.setLight(saved.light);
    },
  };
}
