/**
 * @maplibre-yaml/effects — shared runtime utilities (full implementation)
 *
 * The "unglamorous ~200 lines" the effect examples depend on: color token
 * resolution, WebGL program plumbing, MapLibre projection uniforms, and
 * geometry tessellation (line quads with approximate miter joins; polygon
 * triangulation via earcut).
 */

import earcut from "earcut";
import type { FeatureCollection, Position } from "geojson";

/* ------------------------------------------------------------------ */
/* Color resolution                                                    */
/* ------------------------------------------------------------------ */

export type RGBA = [number, number, number, number];

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  transparent: "#00000000",
};

/**
 * Resolve a color that may be a `$path.to.token` reference into globals,
 * then parse it. format 'vec4' (default) → premultipliable [r,g,b,a] 0..1;
 * format 'css' → normalized css string for fallback layers.
 */
export function resolveColor(
  value: string,
  globals: Record<string, unknown>,
  format?: "vec4",
): RGBA;
export function resolveColor(
  value: string,
  globals: Record<string, unknown>,
  format: "css",
): string;
export function resolveColor(
  value: string,
  globals: Record<string, unknown>,
  format: "vec4" | "css" = "vec4",
): RGBA | string {
  let css = value;
  if (css.startsWith("$")) {
    const path = css.slice(1).split(".");
    let cur: unknown = globals;
    for (const key of path) {
      if (cur == null || typeof cur !== "object" || !(key in (cur as object))) {
        throw new Error(
          `[maplibre-yaml/effects] unresolved global token "${value}"`,
        );
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur !== "string") {
      throw new Error(
        `[maplibre-yaml/effects] global token "${value}" is not a color string`,
      );
    }
    css = cur;
  }
  const rgba = parseCssColor(css);
  if (format === "css") {
    const [r, g, b, a] = rgba;
    return a >= 1
      ? `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
          b * 255,
        )})`
      : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
          b * 255,
        )}, ${+a.toFixed(3)})`;
  }
  return rgba;
}

function parseCssColor(input: string): RGBA {
  let s = input.trim().toLowerCase();
  if (s in NAMED) s = NAMED[s];

  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const exp = (h: string) => parseInt(h.length === 1 ? h + h : h, 16) / 255;
    if (hex.length === 3 || hex.length === 4) {
      return [
        exp(hex[0]),
        exp(hex[1]),
        exp(hex[2]),
        hex.length === 4 ? exp(hex[3]) : 1,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        exp(hex.slice(0, 2)),
        exp(hex.slice(2, 4)),
        exp(hex.slice(4, 6)),
        hex.length === 8 ? exp(hex.slice(6, 8)) : 1,
      ];
    }
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1]
      .split(/[\s,\/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
    }
  }

  throw new Error(`[maplibre-yaml/effects] cannot parse color "${input}"`);
}

/* ------------------------------------------------------------------ */
/* WebGL program plumbing                                              */
/* ------------------------------------------------------------------ */

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const sh = (type: number, src: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[maplibre-yaml/effects] shader compile failed:\n${log}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  const vs = sh(gl.VERTEX_SHADER, vertSrc);
  const fs = sh(gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[maplibre-yaml/effects] program link failed:\n${log}`);
  }
  return program;
}

export interface AttributeBuffer {
  name: string;
  buffer: WebGLBuffer;
  size: 1 | 2 | 3 | 4;
}

/**
 * (Re)bind attribute pointers into `vao` for `program`. Called after any
 * program (re)compile — attribute locations are program-specific, which is
 * why effects rebind when MapLibre's projection variant changes.
 */
export function bindAttributes(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vao: WebGLVertexArrayObject,
  attributes: AttributeBuffer[],
): void {
  gl.bindVertexArray(vao);
  for (const { name, buffer, size } of attributes) {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) continue; // optimized out — legal, skip
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
}

type UniformValue = number | boolean | number[] | RGBA | Float32Array;

export function setUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniforms: Record<string, UniformValue>,
): void {
  for (const [name, v] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(program, name);
    if (loc == null) continue;
    if (typeof v === "number") gl.uniform1f(loc, v);
    else if (typeof v === "boolean") gl.uniform1i(loc, v ? 1 : 0);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
  }
}

/**
 * Wire MapLibre's per-frame projection data into the prelude's uniforms.
 * Uniform names track the projection prelude and are therefore version-
 * sensitive; this list matches maplibre-gl v4/v5. Missing locations are
 * skipped so minor prelude changes degrade gracefully.
 *
 * `data` is CustomRenderMethodInput.defaultProjectionData; typed loosely
 * to avoid chasing minor upstream type renames.
 */
