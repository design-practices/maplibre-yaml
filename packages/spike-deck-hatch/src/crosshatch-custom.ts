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
import { heightExaggeration, MeshWorkers } from "./crosshatch-runtime";
import { buildTileMesh, type MeshData } from "./crosshatch-mesh-build";
export { buildTileMesh, type MeshData };

const EARTH_CIRCUMFERENCE = 40075016.68557849;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;   // tile units x, y; metres z
layout(location = 1) in vec4 a_attr;  // uv.x, uv.y, diffuse, roof
uniform mat4 u_matrix;
uniform float u_mpu;   // metres per tile unit for this tile (world-scale effects)
uniform float u_zex;   // the height exaggeration the matrix applies (so world z matches what's drawn)
invariant gl_Position; // the depth prepass and the hatch pass must agree exactly
out vec2 vHatchUV;
out float vHatchDiffuse;
out float vHatchRoof;
out vec3 vWorld;       // metres: x, y within the tile; z above ground (as drawn)
void main() {
  vWorld = vec3(a_pos.xy * u_mpu, a_pos.z * u_zex);
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

/**
 * Example user effect (the effects-API proposal's "blueprint"): a metre-scaled
 * grid on every face, faint diffuse shading, glowing edges. The grid frame is
 * per face from the world position: roofs use (x, y); walls use (along-wall,
 * height), the wall's direction taken from the screen-space derivative normal
 * — so lines never stretch, whatever the face's size.
 */
const FS_BLUEPRINT = `#version 300 es
precision highp float;
in vec2 vHatchUV;
in float vHatchDiffuse;
in float vHatchRoof;
in vec3 vWorld;
uniform vec3 u_line;
uniform vec3 u_ground;
uniform float u_grid;   // metres between grid lines
uniform float u_gain;
out vec4 fragColor;
float gridLine(vec2 p) {
  vec2 w = max(fwidth(p), vec2(1e-5));
  vec2 g = abs(fract(p - 0.5) - 0.5) / w;
  return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
}
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec2 q;
  if (vHatchRoof > 0.5) q = vWorld.xy;
  else {
    vec2 t = normalize(vec2(-n.y, n.x) + vec2(1e-6, 0.0));
    q = vec2(dot(vWorld.xy, t), vWorld.z);
  }
  q /= u_grid;
  float dens = max(length(fwidth(q.x)), length(fwidth(q.y)));
  float g = gridLine(q) * (1.0 - smoothstep(0.12, 0.35, dens)); // fade when lines get closer than ~3 px
  vec2 uv = vHatchUV;
  vec2 fw = max(fwidth(uv), vec2(1e-5));
  float px = min(min(uv.x, 1.0 - uv.x) / fw.x, min(uv.y, 1.0 - uv.y) / fw.y);
  float wall = 1.0 - vHatchRoof;
  float edge = wall * (1.0 - smoothstep(0.5, 1.6, px));
  float glow = wall * exp(-px * 0.18) * 0.35;
  float shade = 0.55 + 0.45 * clamp(u_gain * vHatchDiffuse, 0.0, 1.0);
  vec3 c = u_ground * shade;
  c = mix(c, u_line, glow);
  c = mix(c, u_line, max(g * 0.45, edge * 0.95));
  fragColor = vec4(c, 1.0);
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
  layers: Array<{ id: string; type: string; source?: string; "source-layer"?: string; minzoom?: number; layout?: Record<string, unknown>; "x-effect"?: { type: string; gain?: number; [k: string]: unknown } }>;
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
    /**
     * Where tile meshes are built: "worker" (default) = route 1's bundled
     * mesh worker pool, off the main thread; "main" = inside render() under
     * buildBudgetMs (the session-3 behaviour: ~47 ms per tile on an M2 Air,
     * i.e. stutter whenever panning/zooming brings in a tile).
     */
    parse?: "worker" | "main";
  }
): Promise<CustomHandle> {
  const EFFECTS = ["crosshatch-buildings", "blueprint"];
  const layer = doc.layers.find((l) => EFFECTS.includes(l["x-effect"]?.type ?? ""));
  if (!layer || layer.type !== "fill-extrusion" || !layer.source || !layer["source-layer"]) {
    throw new Error(`[crosshatch-custom] needs a fill-extrusion layer with x-effect type ${EFFECTS.join(" | ")} on a vector source-layer`);
  }
  const fx = layer["x-effect"] as { type: string; gain?: number; line?: string; ground?: string; grid?: number; exaggerate?: boolean };
  const blueprint = fx.type === "blueprint";
  // Tangram's height exaggeration is part of the crosshatch look, not of the
  // backend: blueprint draws true heights (its static layer does too).
  const exaggerate = fx.exaggerate ?? !blueprint;
  const hex = (h: string | undefined, d: string) => {
    const n = parseInt((h ?? d).replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
  };
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

  const stats = {
    tilesDrawn: 0, meshes: 0, builds: 0, buildMs: 0, fetched: 0, triangles: 0, droppedBoundaryWalls: 0,
    /** builds done in the worker pool / on the main thread */
    workerBuilds: 0, mainBuilds: 0,
    /** max main-thread ms spent in one render() on uploads/builds (stutter indicator) */
    maxFrameBuildMs: 0,
    /** draws that used a cached ancestor/child mesh while a tile was building */
    fallbackDraws: 0,
  };
  const parse = opts.parse ?? "worker";
  const workers = parse === "worker" ? new MeshWorkers(2) : null;
  /** keys with a worker build in flight */
  const building = new Set<string>();
  /** finished worker builds awaiting GL upload (uploads must happen in render()) */
  const ready = new Map<string, { data: MeshData | null; rawLen: number; ms: number }>();
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
  let uMpu: WebGLUniformLocation | null = null, uZex: WebGLUniformLocation | null = null, uDepthZex: WebGLUniformLocation | null = null;
  let uLine: WebGLUniformLocation | null = null, uGround: WebGLUniformLocation | null = null, uGrid: WebGLUniformLocation | null = null;
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
    program = link(opts.flat ? FS_FLAT : blueprint ? FS_BLUEPRINT : FS);
    depthProgram = link(FS_DEPTH);
    uDepthMatrix = gl.getUniformLocation(depthProgram, "u_matrix")!;
    uMatrix = gl.getUniformLocation(program, "u_matrix")!;
    uGain = gl.getUniformLocation(program, "u_gain")!;
    uAtlas = gl.getUniformLocation(program, "hatchAtlas")!;
    uMinorLod = gl.getUniformLocation(program, "u_minorLod");
    uMpu = gl.getUniformLocation(program, "u_mpu");
    uZex = gl.getUniformLocation(program, "u_zex");
    uDepthZex = gl.getUniformLocation(depthProgram, "u_zex");
    uLine = gl.getUniformLocation(program, "u_line");
    uGround = gl.getUniformLocation(program, "u_ground");
    uGrid = gl.getUniformLocation(program, "u_grid");
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
      const zex = exaggerate ? heightExaggeration(map.getZoom()) : 1;
      const zScale = zex / (EARTH_CIRCUMFERENCE * Math.cos(lat));
      const groundM = EARTH_CIRCUMFERENCE * Math.cos(lat); // metres per mercator unit at this latitude
      const main = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;

      if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW); }
      else gl.disable(gl.CULL_FACE);

      const t0 = performance.now();
      let pending = 0;

      // Upload finished worker builds (GL calls must happen here), under the
      // frame budget so a burst of arriving tiles never blocks one frame.
      for (const [key, r] of ready) {
        if (performance.now() - t0 > budget) { pending++; break; }
        free(meshes.get(key) ?? null);
        meshes.set(key, r.data ? upload(r.data, r.rawLen) : null);
        ready.delete(key);
        stats.builds++;
        stats.workerBuilds++;
        stats.buildMs += r.ms;
      }

      const draws: Array<{ mesh: GpuMesh; matrix: Float32Array; mpu: number }> = [];
      const drawn = new Set<string>();
      const pushDraw = (mesh: GpuMesh, z: number, x: number, y: number, wrap: number) => {
        const dk = `${z}/${x}/${y}@${wrap}`;
        if (drawn.has(dk)) return;
        drawn.add(dk);
        mesh.lastUsed = frame;
        const n = 2 ** z;
        const s = 1 / (n * mesh.extent);
        T.fill(0);
        T[0] = s; T[5] = s; T[10] = zScale; T[15] = 1;
        T[12] = (x + wrap * n) / n;
        T[13] = y / n;
        mul(M, main, T);
        draws.push({ mesh, matrix: Float32Array.from(M), mpu: groundM / (n * mesh.extent) });
      };
      /**
       * While a tile's mesh is building, draw what MapLibre would: the
       * nearest cached ancestor, else whichever cached children exist — so a
       * pan or zoom never shows holes or pops.
       */
      const fallback = (z: number, x: number, y: number, wrap: number): boolean => {
        for (let dz = 1; dz <= 4 && z - dz >= 0; dz++) {
          const m = meshes.get(`${z - dz}/${x >> dz}/${y >> dz}`);
          if (m) { pushDraw(m, z - dz, x >> dz, y >> dz, wrap); return true; }
        }
        let any = false;
        for (let i = 0; i < 4; i++) {
          const cx = x * 2 + (i & 1), cy = y * 2 + (i >> 1);
          const m = meshes.get(`${z + 1}/${cx}/${cy}`);
          if (m) { pushDraw(m, z + 1, cx, cy, wrap); any = true; }
        }
        return any;
      };

      for (const coord of tm.getVisibleCoordinates()) {
        const { z, x, y } = coord.canonical;
        const key = `${z}/${x}/${y}`;
        const tile = tm.getTileByID(coord.key);
        let mesh = meshes.get(key);
        const raw = rawFor(coord, tile);
        const stale = mesh !== undefined && mesh !== null && raw !== null && mesh.rawLen !== raw.byteLength;
        if (raw && (mesh === undefined || stale) && !building.has(key) && !ready.has(key)) {
          if (workers) {
            // Copy: the buffer is MapLibre's and must not be transferred away.
            building.add(key);
            const rawLen = raw.byteLength;
            workers
              .build({ raw: raw.slice(0), sourceLayer, opts: {} })
              .then((r) => ready.set(key, { data: (r.mesh as MeshData | null) ?? null, rawLen, ms: r.ms }))
              .catch(() => ready.set(key, { data: null, rawLen, ms: 0 }))
              .finally(() => { building.delete(key); map.triggerRepaint(); });
          } else if (performance.now() - t0 > budget) {
            pending++;
          } else {
            const b0 = performance.now();
            free(mesh ?? null);
            const data = buildTileMesh(raw, sourceLayer);
            mesh = data ? upload(data, raw.byteLength) : null;
            meshes.set(key, mesh);
            stats.builds++;
            stats.mainBuilds++;
            stats.buildMs += performance.now() - b0;
          }
        }
        // No raw yet = MapLibre is still loading the tile; its arrival
        // triggers a render on its own, so no repaint request here (the
        // session-3 code requested one every frame — a never-idle loop).
        mesh = meshes.get(key);
        if (mesh) pushDraw(mesh, z, x, y, coord.wrap);
        else if (mesh === undefined && fallback(z, x, y, coord.wrap)) stats.fallbackDraws++;
      }
      stats.maxFrameBuildMs = Math.max(stats.maxFrameBuildMs, performance.now() - t0);

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
      if (uZex) gl.uniform1f(uZex, zex);
      if (blueprint) {
        gl.uniform3fv(uLine, hex(fx.line, "#cfeeff"));
        gl.uniform3fv(uGround, hex(fx.ground, "#1a56b0"));
        gl.uniform1f(uGrid, fx.grid ?? 4);
      }
      for (const d of draws) {
        gl.uniformMatrix4fv(uMatrix, false, d.matrix);
        if (uMpu) gl.uniform1f(uMpu, d.mpu);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_INT, 0);
      }
      stats.tilesDrawn = draws.length;
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
      pendingBuilds = pending + building.size + ready.size;
      if (pending > 0 || ready.size > 0) map.triggerRepaint();

      // evict meshes unused for ~10 s of frames once the cache grows
      if (meshes.size > 96) {
        for (const [k, m] of meshes) if (!m || frame - m.lastUsed > 600) { free(m); meshes.delete(k); }
      }
      stats.meshes = meshes.size;
    },
    onRemove() {
      workers?.terminate();
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
    ready.clear();
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
