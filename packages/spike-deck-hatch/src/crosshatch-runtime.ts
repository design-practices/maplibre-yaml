/**
 * @file U12 SPIKE — the crosshatch-buildings effect runtime (route 1, deck.gl)
 *
 * @description
 * Same contract as session 1's runtime: the effect rides an `x-effect` block
 * on an ordinary static layer (here the preset's `fill-extrusion` buildings),
 * and that static layer IS the fallback. The runtime:
 *
 *  - reads the static layer's vector source and `source-layer`, and draws the
 *    same buildings through a deck MapLibreOverlay (interleaved);
 *  - takes the static layer's slot (`beforeId` = the layer above it), hides
 *    the static layer, and tracks Tangram's zoom-dependent height
 *    exaggeration (the same curve the fallback's interpolate encodes).
 *
 * Two geometry paths (session 3, `DeckTuning.geom`):
 *
 *  - `mvt` (session 2): MVTLayer → loaders.gl MVTLoader → SolidPolygonLayer
 *    subclass (CrosshatchLayer) with MVTLayer's per-tile ClipExtension.
 *  - `mesh` (session 3 default): TileLayer → one prebuilt, tile-clipped mesh
 *    per tile (route 2's builder) → CrosshatchMeshLayer. Tile bytes come
 *    from MapLibre's already-loaded tiles when present (`source: "maplibre"`),
 *    else a fetch; the mesh is built in a bundled local worker
 *    (`parse: "worker"`) or on the main thread.
 *
 * `loop: "map"` drives deck's animation loop from MapLibre's own `render`
 * events instead of requestAnimationFrame, so an idle map costs no wake-ups.
 */

import { MapLibreOverlay } from "@deck.gl/maplibre";
import { MVTLayer, TileLayer } from "@deck.gl/geo-layers";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { MVTLoader } from "@loaders.gl/mvt";
import { ClipExtension } from "@deck.gl/extensions";
import type { Map as MapLibreMap } from "maplibre-gl";
import { CrosshatchLayer } from "./crosshatch-layer";
import { CrosshatchMeshLayer, type TileMesh } from "./crosshatch-mesh-layer";
import { buildTileMesh } from "./crosshatch-mesh-build";

/**
 * Diagnostic (session 2): MVTLayer adds a ClipExtension to every tile on a
 * non-globe map; it clips by fragment `discard`, which disables early depth
 * rejection — on tall, overlapping extrusions that multiplies overdraw.
 * This variant strips it (tile-buffer geometry is then drawn unclipped).
 */
class NoClipMVTLayer extends MVTLayer {
  static override layerName = "NoClipMVTLayer";
  override renderSubLayers(props: never) {
    const sub = super.renderSubLayers(props) as unknown as {
      props: { extensions?: unknown[] };
      clone(p: object): unknown;
    };
    const ext = (sub.props.extensions ?? []).filter((e) => !(e instanceof ClipExtension));
    return sub.clone({ extensions: ext }) as never;
  }
}

interface DocLayer {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  minzoom?: number;
  "x-effect"?: { type: string; gain?: number };
}
interface Doc {
  sources: Record<string, { type: string; url?: string; tiles?: string[]; bounds?: [number, number, number, number] }>;
  layers: DocLayer[];
}

/**
 * Route-1 tuning knobs (session 3). Each is measured on its own; DECK_BEFORE
 * reproduces the session-2 route exactly, DECK_AFTER is the optimized route.
 */
