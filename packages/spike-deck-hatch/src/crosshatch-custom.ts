/**
 * @file U12 SPIKE — route 2: crosshatch buildings on MapLibre's own custom-layer API
 *
 * @description
 * No deck.gl. One `CustomLayerInterface` (`renderingMode: "3d"`, sharing
 * MapLibre's depth buffer) draws the static `buildings` layer's features with
 * route 1's Tangram shader (same lights, 9-tone atlas via textureGrad +
 * mipmaps, paper margin, fwidth outlines), in the static layer's slot.
 *
 * Geometry source — MapLibre's OWN tile bytes (a variant of option (a)):
 * every loaded vector tile keeps its raw PBF on `tile.latestRawTileData`
 * (MapLibre retains it for queryRenderedFeatures). We walk the source's
 * visible tile coordinates (`tileManager.getVisibleCoordinates()` — exactly
 * the tiles MapLibre draws), decode the building layer with
 * @mapbox/vector-tile + pbf, and build one mesh per canonical tile:
 *
 *  - no second fetch at all (the fetch fallback only runs if a tile has no
 *    raw bytes, e.g. a future MLT source);
 *  - geometry stays in tile coordinates, so it is CLIPPED TO THE TILE EXTENT
 *    exactly: roofs by Sutherland–Hodgman, walls by Liang–Barsky on the
 *    ORIGINAL (buffered) ring edges. Buffer geometry is thereby deduped
 *    (each tile draws only its own square) and walls on the extent boundary
 *    are dropped (no fake walls at tile seams). A clipped wall keeps the
 *    texture coordinate of its unclipped edge, so the hatch does not restart
 *    at a seam;
 *  - lighting is constant per face (fixed lights, vertical walls, flat
 *    roofs), so diffuse is precomputed on the CPU: the vertex shader is one
 *    matrix multiply.
 *
 * Draw: per tile, tile-local coordinates × a float64-composed matrix
 * (`defaultProjectionData.mainMatrix` from the render args × the tile's
 * offset/scale × metres→mercator × Tangram's height exaggeration) — the
 * relative-to-tile origin keeps building-scale precision.
 *
 * Cost (measured): the geometry path alone (flat shader) is FASTER than the
 * static fill-extrusion-pattern preset; all of the cost is the per-pixel
 * hatch shader. So: back-face culling and a depth-only prepass (the hatch
 * runs once per visible pixel — large win on GPU), and the mip level is
 * taken from the minor derivative axis instead of hardware anisotropic
 * filtering (8x aniso costs ~3x in SwiftShader) — that keeps strokes from
 * smearing on long thin walls, roughly matching route 1's look.
 *
 * Context loss: MapLibre drops custom layers on restore; this layer re-adds
 * itself (the deck and post routes don't).
 *
 * Mercator only (no globe variant) — spike scope.
 */
