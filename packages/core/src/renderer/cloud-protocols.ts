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
import { bundledDecoder, getDecoder } from "../formats/decoders";
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

/** Why `pmtiles://` could not be registered on this module (maplibre-gl 3), if so. */
let pmtilesProblem: Error | undefined;

/** The reason `pmtiles://` is unavailable on this page, when it is (see {@link prepareProtocols}). */
export function pmtilesUnavailable(): Error | undefined {
  return isProtocolRegistered("pmtiles") ? undefined : pmtilesProblem;
}

/**
 * Register `pmtiles://` on the module the renderer constructs maps from —
 * always, not only for a document whose own sources use it: a basemap style
 * loaded from a URL (`mapStyle:` / `basemap:`, a Protomaps basemap or one
 * self-hosted beside the site) may use `pmtiles://`, and MapLibre loads it
 * before maplibre-yaml can see inside. The reader is bundled, so this costs
 * nothing, and it runs synchronously, before the map is constructed: the
 * style's first TileJSON and tile requests can never race it. A page's own
 * registration is left alone (host wins).
 *
 * @returns `undefined` when the document's own sources need no protocol;
 *   otherwise a settled promise of the formats whose reader could not be
 *   set up, with the error (awaited before the document's sources are
 *   added; their sources are reported and skipped). A failure that only a
 *   basemap would hit is kept for {@link pmtilesUnavailable}.
 */
export function prepareProtocols(
  sources: unknown,
  layers: unknown,
  mapStyle?: unknown
): Promise<Map<CloudFormat, Error>> | undefined {
  const needed = formatsIn(sources, layers);
  for (const f of formatsIn(inlineStyleSources(mapStyle), [])) needed.add(f);
  const failed = new Map<CloudFormat, Error>();
  const install = (pmtiles: { install: (host: never) => unknown }) =>
    pmtiles.install({
      addProtocol: addProtocol as never,
      config: (maplibregl as unknown as { config?: { REGISTERED_PROTOCOLS?: Obj } }).config,
      version: runtimeVersion(),
      module: maplibregl as unknown as object,
    } as never);
  const bundled = bundledDecoder("pmtiles");
  if (bundled) {
    try {
      install(bundled);
    } catch (error) {
      pmtilesProblem = error instanceof Error ? error : new Error(String(error));
      failed.set("pmtiles", pmtilesProblem);
    }
    return needed.has("pmtiles") ? Promise.resolve(failed) : undefined;
  }
  // A reader moved to an on-demand chunk (not in 0.9): register when loaded.
  const loading = getDecoder("pmtiles")
    .then(install)
    .catch((error: unknown) => {
      pmtilesProblem = error instanceof Error ? error : new Error(String(error));
      failed.set("pmtiles", pmtilesProblem);
    })
    .then(() => failed);
  return needed.has("pmtiles") ? loading : undefined;
}