export interface DeckTuning {
  /** geometry path: session 2's MVTLayer + SolidPolygonLayer, or prebuilt tile meshes */
  geom: "mvt" | "mesh";
  cull: boolean;
  prepass: boolean;
  minorLod: boolean;
  /** mesh only: a real mip chain for the atlas (changes the look; see createAtlasTexture) */
  mips: boolean;
  /**
   * mesh only: walls of building parts start at render_min_height (with the
   * from-the-ground v texcoord) instead of at the ground as deck's
   * SolidPolygonLayer draws them — less hidden wall area; ~0.4% of pixels differ
   */
  podiums: boolean;
  /** mvt only: skip deck's per-vertex gouraud lighting (unused by the hatch shader) */
  noMaterial: boolean;
  /** where the building bytes come from (mesh only; mvt always fetches) */
  source: "fetch" | "maplibre";
  /** tile parse: main thread, or a bundled local worker (mvt: loaders.gl's; mesh: ours) */
  parse: "main" | "worker";
  /** deck's animation loop: rAF polling (stock), or ticked by MapLibre `render` events */
  loop: "raf" | "map";
}
export const DECK_BEFORE: DeckTuning = {
  geom: "mvt",
  cull: false,
  prepass: false,
  minorLod: false,
  mips: false,
  podiums: false,
  noMaterial: false,
  source: "fetch",
  parse: "main",
  loop: "raf",
};
export const DECK_AFTER: DeckTuning = {
  geom: "mesh",
  cull: true,
  prepass: false,
  minorLod: false, // moot: route 1 samples mip level 0 only (see createAtlasTexture)
  mips: false, // faithful to session 2; mips=1 measured separately
  podiums: false, // faithful to session 2; podiums=1 measured separately
  noMaterial: true,
  source: "maplibre",
  parse: "worker",
  loop: "map",
};

/** Tangram: position.z *= max(1, 0.5 + (1 - zoom/20) * 5). */
export const heightExaggeration = (zoom: number) => Math.max(1, 0.5 + (1 - zoom / 20) * 5);

export interface DeckStats {
  tilesRequested: number;
  fromMapLibre: number;
  fetched: number;
  buildMs: number;
  workerBuilds: number;
  mainBuilds: number;
}

export interface CrosshatchHandle {
  overlay: MapLibreOverlay;
  slots: { layerId: string; beforeId: string | undefined }[];
  placementOk: boolean;
  tuning: DeckTuning;
  stats: DeckStats;
  /** Resolves when every visible building tile has loaded. */
  loaded(): Promise<void>;
  destroy(): void;
}

async function styleLoaded(map: MapLibreMap): Promise<void> {
  // Session-1 finding: MapLibreOverlay silently skips its interleaved groups
  // unless the style is loaded at attach time (it then draws over labels).
  if (map.isStyleLoaded()) return;
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

// --- tile bytes: MapLibre's loaded tiles first -----------------------------

type MlTile = { latestRawTileData?: ArrayBuffer; tileID: { canonical: { z: number; x: number; y: number } }; state?: string };
type MlTileManager = { getIds(): string[]; getTileByID(id: string): MlTile | undefined };

/**
 * Internal MapLibre 5 API (as route 2): `style.tileManagers[id]` (getIds /
 * getTileByID) and `Tile.latestRawTileData` (the raw PBF MapLibre keeps
 * for queries).
 */
function maplibreBytes(map: MapLibreMap, sourceId: string, z: number, x: number, y: number): ArrayBuffer | null {
  return maplibreTile(map, sourceId, z, x, y)?.latestRawTileData ?? null;
}

/** MapLibre's tile for this canonical ID (any state), if it has one in view. */
function maplibreTile(map: MapLibreMap, sourceId: string, z: number, x: number, y: number): MlTile | null {
  const tm = (map as unknown as { style?: { tileManagers?: Record<string, MlTileManager> } }).style?.tileManagers?.[sourceId];
  if (!tm) return null;
  let found: MlTile | null = null;
  for (const id of tm.getIds()) {
    const t = tm.getTileByID(id);
    const c = t?.tileID.canonical;
    if (c && c.z === z && c.x === x && c.y === y) {
      if (t!.latestRawTileData) return t!;
      found = t!;
    }
  }
  return found;
}

/** Wait (bounded) for MapLibre to finish loading this canonical tile. */
function waitForMaplibre(map: MapLibreMap, sourceId: string, z: number, x: number, y: number, ms: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const check = () => {
      const b = maplibreBytes(map, sourceId, z, x, y);
      if (b || signal?.aborted) done(b);
    };
    const done = (b: ArrayBuffer | null) => {
      clearTimeout(timer);
      map.off("sourcedata", check);
      resolve(b);
    };
    const timer = setTimeout(() => done(maplibreBytes(map, sourceId, z, x, y)), ms);
    map.on("sourcedata", check);
    check();
  });
}

