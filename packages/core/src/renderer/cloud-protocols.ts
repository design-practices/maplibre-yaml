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
import { getDecoder, hasDecoder, prefetchDecoder } from "../formats/decoders";
import { install as installPmtiles } from "../formats/pmtiles";
import { install as installCog } from "../formats/cog-protocol";
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
 * before maplibre-yaml can see inside. Registration is synchronous, before
 * the map is constructed, so the style's first TileJSON and tile requests can
 * never race it; it costs nothing, because the handler downloads the reader
 * (`chunks/pmtiles.js`) only when the first request arrives. A page's own
 * registration is left alone (host wins). `cog://` is registered the same
 * way (ml-cnv.2): its handler downloads `chunks/cog.js` on a COG's first
 * request.
 *
 * @returns `undefined` when the document's own sources need no protocol;
 *   otherwise a promise (never rejecting) of the formats whose reader could
 *   not be set up or downloaded, with the error — awaited before the
 *   document's sources are added; their sources are reported and skipped.
 *   The reader's download starts here, in parallel with the basemap. A
 *   failure that only a basemap would hit is kept for
 *   {@link pmtilesUnavailable}.
 */
export function prepareProtocols(
  sources: unknown,
  layers: unknown,
  mapStyle?: unknown
): Promise<Map<CloudFormat, Error>> | undefined {
  const needed = formatsIn(sources, layers);
  for (const f of formatsIn(inlineStyleSources(mapStyle), [])) needed.add(f);
  const failed = new Map<CloudFormat, Error>();
  const host = () =>
    ({
      addProtocol: addProtocol as never,
      config: (maplibregl as unknown as { config?: { REGISTERED_PROTOCOLS?: Obj } }).config,
      version: runtimeVersion(),
      module: maplibregl as unknown as object,
    }) as never;
  // Which protocols core's own handler serves (not the page's: host wins).
  const ours = new Set<CloudFormat>();
  try {
    if (installPmtiles(host()) !== "host") ours.add("pmtiles");
  } catch (error) {
    pmtilesProblem = error instanceof Error ? error : new Error(String(error));
    failed.set("pmtiles", pmtilesProblem);
  }
  try {
    if (installCog(host()) !== "host") ours.add("cog");
  } catch (error) {
    if (needed.has("cog")) failed.set("cog", error instanceof Error ? error : new Error(String(error)));
  }
  // Every on-demand reader the document's own sources need starts
  // downloading now, in parallel with maplibre-gl's style and tiles (not a
  // protocol's when the page's own handler serves it).
  const protocols: CloudFormat[] = ["pmtiles", "cog"];
  for (const format of needed) {
    if (hasDecoder(format) && (!protocols.includes(format) || ours.has(format))) prefetchDecoder(format);
  }
  const waitFor = protocols.filter((f) => needed.has(f) && ours.has(f) && !failed.has(f));
  if (!protocols.some((f) => needed.has(f))) return undefined;
  // The page's own handler serves these sources: no reader of ours to wait on.
  return Promise.all(
    waitFor.map((format) =>
      getDecoder(format as "pmtiles" | "cog").then(
        () => undefined,
        (error: unknown) => {
          failed.set(format, error instanceof Error ? error : new Error(String(error)));
        }
      )
    )
  ).then(() => failed);
}
