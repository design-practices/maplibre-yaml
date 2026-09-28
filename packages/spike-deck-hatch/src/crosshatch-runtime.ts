/**
 * @file U12 SPIKE session 2 — the crosshatch-buildings effect runtime
 *
 * @description
 * Same contract as session 1's runtime: the effect rides an `x-effect` block
 * on an ordinary static layer (here the preset's `fill-extrusion` buildings),
 * and that static layer IS the fallback. The runtime:
 *
 *  - reads the static layer's vector source (TileJSON `url` or `tiles`) and
 *    `source-layer`, and draws the same buildings as a deck MVTLayer whose
 *    polygon sublayer is the CrosshatchLayer;
 *  - takes the static layer's slot (`beforeId` = the layer above it), hides
 *    the static layer, and tracks Tangram's zoom-dependent height
 *    exaggeration (the same curve the fallback's interpolate encodes).
 *
 * Tiles are fetched a second time by deck's loader (MapLibre already has
 * them) — a known cost of the MVTLayer route, measured, not hidden.
 */

import { MapLibreOverlay } from "@deck.gl/maplibre";
import { MVTLayer } from "@deck.gl/geo-layers";
import { MVTLoader } from "@loaders.gl/mvt";
import { ClipExtension } from "@deck.gl/extensions";

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
import type { Map as MapLibreMap } from "maplibre-gl";
import { CrosshatchLayer } from "./crosshatch-layer";

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

/** Tangram: position.z *= max(1, 0.5 + (1 - zoom/20) * 5). */
export const heightExaggeration = (zoom: number) => Math.max(1, 0.5 + (1 - zoom / 20) * 5);

export interface CrosshatchHandle {
  overlay: MapLibreOverlay;
  slots: { layerId: string; beforeId: string | undefined }[];
  placementOk: boolean;
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

export async function attachCrosshatch(
  map: MapLibreMap,
  doc: Doc,
  opts: {
    atlasUrl: string;
    /** diagnostic: deck's stock extrusion, no hatch shader */
    plain?: boolean;
    /** diagnostic: strip MVTLayer's per-tile ClipExtension */
    noClip?: boolean;
  }
): Promise<CrosshatchHandle> {
  await styleLoaded(map);
  const hatchImage = await createImageBitmap(await (await fetch(opts.atlasUrl)).blob());
  const order = map.getLayersOrder();

  const effects = doc.layers.filter((l) => l["x-effect"]?.type === "crosshatch-buildings");
  let pending = 0;
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

  const build = () =>
    specs.map(
      (s) =>
        new (opts.noClip ? NoClipMVTLayer : MVTLayer)({
          id: `${s.layerId}__fx-${s.gain}`,
          data: s.data,
          extent: s.extent,
          beforeId: s.beforeId,
          minZoom: 13,
          maxZoom: 14,
          // FINDING (session 2): loaders.gl fetches its MVT worker from
          // unpkg.com at runtime by default — a third-party request that
          // breaks under CSP/offline. worker:false parses on the main thread
          // (cost included in the perf numbers); U13 must bundle the worker.
          loaders: [MVTLoader],
          loadOptions: { mvt: { layers: [s.sourceLayer] }, worker: false },
          extruded: true,
          filled: true,
          stroked: false,
          material: true,
          visible: map.getZoom() >= s.minZoom,
          elevationScale: heightExaggeration(map.getZoom()),
          getElevation: (f: { properties: { render_height?: number } }) => f.properties.render_height ?? 10,
          getFillColor: [255, 255, 255, 255],
          onViewportLoad: () => {
            pending = 0;
            settle?.();
          },
          _subLayerProps: opts.plain
            ? {}
            : { "polygons-fill": { type: CrosshatchLayer, hatchImage, gain: s.gain } },
        } as never)
    );

  const overlay = new MapLibreOverlay({ interleaved: true, layers: build() });
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
  void pending;

  return {
    overlay,
    placementOk,
    slots: specs.map(({ layerId, beforeId }) => ({ layerId, beforeId })),
    loaded: () => loadedP,
    destroy() {
      map.off("zoom", onZoom);
      overlay.finalize();
      for (const s of specs) {
        if (map.getLayer(s.layerId)) map.setLayoutProperty(s.layerId, "visibility", "visible");
      }
    },
  };
}
