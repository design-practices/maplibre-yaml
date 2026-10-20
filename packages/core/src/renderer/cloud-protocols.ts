/**
 * @file Cloud-native tile protocols on the renderer's maplibre-gl module (0.9, ml-cnv)
 * @module @maplibre-yaml/core/renderer/cloud-protocols
 *
 * @description
 * The one part of cloud-native support that touches the maplibre-gl module
 * itself: registering `pmtiles://` on the module the renderer constructs maps
 * from (the module identity `@maplibre-yaml/core/maplibre` guarantees), and
 * reading which protocols a page already registered. Kept apart from
 * `cloud-sources.ts` so the layer manager, which only rewrites source specs
 * and reads FlatGeobuf, keeps loading without maplibre-gl — as it did before
 * 0.9. Only `MapRenderer` imports this, and it imports maplibre-gl anyway.
 */

import { formatsIn, type CloudFormat } from "../formats/detect";
import { getDecoder } from "../formats/decoders";
import { addProtocol, maplibregl, runtimeVersion } from "./maplibre-interop";

type Obj = Record<string, unknown>;

/** The module's protocol registry (`maplibregl.config`, public in maplibre-gl 4+). */
function registry(): Obj | undefined {
  return (maplibregl as unknown as { config?: { REGISTERED_PROTOCOLS?: Obj } }).config
    ?.REGISTERED_PROTOCOLS;
}

/** Whether a URL protocol is already registered on the renderer's module. */
export function isProtocolRegistered(scheme: string): boolean {
  return Boolean(registry()?.[scheme]);
}

/** The inline basemap style's sources, when the basemap is an object. */
function inlineStyleSources(mapStyle: unknown): unknown {
  return mapStyle && typeof mapStyle === "object" ? (mapStyle as Obj)["sources"] : undefined;
}

/**
 * Register the protocols a document needs (PMTiles), on the module the
 * renderer constructs maps from. Starts at once and resolves when done;
 * the renderer awaits it before adding the document's sources, never
 * before constructing the map (the basemap loads in parallel). A page's own
 * registration is left alone (host wins).
 *
 * @returns `undefined` when the document needs no protocol; otherwise the
 *   formats whose reader could not be set up, with the error — their
 *   sources are reported and skipped; everything else renders.
 */
export function prepareProtocols(
  sources: unknown,
  layers: unknown,
  mapStyle?: unknown
): Promise<Map<CloudFormat, Error>> | undefined {
  const needed = formatsIn(sources, layers);
  for (const f of formatsIn(inlineStyleSources(mapStyle), [])) needed.add(f);
  if (!needed.has("pmtiles")) return undefined;
  const failed = new Map<CloudFormat, Error>();
  return getDecoder("pmtiles")
    .then((pmtiles) => {
      pmtiles.install({
        addProtocol: addProtocol as never,
        config: (maplibregl as unknown as { config?: { REGISTERED_PROTOCOLS?: Obj } }).config,
        version: runtimeVersion(),
        module: maplibregl as unknown as object,
      });
    })
    .catch((error: unknown) => {
      failed.set("pmtiles", error instanceof Error ? error : new Error(String(error)));
    })
    .then(() => failed);
}
