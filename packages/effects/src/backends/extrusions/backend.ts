/**
 * @file `backends.extrusions` — shader effects on fill-extrusion layers
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * Graduated from the U12 spike's route 2 (ml-rzm; D-A1): one MapLibre
 * `CustomLayerInterface` (`renderingMode: "3d"`, sharing MapLibre's depth
 * buffer) per effect layer, inserted in the static layer's slot — directly
 * above it, below whatever was above it (labels stay on top). The static
 * layer is hidden with `fill-extrusion-opacity: 0` (not `visibility: none`,
 * which would stop MapLibre loading the source's tiles when nothing else
 * uses it) and restored on detach.
 *
 * - **Geometry:** MapLibre's own tile selection and raw tile bytes (via the
 *   adapter), meshed in a worker pool with the static layer's own filter
 *   and height/base expressions; finished meshes upload under a per-frame
 *   budget, and a tile still building draws its nearest cached ancestor or
 *   children, so pans and zooms never show holes.
 * - **Draw:** per tile, a float64-composed matrix (MapLibre's projection ×
 *   tile offset/scale × metres→mercator), back-face culling and an optional
 *   depth prepass, then the effect's fragment shader.
 * - **Idle:** nothing repaints on its own unless uploads are pending or the
 *   effect is `animated` (KTD7's static clause).
 * - **Robustness:** WebGL context loss re-adds the layer after restore;
 *   globe projection, 3D terrain, a missing internal, a worker that cannot
 *   load, a shader that does not compile, or a texture that never arrives
 *   each declare absence — one warning, static layer visible.
 */

import type { Map as MapLibreMap, CustomLayerInterface } from "maplibre-gl";
import type { Backend, BackendContext, BackendHandle, EffectDefinition, TextureSource } from "../../contract";
import {
  VERTEX_SHADER,
  DEPTH_VERTEX_SHADER,
  DEPTH_FRAGMENT_SHADER,
  buildFragmentShader,
  resolveUniform,
  checkUniformName,
  type ResolvedUniform,
} from "../../glsl";
import { warnOnce } from "../../log";
import { probeTiles, probeMainMatrix, isMercator, hasTerrain, layerOrder, type TileView, type TileCoord } from "./adapter";
import { acquirePool, releasePool, WorkerUnavailableError, type MeshWorkerPool } from "./workers";
import { readCuts, type MeshData } from "./mesh-build";
import { VERTEX_BYTES, VB } from "./vertex-format";
import { zoomFactor } from "./interp";
import { SeamRegistry } from "./seams";

const EARTH_CIRCUMFERENCE = 40075016.68557849;

/**
 * Seam-matching allowance, in tile units, for maplibre-gl 6's re-encoded
 * overzoom slices (adapter.ts): ≤ 4 units of vertex drift measured, doubled.
 */
const REENCODED_DRIFT_UNITS = 8;

interface GpuMesh {
  key: string;
  /** Tile units per packed position unit. */
  unit: number;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  extent: number;
  zoom: number;
  interp: MeshData["interp"];
  rawLen: number;
  lastUsed: number;
}

interface Texture {
  name: string;
  source: Exclude<TextureSource, string>;
  tex: WebGLTexture | null;
}

type Status = "pending" | "active" | "suspended" | "absent" | "detached";