export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  data: any,
): void {
  const set = (name: string, apply: (loc: WebGLUniformLocation) => void) => {
    const loc = gl.getUniformLocation(program, name);
    if (loc != null) apply(loc);
  };
  set("u_projection_matrix", (l) =>
    gl.uniformMatrix4fv(l, false, data.mainMatrix),
  );
  set("u_projection_fallback_matrix", (l) =>
    gl.uniformMatrix4fv(l, false, data.fallbackMatrix),
  );
  set("u_projection_tile_mercator_coords", (l) =>
    gl.uniform4f(
      l,
      ...(data.tileMercatorCoords as [number, number, number, number]),
    ),
  );
  set("u_projection_clipping_plane", (l) =>
    gl.uniform4f(
      l,
      ...(data.clippingPlane as [number, number, number, number]),
    ),
  );
  set("u_projection_transition", (l) =>
    gl.uniform1f(l, data.projectionTransition ?? 0),
  );
}

/* ------------------------------------------------------------------ */
/* Geometry: lon/lat → web mercator (0..1 world)                       */
/* ------------------------------------------------------------------ */

export function mercatorX(lng: number): number {
  return lng / 360 + 0.5;
}

export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

/* ------------------------------------------------------------------ */
/* Line tessellation                                                   */
/* ------------------------------------------------------------------ */

export interface LineQuads {
  positions: Float32Array; // vec2 mercator, 6 verts per segment
  normals: Float32Array; // vec2 unit(ish) — includes miter length
  progress: Float32Array; // scalar cumulative mercator distance
}

/**
 * Tessellate LineString/MultiLineString features into extrudable quads.
 * Per-point normals are averaged between adjacent segments and scaled by
 * miter length (clamped to 4) — approximate miter joins: adequate for
 * effects at cartographic widths, honest about not being MapLibre's full
 * join/cap machinery.
 */
export function lineToQuads(fc: FeatureCollection): LineQuads {
  const positions: number[] = [];
  const normals: number[] = [];
  const progress: number[] = [];

  const lines: Position[][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") lines.push(g.coordinates);
    else if (g.type === "MultiLineString") lines.push(...g.coordinates);
  }

  for (const coords of lines) {
    if (coords.length < 2) continue;
    const pts = coords.map(([lng, lat]) => [mercatorX(lng), mercatorY(lat)]);

    // cumulative distances
    const dist: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      dist.push(
        dist[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
      );
    }

    // per-segment normals
    const segN: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dy) || 1;
      segN.push([-dy / len, dx / len]);
    }

    // per-point miter normals
    const ptN: [number, number][] = pts.map((_, i) => {
      const a = segN[Math.max(0, i - 1)];
      const b = segN[Math.min(segN.length - 1, i)];
      let mx = a[0] + b[0];
      let my = a[1] + b[1];
      const mlen = Math.hypot(mx, my) || 1;
      mx /= mlen;
      my /= mlen;
      const cosHalf = mx * b[0] + my * b[1];
      const miter = Math.min(4, 1 / Math.max(0.25, Math.abs(cosHalf)));
      return [mx * miter, my * miter];
    });

    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n0 = ptN[i];
      const n1 = ptN[i + 1];
      const d0 = dist[i];
      const d1 = dist[i + 1];
      // two triangles: (p0+, p0-, p1+), (p1+, p0-, p1-)
      const quad: Array<[number, number, number, number, number]> = [
        [x0, y0, n0[0], n0[1], d0],
        [x0, y0, -n0[0], -n0[1], d0],
        [x1, y1, n1[0], n1[1], d1],
        [x1, y1, n1[0], n1[1], d1],
        [x0, y0, -n0[0], -n0[1], d0],
        [x1, y1, -n1[0], -n1[1], d1],
      ];
      for (const [x, y, nx, ny, d] of quad) {
        positions.push(x, y);
        normals.push(nx, ny);
        progress.push(d);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    progress: new Float32Array(progress),
  };
}

/* ------------------------------------------------------------------ */
/* Polygon triangulation                                               */
/* ------------------------------------------------------------------ */

export interface PolygonMesh {
  positions: Float32Array; // vec2 mercator
  indices: Uint32Array;
}

/** Triangulate Polygon/MultiPolygon features (holes supported) via earcut. */
export function polygonsToTriangles(fc: FeatureCollection): PolygonMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  const addPolygon = (rings: Position[][]) => {
    const flat: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holes.push(flat.length / 2);
      for (const [lng, lat] of rings[r]) {
        flat.push(mercatorX(lng), mercatorY(lat));
      }
    }
    const base = positions.length / 2;
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    positions.push(...flat);
    for (const i of tri) indices.push(base + i);
  };

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") addPolygon(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates.forEach(addPolygon);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