// --- mesh builds: bundled local worker pool or main thread -----------------

interface BuildResult { mesh: TileMesh | null; ms: number }
export class MeshWorkers {
  private workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: BuildResult) => void; reject: (e: Error) => void }>();
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./crosshatch-mesh-worker.js", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; mesh?: TileMesh | null; ms?: number; error?: string }>) => {
        const p = this.waiting.get(e.data.id);
        this.waiting.delete(e.data.id);
        if (!p) return;
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve({ mesh: e.data.mesh ?? null, ms: e.data.ms ?? 0 });
      };
      this.workers.push(w);
    }
  }
  build(req: { url?: string; raw?: ArrayBuffer; sourceLayer: string; opts: object }): Promise<BuildResult> {
    const id = ++this.seq;
    const w = this.workers[this.next++ % this.workers.length]!;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      w.postMessage({ id, ...req });
    });
  }
  terminate() {
    for (const w of this.workers) w.terminate();
    for (const p of this.waiting.values()) p.resolve({ mesh: null, ms: 0 });
    this.waiting.clear();
  }
}

// --- the mesh tile layer ----------------------------------------------------

const WORLD_SIZE = 512; // deck common space (MVTLayer's constant)

type MeshTileProps = {
  hatchImage: ImageBitmap;
  gain: number;
  elevationScale: number;
  cull: boolean;
  prepass: boolean;
  minorLod: boolean;
  mips: boolean;
};
/** TileLayer whose tiles are prebuilt meshes, placed exactly as MVTLayer places its tiles. */
class CrosshatchTileLayer extends TileLayer<TileMesh | null, MeshTileProps> {
  static override layerName = "CrosshatchTileLayer";
  override renderSubLayers(props: never) {
    const p = props as unknown as { id: string; data: TileMesh | null; tile: { index: { x: number; y: number; z: number } } };
    const { x, y, z } = p.tile.index;
    const worldScale = 2 ** z;
    const xScale = WORLD_SIZE / worldScale;
    const own = this.props as unknown as MeshTileProps;
    return new CrosshatchMeshLayer({
      id: `${p.id}-mesh`,
      mesh: p.data,
      hatchImage: own.hatchImage,
      gain: own.gain,
      elevationScale: own.elevationScale,
      prepass: own.prepass,
      minorLod: own.minorLod,
      mips: own.mips,
      modelMatrix: [xScale, 0, 0, 0, 0, -xScale, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      coordinateOrigin: [(WORLD_SIZE * x) / worldScale, WORLD_SIZE * (1 - y / worldScale), 0],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      cull: own.cull,
    } as never) as never;
  }
}

// --- deck's animation loop, ticked by MapLibre ------------------------------

/**
 * A luma AnimationLoop `animationFrameProvider` whose frames are MapLibre's
 * `render` events. deck forwards every Deck prop to its AnimationLoop, so
 * this rides MapLibreOverlay props (undocumented for deck; the provider
 * itself is public luma API). While the map renders, deck ticks once per
 * frame as before; an idle map schedules nothing. Async tile arrivals wake
 * the map via `onTileLoad` → triggerRepaint.
 */
function mapFrameProvider(map: MapLibreMap) {
  let seq = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const onRender = () => {
    if (!pending.size) return;
    const cbs = [...pending.values()];
    pending.clear();
    const now = performance.now();
    for (const cb of cbs) cb(now);
  };
  map.on("render", onRender);
  return {
    provider: {
      requestAnimationFrame(cb: FrameRequestCallback) {
        pending.set(++seq, cb);
        return seq;
      },
      cancelAnimationFrame(id: number) {
        pending.delete(id);
      },
    },
    detach() {
      map.off("render", onRender);
      pending.clear();
    },
  };
}

export async function attachCrosshatch(
  map: MapLibreMap,
  doc: Doc,
  opts: {
    atlasUrl: string;
    /** diagnostic: deck's stock extrusion, no hatch shader */
    plain?: boolean;
    /** diagnostic: strip MVTLayer's per-tile ClipExtension */
    noClip?: boolean;
    /** session-3 tuning (see DeckTuning); omitted = the session-2 route */
    tuning?: Partial<DeckTuning>;
  }
): Promise<CrosshatchHandle> {
  const t: DeckTuning = { ...DECK_BEFORE, ...opts.tuning };
  await styleLoaded(map);
  const hatchImage = await createImageBitmap(await (await fetch(opts.atlasUrl)).blob());
  const order = map.getLayersOrder();
  const stats: DeckStats = { tilesRequested: 0, fromMapLibre: 0, fetched: 0, buildMs: 0, workerBuilds: 0, mainBuilds: 0 };

  const effects = doc.layers.filter((l) => l["x-effect"]?.type === "crosshatch-buildings");
  let settle: (() => void) | null = null;
  const loadedP = new Promise<void>((r) => (settle = r));

  const specs = effects.map((layer) => {
    if (layer.type !== "fill-extrusion" || !layer.source || !layer["source-layer"]) {
      throw new Error(`[crosshatch] ${layer.id}: needs a fill-extrusion layer on a vector source-layer`);
    }
    const src = doc.sources[layer.source]!;
    const idx = order.indexOf(layer.id);
    return {
      layerId: layer.id,
      sourceId: layer.source,
      beforeId: idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined,
      data: src.url ?? src.tiles!,
      // Honor the source's bounds so deck never requests tiles the source
      // doesn't have (deck's tile selection reaches farther into a pitched
      // horizon than MapLibre's).
      extent: src.bounds,
      sourceLayer: layer["source-layer"],
      minZoom: layer.minzoom ?? 0,
      gain: layer["x-effect"]!.gain ?? 0.72,
    };
  });

  const meshOpts = t.podiums ? { groundUV: true } : { wallsFromGround: true };
  const workers = t.geom === "mesh" && t.parse === "worker" ? new MeshWorkers(2) : null;

  /** mesh path: bytes (MapLibre's, else fetched) → mesh (worker or main thread). */
  const tileGetter = (s: (typeof specs)[number]) => {
    // MapLibre resolved the TileJSON already; its source knows the template.
    const template = () =>
      (map.getSource(s.sourceId) as unknown as { tiles?: string[] })?.tiles?.[0] ??
      (Array.isArray(s.data) ? s.data[0] : undefined);
    return async (tile: { index: { x: number; y: number; z: number }; signal?: AbortSignal }): Promise<TileMesh | null> => {
      const { x, y, z } = tile.index;
      stats.tilesRequested++;
      let raw: ArrayBuffer | null = null;
      if (t.source === "maplibre") {
        // MapLibre has it: take its bytes; is loading it: wait (bounded);
        // doesn't want it (deck's selection differs): fetch at once.
        raw =
          maplibreBytes(map, s.sourceId, z, x, y) ??
          (maplibreTile(map, s.sourceId, z, x, y) ? await waitForMaplibre(map, s.sourceId, z, x, y, 1500, tile.signal) : null);
        if (raw) stats.fromMapLibre++;
      }
      if (tile.signal?.aborted) return null;
      const url = raw ? undefined : template()?.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      if (!raw && !url) return null;
      if (!raw) stats.fetched++;
      if (workers) {
        // MapLibre keeps its bytes: send a copy (cheap next to the build)
        const r = await workers.build({ url, raw: raw ? raw.slice(0) : undefined, sourceLayer: s.sourceLayer, opts: meshOpts });
        stats.workerBuilds++;
        stats.buildMs += r.ms;
        return r.mesh;
      }
      if (!raw) {
        const res = await fetch(url!, { signal: tile.signal });
        raw = res.ok ? await res.arrayBuffer() : null;
        if (!raw) return null;
      }
      const t0 = performance.now();
      const m = buildTileMesh(raw, s.sourceLayer, meshOpts);
      stats.buildMs += performance.now() - t0;
      stats.mainBuilds++;
      return m;
    };
  };
  const getters = specs.map(tileGetter);

  const build = () =>
    specs.map((s, i) => {
      const common = {
        id: `${s.layerId}__fx-${s.gain}`,
        extent: s.extent,
        beforeId: s.beforeId,
        minZoom: 13,
        maxZoom: 14,
        visible: map.getZoom() >= s.minZoom,
        elevationScale: heightExaggeration(map.getZoom()),
        onViewportLoad: () => settle?.(),
        // with the map-driven loop, an async tile arrival must wake the map
        ...(t.loop === "map" ? { onTileLoad: () => map.triggerRepaint() } : {}),
      };
      if (t.geom === "mesh") {
        return new CrosshatchTileLayer({
          ...common,
          // the tile template MapLibre resolved from the TileJSON (a TileJSON
          // URL here would not be a template); getTileData ignores it anyway
          data: (map.getSource(s.sourceId) as unknown as { tiles?: string[] })?.tiles ?? s.data,
          getTileData: getters[i],
          hatchImage,
          gain: s.gain,
          cull: t.cull,
          prepass: t.prepass,
          minorLod: t.minorLod,
          mips: t.mips,
        } as never);
      }
      return new (opts.noClip ? NoClipMVTLayer : MVTLayer)({
        ...common,
        data: s.data,
        // FINDING (session 2): loaders.gl fetches its MVT worker from
        // unpkg.com at runtime by default — a third-party request that
        // breaks under CSP/offline. worker:false parses on the main thread;
        // parse:"worker" points loaders.gl at a local copy of mvt-worker.js
        // (copied into dist/ by the bundle script).
        loaders: [MVTLoader],
        loadOptions:
          t.parse === "worker"
            ? { mvt: { layers: [s.sourceLayer], workerUrl: new URL("./mvt-worker.js", import.meta.url).href }, worker: true }
            : { mvt: { layers: [s.sourceLayer] }, worker: false },
        extruded: true,
        filled: true,
        stroked: false,
        // the hatch shader ignores deck's gouraud colour: `material:false`
        // skips that per-vertex lighting (the hatch lights itself)
        material: !t.noMaterial,
        getElevation: (f: { properties: { render_height?: number } }) => f.properties.render_height ?? 10,
        getFillColor: [255, 255, 255, 255],
        _subLayerProps: opts.plain
          ? {}
          : {
              "polygons-fill": {
                type: CrosshatchLayer,
                hatchImage,
                gain: s.gain,
                cull: t.cull,
                prepass: t.prepass,
                minorLod: t.minorLod,
              },
            },
      } as never);
    });

  const loop = t.loop === "map" ? mapFrameProvider(map) : null;
  const overlay = new MapLibreOverlay({
    interleaved: true,
    layers: build(),
    ...(loop ? { animationFrameProvider: loop.provider } : {}),
  } as never);
  map.addControl(overlay as never);
  for (const s of specs) map.setLayoutProperty(s.layerId, "visibility", "none");
  const onZoom = () => overlay.setProps({ layers: build() });
  map.on("zoom", onZoom);

  const after = map.getLayersOrder();
  const placementOk = specs.every((s) => {
    const gid = s.beforeId ? `deck-maplibre-layer-group-before:${s.beforeId}` : "deck-maplibre-layer-group-last";
    const gi = after.indexOf(gid);
    return gi >= 0 && (s.beforeId === undefined || after[gi + 1] === s.beforeId);
  });
  if (!placementOk) console.warn("[crosshatch] interleaved placement FAILED — effect draws over labels");

  return {
    overlay,
    placementOk,
    tuning: t,
    stats,
    slots: specs.map(({ layerId, beforeId }) => ({ layerId, beforeId })),
    loaded: () => loadedP,
    destroy() {
      map.off("zoom", onZoom);
      overlay.finalize();
      loop?.detach();
      workers?.terminate();
      for (const s of specs) {
        if (map.getLayer(s.layerId)) map.setLayoutProperty(s.layerId, "visibility", "visible");
      }
    },
  };
}