/** `out = a · b`, column-major 4×4, float64. */
function mul(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${label} shader failed to compile: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsSource: string, fs: string, label: string): WebGLProgram {
  const prog = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource, "vertex");
  const fsh = compile(gl, gl.FRAGMENT_SHADER, fs, label);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fsh);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fsh);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`${label} program failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

/** Wait (bounded) for a named image to exist in the map's style. */
function waitForImage(map: MapLibreMap, name: string, ms: number): Promise<boolean> {
  if (map.hasImage(name)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => {
      if (map.hasImage(name)) done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      map.off("styledata", check);
      map.off("data", check);
      resolve(ok);
    };
    const timer = setTimeout(() => done(map.hasImage(name)), ms);
    map.on("styledata", check);
    map.on("data", check);
  });
}

async function resolveTexture(map: MapLibreMap, name: string, src: TextureSource): Promise<Exclude<TextureSource, string>> {
  if (typeof src !== "string") return src;
  if (await waitForImage(map, src, src.includes("/") ? 0 : 10_000)) {
    const image = map.getImage(src) as unknown as {
      data?: { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
    } | null;
    if (image?.data?.data) return image.data;
  }
  if (src.includes("/")) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`texture "${name}" (${src}) failed to load: HTTP ${res.status}`);
    return createImageBitmap(await res.blob());
  }
  throw new Error(
    `texture "${name}" names image "${src}", which never appeared in the map — ` +
      "declare it under the document's `images:`"
  );
}

class ExtrusionEffect {
  status: Status = "pending";
  reason?: string;
  customLayerId: string;
  beforeId: string | undefined;
  readonly stats = {
    tilesDrawn: 0,
    meshes: 0,
    builds: 0,
    buildMs: 0,
    triangles: 0,
    fallbackDraws: 0,
    droppedBoundaryWalls: 0,
    cutWalls: 0,
    seamGroupsResolved: 0,
    seamWallsPatched: 0,
    maxFrameUploadMs: 0,
    placementOk: 0,
  };

  private readonly map: MapLibreMap;
  private readonly layerId: string;
  private readonly def: EffectDefinition<unknown>;
  private readonly params: unknown;
  private readonly cull: boolean;
  private readonly prepass: boolean;
  private readonly budget: number;
  private readonly workerUrl: string | URL | undefined;

  private tiles!: TileView;
  private sourceLayer = "";
  private exprs: { filter?: unknown; height?: unknown; base?: unknown } = {};
  private minzoom = 0;
  private maxzoom = 24;
  private uniforms: ResolvedUniform[] = [];
  private textures: Texture[] = [];
  private pool: MeshWorkerPool | null = null;
  private savedOpacity: unknown = undefined;
  private staticHidden = false;
  private anchor: [number, number] = [0, 0];
  private anchorMetresPerMerc = 1;
  private startTime = 0;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private depthProgram: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private depthLoc: Record<string, WebGLUniformLocation | null> = {};
  private readonly meshes = new Map<string, GpuMesh | null>();
  private readonly byCanonical = new Map<string, GpuMesh>();
  private readonly building = new Set<string>();
  private readonly ready = new Map<string, { data: MeshData | null; rawLen: number; ms: number; coord: TileCoord }>();
  private readonly patches = new Map<string, Array<{ vi: number; verts: Uint8Array }>>();
  private readonly seams: SeamRegistry;
  /** Diagnostic: false disables the seam stitching (A/B in the browser suite). */
  private readonly stitch: boolean;
  private frame = 0;
  private pendingWork = 0;
  private noRawFrames = 0;
  private readonly M = new Float64Array(16);
  private readonly T = new Float64Array(16);
  private readonly listeners: Array<[string, (...args: unknown[]) => void]> = [];
  private readonly custom: CustomLayerInterface;

  constructor(ctx: BackendContext<unknown>) {
    this.map = ctx.map;
    this.layerId = ctx.layerId;
    this.def = ctx.definition;
    this.params = ctx.params;
    this.cull = ctx.options.cull ?? true;
    this.prepass = ctx.options.prepass ?? true;
    this.budget = ctx.options.buildBudgetMs ?? 12;
    this.workerUrl = ctx.options.workerUrl;
    this.stitch = ctx.options.seams ?? true;
    this.customLayerId = `${ctx.layerId}::fx-${ctx.definition.type}`;
    this.seams = new SeamRegistry((meshKey, vi, verts) => {
      const list = this.patches.get(meshKey) ?? [];
      list.push({ vi, verts });
      this.patches.set(meshKey, list);
    });
    this.custom = {
      id: this.customLayerId,
      type: "custom",
      renderingMode: "3d",
      onAdd: (_map, gl) => {
        this.gl = gl as WebGL2RenderingContext;
      },
      render: (gl, args) => this.render(gl as WebGL2RenderingContext, args),
      onRemove: () => this.freeGl(),
    };
  }

  // ------------------------------------------------------------------ setup

  /** Synchronous checks, then the async start. */
  start(): void {
    const reason = this.check();
    if (reason) {
      this.absent(reason);
      return;
    }
    void this.startAsync().catch((err: unknown) => this.absent(err instanceof Error ? err.message : String(err)));
  }

  private check(): string | undefined {
    const map = this.map;
    const layer = map.getLayer(this.layerId) as
      | { type: string; source?: string; sourceLayer?: string; minzoom?: number; maxzoom?: number }
      | undefined;
    if (!layer) return `layer "${this.layerId}" is not in the map`;
    if (layer.type !== "fill-extrusion") {
      return `the extrusions backend enhances fill-extrusion layers; "${this.layerId}" is ${layer.type}`;
    }
    const sourceId = layer.source;
    const source = sourceId
      ? (map.getStyle()?.sources?.[sourceId] as { type?: string; encoding?: string } | undefined)
      : undefined;
    if (!source || (source.type !== "vector" && source.type !== "geojson")) {
      return `"${this.layerId}" must draw from a vector or geojson source`;
    }
    if (source.encoding && source.encoding !== "mvt") {
      return `source "${sourceId}" uses ${source.encoding} tiles; the backend decodes Mapbox Vector Tiles only`;
    }
    this.sourceLayer = layer.sourceLayer ?? (source.type === "geojson" ? "_geojsonTileLayer" : "");
    if (!this.sourceLayer) return `"${this.layerId}" has no source-layer`;
    if (!isMercator(map)) return "the map uses a non-mercator projection (globe); effects are mercator-only";
    if (hasTerrain(map)) return "3D terrain is enabled; effects do not drape onto terrain";
    const canvas = map.getCanvas();
    if (!(canvas.getContext("webgl2") instanceof WebGL2RenderingContext)) {
      return "the map is not rendering with WebGL2";
    }
    const probe = probeTiles(map, sourceId!);
    if (!probe.ok) return probe.reason;
    this.tiles = probe.value;
    this.minzoom = layer.minzoom ?? 0;
    this.maxzoom = layer.maxzoom ?? 24;
    this.exprs = {
      filter: map.getFilter(this.layerId) ?? undefined,
      height: map.getPaintProperty(this.layerId, "fill-extrusion-height"),
      base: map.getPaintProperty(this.layerId, "fill-extrusion-base"),
    };
    try {
      const values = this.def.uniforms?.(this.params) ?? {};
      this.uniforms = Object.entries(values).map(([name, value]) => resolveUniform(this.def.type, name, value));
      for (const name of Object.keys(this.def.textures?.(this.params) ?? {})) checkUniformName(this.def.type, name);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return undefined;
  }

  private async startAsync(): Promise<void> {
    const map = this.map;
    // Placement reads the live layer order, which is only final once the
    // style has loaded (the spike's silent-placement lesson).
    if (!map.isStyleLoaded()) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (map.isStyleLoaded()) {
            map.off("idle", check);
            resolve();
          }
        };
        map.on("idle", check);
        map.triggerRepaint();
      });
    }
    const textures = this.def.textures?.(this.params) ?? {};
    for (const [name, src] of Object.entries(textures)) {
      this.textures.push({ name, source: await resolveTexture(map, name, src), tex: null });
    }
    if (this.status !== "pending") return; // detached meanwhile
    this.pool = acquirePool(this.workerUrl);

    const c = map.getCenter();
    const latRad = (c.lat * Math.PI) / 180;
    this.anchorMetresPerMerc = EARTH_CIRCUMFERENCE * Math.cos(latRad);
    // world-metre anchor: the map centre snapped to a 1 km grid, so grids
    // whose period divides 1 km stay put across re-attaches
    const mx = (c.lng + 180) / 360;
    const my = (1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2;
    const snap = (v: number) => (Math.round((v * this.anchorMetresPerMerc) / 1000) * 1000) / this.anchorMetresPerMerc;
    this.anchor = [snap(mx), snap(my)];
    this.startTime = performance.now();

    this.on("webglcontextlost", () => this.onContextLost());
    this.on("webglcontextrestored", () => this.onContextRestored());
    this.on("projectiontransition", () => this.onEnvironmentChange());
    this.on("terrain", () => this.onEnvironmentChange());

    this.status = "active";
    this.install();
  }

  private on(event: string, fn: (...args: unknown[]) => void): void {
    this.map.on(event as never, fn as never);
    this.listeners.push([event, fn]);
  }

  /** Add the custom layer in the static layer's slot and hide the static layer. */
  private install(): void {
    const map = this.map;
    const order = layerOrder(map);
    const idx = order.indexOf(this.layerId);
    this.beforeId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;
    if (this.beforeId === this.customLayerId) this.beforeId = order[idx + 2];
    if (!map.getLayer(this.customLayerId)) {
      map.addLayer(this.custom, this.beforeId && map.getLayer(this.beforeId) ? this.beforeId : undefined);
    }
    this.hideStatic();
    const after = layerOrder(map);
    const at = after.indexOf(this.customLayerId);
    const ok = after[at - 1] === this.layerId && (!this.beforeId || after[at + 1] === this.beforeId);
    this.stats.placementOk = ok ? 1 : 0;
    if (!ok) warnOnce(`[effects] ${this.def.type} on "${this.layerId}": could not take the static layer's slot`);
  }

  private uninstall(): void {
    const map = this.map;
    try {
      if (map.getLayer(this.customLayerId)) map.removeLayer(this.customLayerId);
    } catch {
      /* the map may already be removed */
    }
    this.showStatic();
  }

  private hideStatic(): void {
    if (this.staticHidden || !this.map.getLayer(this.layerId)) return;
    this.savedOpacity = this.map.getPaintProperty(this.layerId, "fill-extrusion-opacity");
    this.map.setPaintProperty(this.layerId, "fill-extrusion-opacity", 0);
    this.staticHidden = true;
  }

  private showStatic(): void {
    if (!this.staticHidden) return;
    this.staticHidden = false;
    try {
      if (this.map.getLayer(this.layerId)) {
        this.map.setPaintProperty(this.layerId, "fill-extrusion-opacity", this.savedOpacity as never);
      }
    } catch {
      /* the map may already be removed */
    }
  }

  /** Declare absence: warn once, keep the static layer. */
  absent(reason: string): void {
    if (this.status === "absent" || this.status === "detached") return;
    this.reason = reason;
    warnOnce(
      `[effects] ${this.def.type} on "${this.layerId}" is not drawn (${reason}); ` +
        "the static layer renders instead — its declared fallback."
    );
    this.status = "absent";
    this.teardown();
  }

  private onEnvironmentChange(): void {
    const unsupported = !isMercator(this.map) || hasTerrain(this.map);
    if (unsupported && this.status === "active") {
      this.status = "suspended";
      this.uninstall();
    } else if (!unsupported && this.status === "suspended") {
      this.status = "active";
      this.install();
    }
  }

  private onContextLost(): void {
    // Every GL handle died with the context.
    this.program = null;
    this.depthProgram = null;
    for (const t of this.textures) t.tex = null;
    this.meshes.clear();
    this.byCanonical.clear();
    this.ready.clear();
    this.patches.clear();
    this.seams.clear();
  }

  private onContextRestored(): void {
    // MapLibre re-applies its serialized style but drops custom layers.
    const again = () => {
      if (this.status !== "active" || this.map.getLayer(this.customLayerId)) return;
      if (!this.map.isStyleLoaded()) {
        this.map.once("idle", again);
        this.map.triggerRepaint();
        return;
      }
      this.staticHidden = false;
      this.install();
    };
    again();
  }

  // ------------------------------------------------------------------ GL

  private initGl(gl: WebGL2RenderingContext): void {
    const fs = buildFragmentShader(
      this.def.fragment,
      this.uniforms,
      this.textures.map((t) => t.name)
    );
    this.program = link(gl, VERTEX_SHADER, fs, `effect "${this.def.type}"`);
    this.depthProgram = link(gl, DEPTH_VERTEX_SHADER, DEPTH_FRAGMENT_SHADER, "depth");
    const names = ["u_fx_matrix", "u_fx_unit", "u_fx_zt", "u_fx_zex", "u_fx_mpu", "u_fx_origin", "u_fx_time"];
    this.loc = {};
    this.depthLoc = {};
    for (const n of names) {
      this.loc[n] = gl.getUniformLocation(this.program, n);
      this.depthLoc[n] = gl.getUniformLocation(this.depthProgram, n);
    }
    for (const u of this.uniforms) this.loc[u.name] = gl.getUniformLocation(this.program, u.name);
    for (const t of this.textures) {
      this.loc[t.name] = gl.getUniformLocation(this.program, t.name);
      t.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const s = t.source as { width: number; height: number; data?: Uint8Array | Uint8ClampedArray };
      if (s.data && !(t.source instanceof ImageData)) {
        const data = s.data instanceof Uint8Array ? s.data : new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.byteLength);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, s.width, s.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source as TexImageSource);
      }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
  }

  private upload(gl: WebGL2RenderingContext, key: string, m: MeshData, rawLen: number, zoom: number): GpuMesh {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vertices, gl.STATIC_DRAW);
    const stride = VERTEX_BYTES;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, stride, VB.posz);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, true, stride, VB.uv);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.HALF_FLOAT, false, stride, VB.fh);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.BYTE, true, stride, VB.nrm);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.HALF_FLOAT, false, stride, VB.facew);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.stats.triangles += m.indices.length / 3;
    this.stats.droppedBoundaryWalls += m.droppedBoundaryWalls;
    return {
      key, vao, vbo, ibo,
      unit: 1 / m.posScale,
      count: m.indices.length,
      extent: m.extent,
      zoom,
      interp: m.interp,
      rawLen,
      lastUsed: this.frame,
    };
  }

  private free(m: GpuMesh | null | undefined): void {
    const gl = this.gl;
    if (!m || !gl) return;
    gl.deleteVertexArray(m.vao);
    gl.deleteBuffer(m.vbo);
    gl.deleteBuffer(m.ibo);
  }

  private freeGl(): void {
    const gl = this.gl;
    if (gl) {
      for (const m of this.meshes.values()) this.free(m);
      if (this.program) gl.deleteProgram(this.program);
      if (this.depthProgram) gl.deleteProgram(this.depthProgram);
      for (const t of this.textures) if (t.tex) gl.deleteTexture(t.tex);
    }
    for (const t of this.textures) t.tex = null;
    this.meshes.clear();
    this.byCanonical.clear();
    this.patches.clear();
    this.seams.clear();
    this.program = null;
    this.depthProgram = null;
  }

  // ------------------------------------------------------------------ frame

  private render(gl: WebGL2RenderingContext, args: unknown): void {
    this.frame++;
    this.stats.tilesDrawn = 0;
    if (this.status !== "active") return;
    const map = this.map;
    const main = probeMainMatrix(args);
    if (!main) {
      setTimeout(() =>
        this.absent("the custom-layer render arguments carry no defaultProjectionData (maplibre-gl 5 required)")
      );
      return;
    }
    const zoom = map.getZoom();
    if (zoom < this.minzoom || zoom >= this.maxzoom) return;
    this.gl = gl;
    if (!this.program) {
      try {
        this.initGl(gl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setTimeout(() => this.absent(message));
        return;
      }
    }

    const t0 = performance.now();
    let pending = 0;

    // Finished worker builds: upload under the frame budget (GL work must
    // happen inside render()).
    for (const [key, r] of this.ready) {
      if (performance.now() - t0 > this.budget) {
        pending++;
        break;
      }
      this.free(this.meshes.get(key));
      this.seams.remove(key);
      const { z, x, y } = r.coord.canonical;
      const mesh = r.data ? this.upload(gl, key, r.data, r.rawLen, r.coord.overscaledZ) : null;
      this.meshes.set(key, mesh);
      if (mesh) this.byCanonical.set(`${z}/${x}/${y}`, mesh);
      if (r.data && r.data.cuts.length && this.stitch) {
        const cuts = readCuts(r.data.cuts);
        this.stats.cutWalls += cuts.length;
        this.seams.add(
          key,
          { z, x, y },
          r.data.extent,
          cuts,
          r.data.vertices,
          this.tiles.reencoded(r.coord) ? REENCODED_DRIFT_UNITS : 0
        );
      }
      this.ready.delete(key);
      this.stats.builds++;
      this.stats.buildMs += r.ms;
    }
    // Seam patches for uploaded meshes.
    if (this.patches.size) {
      for (const [key, list] of this.patches) {
        const mesh = this.meshes.get(key);
        if (mesh) {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
          for (const p of list) gl.bufferSubData(gl.ARRAY_BUFFER, p.vi * VERTEX_BYTES, p.verts);
        }
      }
      this.patches.clear();
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    this.stats.seamGroupsResolved = this.seams.resolvedGroups;
    this.stats.seamWallsPatched = this.seams.patchedWalls;

    // Heights: metres → mercator at the map centre (what fill-extrusion
    // does), × the effect's height scale.
    const lat = (map.getCenter().lat * Math.PI) / 180;
    const zMerc = 1 / (EARTH_CIRCUMFERENCE * Math.cos(lat));
    const zex = this.def.heightScale?.(zoom, this.params) ?? 1;
    const draws: Array<{ mesh: GpuMesh; matrix: Float32Array; mpu: number; origin: [number, number] }> = [];
    const drawn = new Set<string>();
    const T = this.T, M = this.M;
    const pushDraw = (mesh: GpuMesh, z: number, x: number, y: number, wrap: number) => {
      const dk = `${mesh.key}@${wrap}`;
      if (drawn.has(dk)) return;
      drawn.add(dk);
      mesh.lastUsed = this.frame;
      const n = 2 ** z;
      const s = 1 / (n * mesh.extent);
      T.fill(0);
      T[0] = s;
      T[5] = s;
      T[10] = zMerc;
      T[15] = 1;
      T[12] = (x + wrap * n) / n;
      T[13] = y / n;
      mul(M, main, T);
      draws.push({
        mesh,
        matrix: Float32Array.from(M),
        mpu: this.anchorMetresPerMerc / (n * mesh.extent),
        origin: [
          ((x + wrap * n) / n - this.anchor[0]) * this.anchorMetresPerMerc,
          -(y / n - this.anchor[1]) * this.anchorMetresPerMerc,
        ],
      });
    };
    /**
     * While a tile builds, draw what MapLibre would: the same tile at
     * another zoom, the nearest cached ancestor, else whichever cached
     * children exist — no holes, no pops.
     */
    const fallback = (z: number, x: number, y: number, wrap: number): boolean => {
      const same = this.byCanonical.get(`${z}/${x}/${y}`);
      if (same) {
        pushDraw(same, z, x, y, wrap);
        return true;
      }
      for (let dz = 1; dz <= 4 && z - dz >= 0; dz++) {
        const m = this.byCanonical.get(`${z - dz}/${x >> dz}/${y >> dz}`);
        if (m) {
          pushDraw(m, z - dz, x >> dz, y >> dz, wrap);
          return true;
        }
      }
      let any = false;
      for (let i = 0; i < 4; i++) {
        const cx = x * 2 + (i & 1), cy = y * 2 + (i >> 1);
        const m = this.byCanonical.get(`${z + 1}/${cx}/${cy}`);
        if (m) {
          pushDraw(m, z + 1, cx, cy, wrap);
          any = true;
        }
      }
      return any;
    };

    let loadedWithoutBytes = 0;
    let loadedTiles = 0;
    for (const coord of this.tiles.coords()) {
      const { z, x, y } = coord.canonical;
      const key = `${coord.overscaledZ}/${z}/${x}/${y}`;
      const raw = this.tiles.raw(coord);
      if (this.tiles.loaded(coord)) {
        loadedTiles++;
        if (!raw) loadedWithoutBytes++;
      }
      let mesh = this.meshes.get(key);
      const stale = mesh !== undefined && mesh !== null && raw !== null && mesh.rawLen !== raw.byteLength;
      if (raw && (mesh === undefined || stale) && !this.building.has(key) && !this.ready.has(key) && this.pool) {
        this.building.add(key);
        const rawLen = raw.byteLength;
        this.pool
          .build({
            // a copy: the bytes are MapLibre's and must not be transferred away
            raw: raw.slice(0),
            sourceLayer: this.sourceLayer,
            ...this.exprs,
            rootKey: `layers.${this.layerId}`,
            z, x, y,
            zoom: coord.overscaledZ,
          })
          .then((r) => this.ready.set(key, { data: r.mesh, rawLen, ms: r.ms, coord }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            if (err instanceof WorkerUnavailableError) this.absent(message);
            else this.absent(`the static layer's expressions could not be evaluated: ${message}`);
          })
          .finally(() => {
            this.building.delete(key);
            if (this.status === "active") map.triggerRepaint();
          });
      }
      // No bytes yet = MapLibre is still loading the tile; its arrival
      // triggers a render on its own, so no repaint request here.
      mesh = this.meshes.get(key);
      if (mesh) pushDraw(mesh, z, x, y, coord.wrap);
      else if (mesh === undefined && fallback(z, x, y, coord.wrap)) this.stats.fallbackDraws++;
    }
    // Loaded tiles that never expose their bytes mean the internal is gone.
    if (loadedTiles > 0 && loadedWithoutBytes === loadedTiles) {
      if (++this.noRawFrames > 30) {
        setTimeout(() => this.absent("MapLibre's tiles expose no raw bytes (tile.latestRawTileData)"));
        return;
      }
    } else this.noRawFrames = 0;
    this.stats.maxFrameUploadMs = Math.max(this.stats.maxFrameUploadMs, performance.now() - t0);

    if (this.cull) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      // walls and roofs are wound clockwise seen from outside
      gl.frontFace(gl.CW);
    } else gl.disable(gl.CULL_FACE);

    const setCommon = (loc: Record<string, WebGLUniformLocation | null>, d: (typeof draws)[number]) => {
      gl.uniformMatrix4fv(loc["u_fx_matrix"]!, false, d.matrix);
      gl.uniform1f(loc["u_fx_unit"]!, d.mesh.unit);
      // One blend factor for the vertex's own height: the height's when it
      // varies with zoom, else the base's (when only one of the two varies,
      // the other's lo == hi and any factor is exact; both zoom-dependent
      // with different curve types is approximated by the height's curve).
      const { height, base } = d.mesh.interp;
      gl.uniform1f(loc["u_fx_zt"]!, zoomFactor(height.zoomDependent ? height : base, zoom, d.mesh.zoom));
    };

    if (this.prepass && draws.length) {
      gl.useProgram(this.depthProgram);
      gl.uniform1f(this.depthLoc["u_fx_zex"]!, zex);
      gl.colorMask(false, false, false, false);
      for (const d of draws) {
        setCommon(this.depthLoc, d);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_INT, 0);
      }
      gl.colorMask(true, true, true, true);
    }

    gl.useProgram(this.program);
    gl.uniform1f(this.loc["u_fx_zex"]!, zex);
    gl.uniform1f(this.loc["u_fx_time"]!, this.def.animated ? (performance.now() - this.startTime) / 1000 : 0);
    for (const u of this.uniforms) {
      const l = this.loc[u.name];
      if (!l) continue;
      if (u.type === "float") gl.uniform1f(l, u.value[0]!);
      else if (u.type === "bool") gl.uniform1i(l, u.value[0]!);
      else if (u.type === "vec2") gl.uniform2fv(l, u.value);
      else if (u.type === "vec3") gl.uniform3fv(l, u.value);
      else gl.uniform4fv(l, u.value);
    }
    this.textures.forEach((t, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      const l = this.loc[t.name];
      if (l) gl.uniform1i(l, unit);
    });
    for (const d of draws) {
      setCommon(this.loc, d);
      gl.uniform1f(this.loc["u_fx_mpu"]!, d.mpu);
      gl.uniform2f(this.loc["u_fx_origin"]!, d.origin[0], d.origin[1]);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_INT, 0);
    }
    this.stats.tilesDrawn = draws.length;
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);

    this.pendingWork = pending + this.building.size + this.ready.size;
    if (pending > 0 || this.ready.size > 0 || this.patches.size > 0 || this.def.animated) map.triggerRepaint();

    // Evict meshes unused for ~10 s of frames once the cache grows.
    if (this.meshes.size > 96) {
      for (const [k, m] of this.meshes) {
        if (!m || this.frame - m.lastUsed > 600) {
          this.free(m);
          this.meshes.delete(k);
          this.seams.remove(k);
          if (m) {
            const c = k.split("/").slice(1).join("/");
            if (this.byCanonical.get(c) === m) this.byCanonical.delete(c);
          }
        }
      }
    }
    this.stats.meshes = this.meshes.size;
  }

  // ------------------------------------------------------------------ handle

  seamReport() {
    return this.seams.report();
  }

  readyPromise(): Promise<void> {
    return new Promise<void>((resolve) => {
      const poll = () => {
        if (this.status === "absent" || this.status === "detached" || this.status === "suspended") return resolve();
        const map = this.map;
        const zoom = map.getZoom();
        const idleOk =
          this.status === "active" &&
          this.pendingWork === 0 &&
          this.ready.size === 0 &&
          this.building.size === 0 &&
          map.loaded() &&
          (this.stats.builds > 0 || zoom < this.minzoom || zoom >= this.maxzoom);
        if (idleOk) resolve();
        else {
          map.once("idle", poll);
          map.triggerRepaint();
        }
      };
      poll();
    });
  }

  private teardown(): void {
    for (const [event, fn] of this.listeners) this.map.off(event as never, fn as never);
    this.listeners.length = 0;
    this.uninstall();
    if (this.pool) releasePool(this.pool);
    this.pool = null;
  }

  detach(): void {
    if (this.status === "detached") return;
    const wasAbsent = this.status === "absent";
    this.status = "detached";
    if (!wasAbsent) this.teardown();
  }
}

/**
 * The extrusions backend: shader effects on `fill-extrusion` layers.
 *
 * @experimental
 */
export const extrusions: Backend = {
  name: "extrusions",
  layerTypes: ["fill-extrusion"],
  attach<P>(ctx: BackendContext<P>): BackendHandle {
    const fx = new ExtrusionEffect(ctx as BackendContext<unknown>);
    fx.start();
    return {
      get active() {
        return fx.status === "active" || fx.status === "pending";
      },
      get reason() {
        return fx.reason;
      },
      get stats() {
        return fx.stats;
      },
      get customLayerId() {
        return fx.customLayerId;
      },
      get beforeId() {
        return fx.beforeId;
      },
      debug: { seams: () => fx.seamReport() },
      ready: () => fx.readyPromise(),
      detach: () => fx.detach(),
    } as BackendHandle;
  },
};