import type { Map as MapLibreMap, CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl";
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import Pbf from "pbf";
import earcut from "earcut";
import { heightExaggeration } from "./crosshatch-runtime";

const EARTH_CIRCUMFERENCE = 40075016.68557849;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;   // tile units x, y; metres z
layout(location = 1) in vec4 a_attr;  // uv.x, uv.y, diffuse, roof
uniform mat4 u_matrix;
invariant gl_Position; // the depth prepass and the hatch pass must agree exactly
out vec2 vHatchUV;
out float vHatchDiffuse;
out float vHatchRoof;
void main() {
  vHatchUV = a_attr.xy;
  vHatchDiffuse = a_attr.z;
  vHatchRoof = a_attr.w;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}`;

// Route 1's fragment stage, verbatim (crosshatch-layer.ts FS_DECL + FS_MAIN).
const FS = `#version 300 es
precision highp float;
in vec2 vHatchUV;
in float vHatchDiffuse;
in float vHatchRoof;
uniform sampler2D hatchAtlas;
uniform float u_gain;
uniform float u_minorLod; // 1: mip level from the minor derivative axis (cheap anti-smear)
out vec4 fragColor;
const vec3 INK = vec3(0.302, 0.302, 0.306);
const vec3 PAPER = vec3(0.976, 0.953, 0.890);
float hatch_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hatch_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hatch_hash(i), hatch_hash(i + vec2(1.0, 0.0)), u.x),
             mix(hatch_hash(i + vec2(0.0, 1.0)), hatch_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hatch_sample(float b, vec2 st, vec2 dx, vec2 dy) {
  vec2 p = fract(vec2(floor(b * 9.0) / 3.0, floor(b * 3.0) / 3.0) + st);
  return textureGrad(hatchAtlas, vec2(p.x, 1.0 - p.y), dx, dy).a;
}
float getHatch(vec2 uv, float brightness) {
  vec2 st = fract(uv) / 3.0;
  vec2 dx = dFdx(uv / 3.0), dy = dFdy(uv / 3.0);
  if (u_minorLod > 0.5) {
    // Walls are long and thin in texture space; isotropic filtering picks
    // the LOD from the MAJOR axis and smears strokes. Scale both gradients
    // so the LOD follows the MINOR axis instead (a little aliasing along
    // the long axis; far cheaper than anisotropic filtering in software).
    float lx = length(dx), ly = length(dy);
    float k = min(lx, ly) / max(max(lx, ly), 1e-8);
    dx *= k; dy *= k;
  }
  brightness = clamp(brightness, 0.0, 0.9999999);
  float minB = clamp(brightness - 0.111111111, 0.0, 1.0);
  return mix(hatch_sample(brightness, st, dx, dy), hatch_sample(minB, st, dx, dy),
             1.0 - fract(brightness * 9.0));
}
void main() {
  vec2 uv = vHatchUV;
  float b = u_gain * vHatchDiffuse * (clamp(uv.y * 1.5, 0.0, 1.0) + 0.2);
  float pattern = 1.0 - getHatch(uv, b);
  vec2 edge = vec2(0.1, 0.05) * hatch_noise(uv * 20.0);
  vec2 blend = smoothstep(vec2(0.0), edge, uv) * smoothstep(vec2(0.0), edge, vec2(1.0) - uv);
  float t = mix(1.0, pattern, blend.x * blend.y);
  vec2 fw = max(fwidth(uv), vec2(1e-5));
  float px = min(min(uv.x, 1.0 - uv.x) / fw.x, (1.0 - uv.y) / fw.y);
  float line = (1.0 - vHatchRoof) * (1.0 - smoothstep(0.6, 1.4, px));
  fragColor = vec4(mix(mix(INK, PAPER, t), INK, line * 0.85), 1.0);
}`;

const FS_DEPTH = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

const FS_FLAT = `#version 300 es
precision highp float;
in vec2 vHatchUV;
in float vHatchDiffuse;
in float vHatchRoof;
uniform sampler2D hatchAtlas;
uniform float u_gain;
out vec4 fragColor;
void main() { fragColor = vec4(vec3(clamp(u_gain * vHatchDiffuse, 0.0, 1.0)), 1.0); }`;

// Tangram's lights in a north-up frame (route 1's constants).
const LD = norm3([-0.2, -0.7, 0.5]);
const LP = norm3([0.0, -1.0, 1.0]);
function norm3(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}
const diffuse = (nx: number, ny: number, nz: number) =>
  Math.max(0, nx * LD[0]! + ny * LD[1]! + nz * LD[2]!) + 0.5 * Math.max(0, nx * LP[0]! + ny * LP[1]! + nz * LP[2]!);
const ROOF_DIFFUSE = diffuse(0, 0, 1);

type Pt = { x: number; y: number };

/** Sutherland–Hodgman against the square [0, E]². Input ring may be closed. */
function clipRing(ring: Pt[], E: number): number[] {
  let pts: number[] = [];
  const n = ring.length - (ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.y === ring[ring.length - 1]!.y ? 1 : 0);
  for (let i = 0; i < n; i++) pts.push(ring[i]!.x, ring[i]!.y);
  // edges: x>=0, x<=E, y>=0, y<=E
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const axis = e < 2 ? 0 : 1;
    const lo = e % 2 === 0;
    const inside = (v: number) => (lo ? v >= 0 : v <= E);
    const bound = lo ? 0 : E;
    const out: number[] = [];
    const m = pts.length / 2;
    for (let i = 0; i < m; i++) {
      const ax = pts[i * 2]!, ay = pts[i * 2 + 1]!;
      const j = (i + 1) % m;
      const bx = pts[j * 2]!, by = pts[j * 2 + 1]!;
      const av = axis === 0 ? ax : ay, bv = axis === 0 ? bx : by;
      const ain = inside(av), bin = inside(bv);
      if (ain) out.push(ax, ay);
      if (ain !== bin) {
        const t = (bound - av) / (bv - av);
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    pts = out;
  }
  return pts.length >= 6 ? pts : [];
}

/** Liang–Barsky: clip segment to [0, E]², returning [t0, t1] or null. */
function clipSeg(ax: number, ay: number, bx: number, by: number, E: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax, E - ax, ay, E - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return null;
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

const onSameBoundary = (ax: number, ay: number, bx: number, by: number, E: number) => {
  const eps = 1e-6;
  return (
    (Math.abs(ax) < eps && Math.abs(bx) < eps) ||
    (Math.abs(ax - E) < eps && Math.abs(bx - E) < eps) ||
    (Math.abs(ay) < eps && Math.abs(by) < eps) ||
    (Math.abs(ay - E) < eps && Math.abs(by - E) < eps)
  );
};

export interface MeshData {
  vertices: Float32Array; // 7 floats / vertex
  indices: Uint32Array;
  extent: number;
  features: number;
  droppedBoundaryWalls: number;
}

/** Decode one tile's building layer and build the crosshatch mesh. */
export function buildTileMesh(raw: ArrayBuffer | Uint8Array, sourceLayer: string): MeshData | null {
  const vt = new VectorTile(new Pbf(raw instanceof Uint8Array ? raw : new Uint8Array(raw)));
  const layer = vt.layers[sourceLayer];
  if (!layer) return null;
  const E = layer.extent;
  const v: number[] = [];
  const idx: number[] = [];
  let dropped = 0;
  const vert = (x: number, y: number, z: number, u: number, w: number, d: number, roof: number) => {
    v.push(x, y, z, u, w, d, roof);
    return v.length / 7 - 1;
  };
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 3) continue;
    const props = feat.properties as Record<string, unknown>;
    const h = typeof props.render_height === "number" ? props.render_height : 10;
    const mh = typeof props.render_min_height === "number" ? props.render_min_height : 0;
    const rings = feat.loadGeometry() as Pt[][];
    for (const poly of classifyRings(rings) as Pt[][][]) {
      // Signed area (tile coords, y down) of the outer ring fixes which edge
      // normal points out of the solid, for the outer ring and its holes.
      const outer = poly[0]!;
      let area = 0;
      for (let i = 0; i < outer.length - 1; i++) area += outer[i]!.x * outer[i + 1]!.y - outer[i + 1]!.x * outer[i]!.y;
      if (area === 0) continue;
      const s = area > 0 ? 1 : -1;

      // --- walls: original edges, clipped to the tile square ------------
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]!, b = ring[i + 1]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len === 0) continue;
          const t = clipSeg(a.x, a.y, b.x, b.y, E);
          if (!t) continue;
          const ax = a.x + dx * t[0], ay = a.y + dy * t[0];
          const bx = a.x + dx * t[1], by = a.y + dy * t[1];
          if (onSameBoundary(ax, ay, bx, by, E)) { dropped++; continue; }
          // outward normal in tile coords, then to north-up (flip y)
          const nx = (s * dy) / len, ny = (-s * dx) / len;
          const d = diffuse(nx, -ny, 0);
          const i0 = vert(ax, ay, mh, t[0], 0, d, 0);
          vert(bx, by, mh, t[1], 0, d, 0);
          vert(bx, by, h, t[1], 1, d, 0);
          vert(ax, ay, h, t[0], 1, d, 0);
          idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        }
      }

      // --- roof: clip every ring to the square, earcut ------------------
      const flat: number[] = [];
      const holes: number[] = [];
      let ok = true;
      for (let r = 0; r < poly.length; r++) {
        const c = clipRing(poly[r]!, E);
        if (c.length === 0) { if (r === 0) ok = false; continue; }
        if (r > 0) holes.push(flat.length / 2);
        for (const x of c) flat.push(x);
      }
      if (!ok) continue;
      const tris = earcut(flat, holes.length ? holes : undefined, 2);
      const base = v.length / 7;
      for (let i = 0; i < flat.length; i += 2) vert(flat[i]!, flat[i + 1]!, h, 0.5, 0.6, ROOF_DIFFUSE, 1);
      for (const k of tris) idx.push(base + k);
    }
  }
  if (idx.length === 0) return null;
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx), extent: E, features: layer.length, droppedBoundaryWalls: dropped };
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  extent: number;
  rawLen: number;
  lastUsed: number;
}

interface Doc {
  sources: Record<string, { tiles?: string[] }>;
  layers: Array<{ id: string; type: string; source?: string; "source-layer"?: string; minzoom?: number; layout?: Record<string, unknown>; "x-effect"?: { type: string; gain?: number } }>;
}

export interface CustomHandle {
  layerId: string;
  beforeId: string | undefined;
  placementOk: boolean;
  slots: { layerId: string; beforeId: string | undefined }[];
  stats: { tilesDrawn: number; meshes: number; builds: number; buildMs: number; fetched: number; triangles: number; droppedBoundaryWalls: number };
  loaded(): Promise<void>;
  destroy(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`[crosshatch-custom] shader: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

/** out = a · b, column-major 4×4, float64. */
function mul(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
}

export async function attachCrosshatchCustom(
  map: MapLibreMap,
  doc: Doc,
  opts: {
    atlasUrl: string;
    /** frame budget for mesh builds, ms (the rest is spread over later frames) */
    buildBudgetMs?: number;
    /** back-face culling (default on): walls and roofs are wound clockwise seen from outside */
    cull?: boolean;
    /** depth prepass (default on): depth-only pass first, so the hatch shader runs once per visible pixel */
    prepass?: boolean;
    /** diagnostic: trivial fragment shader (diffuse grey) — isolates fragment cost */
    flat?: boolean;
    /**
     * Anti-smear for the hatch atlas on long thin faces: "minor" (default) =
     * mip level from the minor derivative axis (cheap), a number = hardware
     * anisotropic filtering at that level (crisper; expensive in SwiftShader),
     * "off" = plain isotropic trilinear (smears).
     */
    filter?: "minor" | "off" | number;
  }
): Promise<CustomHandle> {
  const layer = doc.layers.find((l) => l["x-effect"]?.type === "crosshatch-buildings");
  if (!layer || layer.type !== "fill-extrusion" || !layer.source || !layer["source-layer"]) {
    throw new Error("[crosshatch-custom] needs a fill-extrusion crosshatch-buildings layer on a vector source-layer");
  }
  const sourceId = layer.source;
  const sourceLayer = layer["source-layer"];
  const minzoom = layer.minzoom ?? 0;
  const gain = layer["x-effect"]!.gain ?? 0.72;
  const budget = opts.buildBudgetMs ?? 12;
  const atlas = await createImageBitmap(await (await fetch(opts.atlasUrl)).blob());

  if (!map.isStyleLoaded()) {
    await new Promise<void>((resolve) => {
      const check = () => { if (map.isStyleLoaded()) { map.off("idle", check); resolve(); } };
      map.on("idle", check);
      map.triggerRepaint();
    });
  }
  const order = map.getLayersOrder();
  const idx = order.indexOf(layer.id);
  const beforeId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;

  // Internal (MapLibre 5): the source's tile manager — the tiles it draws and their raw bytes.
  type TileLike = { latestRawTileData?: ArrayBuffer; state?: string };
  type Coord = { key: string; wrap: number; canonical: { z: number; x: number; y: number } };
  const tileManager = () =>
    (map as unknown as { style: { tileManagers: Record<string, { getVisibleCoordinates(): Coord[]; getTileByID(k: string): TileLike | undefined }> } })
      .style.tileManagers[sourceId];

  const stats = { tilesDrawn: 0, meshes: 0, builds: 0, buildMs: 0, fetched: 0, triangles: 0, droppedBoundaryWalls: 0 };
  const meshes = new Map<string, GpuMesh | null>(); // null = tile has no buildings
  const fetched = new Map<string, ArrayBuffer | "pending" | "failed">();
  let pendingBuilds = 0;
  let frame = 0;
  let gl!: WebGL2RenderingContext;
  let program: WebGLProgram | null = null;
  let depthProgram: WebGLProgram | null = null;
  let uDepthMatrix: WebGLUniformLocation;
  const cull = opts.cull ?? true;
  const prepass = opts.prepass ?? true;
  let atlasTex: WebGLTexture | null = null;
  let uMatrix: WebGLUniformLocation, uGain: WebGLUniformLocation, uAtlas: WebGLUniformLocation, uMinorLod: WebGLUniformLocation | null;
  const filter = opts.filter ?? "minor";
  const anisotropy = typeof filter === "number" ? filter : 1;
  const M = new Float64Array(16);
  const T = new Float64Array(16);

  const rawFor = (coord: Coord, tile: TileLike | undefined): ArrayBuffer | null => {
    if (tile?.latestRawTileData) return tile.latestRawTileData;
    // Fallback (not hit with MapLibre 5.24 MVT): fetch it ourselves.
    const { z, x, y } = coord.canonical;
    const k = `${z}/${x}/${y}`;
    const f = fetched.get(k);
    if (f instanceof ArrayBuffer) return f;
    if (!f && tile && tile.state === "loaded") {
      const tpl = (map.getSource(sourceId) as unknown as { tiles?: string[] })?.tiles?.[0];
      if (tpl) {
        fetched.set(k, "pending");
        stats.fetched++;
        fetch(tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)))
          .then((r) => r.arrayBuffer())
          .then((b) => { fetched.set(k, b); map.triggerRepaint(); })
          .catch(() => fetched.set(k, "failed"));
      }
    }
    return null;
  };

  const upload = (m: MeshData, rawLen: number): GpuMesh => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    stats.triangles += m.indices.length / 3;
    stats.droppedBoundaryWalls += m.droppedBoundaryWalls;
    return { vao, vbo, ibo, count: m.indices.length, extent: m.extent, rawLen, lastUsed: frame };
  };
  const free = (g: GpuMesh | null) => {
    if (!g) return;
    gl.deleteVertexArray(g.vao);
    gl.deleteBuffer(g.vbo);
    gl.deleteBuffer(g.ibo);
  };

  const link = (fs: string) => {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`[crosshatch-custom] link: ${gl.getProgramInfoLog(prog)}`);
    return prog;
  };
  const init = () => {
    program = link(opts.flat ? FS_FLAT : FS);
    depthProgram = link(FS_DEPTH);
    uDepthMatrix = gl.getUniformLocation(depthProgram, "u_matrix")!;
    uMatrix = gl.getUniformLocation(program, "u_matrix")!;
    uGain = gl.getUniformLocation(program, "u_gain")!;
    uAtlas = gl.getUniformLocation(program, "hatchAtlas")!;
    uMinorLod = gl.getUniformLocation(program, "u_minorLod");
    atlasTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso && anisotropy > 1) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, anisotropy));
    }
  };

  const id = `${layer.id}__custom`;
  const custom: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, glAny) {
      gl = glAny as WebGL2RenderingContext;
    },
    render(_glAny, args: CustomRenderMethodInput) {
      frame++;
      stats.tilesDrawn = 0;
      if (map.getZoom() < minzoom) return;
      const tm = tileManager();
      if (!tm) return;
      if (!program) init(); // GL resources inside render(): MapLibre resets its state cache after us

      // metres → mercator units at the map centre (what fill-extrusion uses), × Tangram's exaggeration
      const lat = (map.getCenter().lat * Math.PI) / 180;
      const zScale = heightExaggeration(map.getZoom()) / (EARTH_CIRCUMFERENCE * Math.cos(lat));
      const main = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;

      if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW); }
      else gl.disable(gl.CULL_FACE);

      const t0 = performance.now();
      let pending = 0;
      const draws: Array<{ mesh: GpuMesh; matrix: Float32Array }> = [];
      for (const coord of tm.getVisibleCoordinates()) {
        const { z, x, y } = coord.canonical;
        const key = `${z}/${x}/${y}`;
        const tile = tm.getTileByID(coord.key);
        let mesh = meshes.get(key);
        const raw = rawFor(coord, tile);
        if (raw && (mesh === undefined || (mesh && mesh.rawLen !== raw.byteLength))) {
          if (performance.now() - t0 > budget) { pending++; }
          else {
            const b0 = performance.now();
            free(mesh ?? null);
            const data = buildTileMesh(raw, sourceLayer);
            mesh = data ? upload(data, raw.byteLength) : null;
            meshes.set(key, mesh);
            stats.builds++;
            stats.buildMs += performance.now() - b0;
          }
        } else if (!raw && mesh === undefined) {
          pending++;
        }
        if (!mesh) continue;
        mesh.lastUsed = frame;
        const n = 2 ** z;
        const s = 1 / (n * mesh.extent);
        T.fill(0);
        T[0] = s; T[5] = s; T[10] = zScale; T[15] = 1;
        T[12] = (x + coord.wrap * n) / n;
        T[13] = y / n;
        mul(M, main, T);
        draws.push({ mesh, matrix: Float32Array.from(M) });
      }

      // pass 1 (optional): depth only — MapLibre's 3D depth mode (LEQUAL, write) is already set
      if (prepass && draws.length) {
        gl.useProgram(depthProgram);
        gl.colorMask(false, false, false, false);
        for (const d of draws) {
          gl.uniformMatrix4fv(uDepthMatrix, false, d.matrix);
          gl.bindVertexArray(d.mesh.vao);
          gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_INT, 0);
        }
        gl.colorMask(true, true, true, true);
      }
      // pass 2: the hatch — with the prepass, only the front-most fragment passes LEQUAL
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(uAtlas, 0);
      gl.uniform1f(uGain, gain);
      if (uMinorLod) gl.uniform1f(uMinorLod, filter === "minor" ? 1 : 0);
      for (const d of draws) {
        gl.uniformMatrix4fv(uMatrix, false, d.matrix);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_INT, 0);
      }
      stats.tilesDrawn = draws.length;
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
      pendingBuilds = pending;
      if (pending > 0) map.triggerRepaint();

      // evict meshes unused for ~10 s of frames once the cache grows
      if (meshes.size > 96) {
        for (const [k, m] of meshes) if (!m || frame - m.lastUsed > 600) { free(m); meshes.delete(k); }
      }
      stats.meshes = meshes.size;
    },
    onRemove() {
      for (const m of meshes.values()) free(m);
      meshes.clear();
      if (program) gl.deleteProgram(program);
      if (depthProgram) gl.deleteProgram(depthProgram);
      if (atlasTex) gl.deleteTexture(atlasTex);
      program = null;
    },
  };

  const savedVisibility = map.getLayoutProperty(layer.id, "visibility");
  map.addLayer(custom, beforeId);
  map.setLayoutProperty(layer.id, "visibility", "none");

  // WebGL context loss: MapLibre re-applies its serialized style on restore
  // but drops custom layers ("re-add it manually"). Forget every GL handle
  // (they died with the context), then add the layer back in the same slot
  // once the restored style has loaded. The static layer's visibility:none
  // survives in the serialized style.
  let destroyed = false;
  const onLost = () => {
    program = null;
    depthProgram = null;
    atlasTex = null;
    meshes.clear();
  };
  const onRestored = () => {
    const again = () => {
      if (destroyed || map.getLayer(id)) return;
      if (!map.isStyleLoaded()) { map.once("idle", again); map.triggerRepaint(); return; }
      map.addLayer(custom, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
      map.setLayoutProperty(layer.id, "visibility", "none");
    };
    again();
  };
  map.on("webglcontextlost", onLost);
  map.on("webglcontextrestored", onRestored);
  const after = map.getLayersOrder();
  const at = after.indexOf(id);
  const placementOk = after[at - 1] === layer.id && (!beforeId || after[at + 1] === beforeId);
  if (!placementOk) console.warn("[crosshatch-custom] placement FAILED");

  return {
    layerId: layer.id,
    beforeId,
    placementOk,
    slots: [{ layerId: layer.id, beforeId }],
    stats,
    loaded: () =>
      new Promise<void>((resolve) => {
        const poll = () => {
          if (pendingBuilds === 0 && map.loaded() && (stats.builds > 0 || map.getZoom() < minzoom)) resolve();
          else { map.once("idle", poll); map.triggerRepaint(); }
        };
        poll();
      }),
    destroy() {
      destroyed = true;
      map.off("webglcontextlost", onLost);
      map.off("webglcontextrestored", onRestored);
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", (savedVisibility as never) ?? "visible");
    },
  };
}
