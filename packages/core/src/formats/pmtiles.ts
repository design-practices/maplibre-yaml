/**
 * @file PMTiles: register the `pmtiles://` protocol, once (0.9, ml-cnv.1)
 * @module @maplibre-yaml/core/formats/pmtiles
 *
 * @description
 * A PMTiles archive is one file of vector, raster or elevation tiles, read
 * with HTTP range requests. MapLibre reads it through a URL protocol
 * registered on the maplibre-gl *module* (not a map). Core registers it on
 * the module it renders with — the module identity
 * `@maplibre-yaml/core/maplibre` guarantees — so a YAML source with a
 * `.pmtiles` URL works with no page JavaScript.
 *
 * **The host wins.** A page that already registered `pmtiles` (the 0.7
 * page-JS route, a custom `Source`, auth headers) keeps its handler: core
 * neither replaces nor wraps it. Same rule as `setWorkerModuleUrl`. Such a
 * page's MLT archives get no `encoding: "mlt"` from their header (0.10):
 * its sources say `encoding: mlt` themselves.
 *
 * This module never imports maplibre-gl: the module is injected
 * ({@link install}).
 *
 * **The reader is downloaded on demand** (`chunks/pmtiles.js`, see
 * formats/decoders), but the protocol is still registered synchronously,
 * before the map is constructed: {@link install} registers a thin handler
 * at once, and the handler awaits the reader on the first TileJSON or tile
 * request. MapLibre's protocol handlers are async, so a basemap style's first
 * requests can never race the registration — they just wait for the reader.
 * What a failed request says (the library's errors in plain words, the
 * compressed-host check) travels in that chunk too (formats/lib/pmtiles.ts,
 * bundle headroom U5), handed core's error and range check as a
 * {@link PmtilesHost}.
 */

import type { Protocol } from "pmtiles";
import type { PmtilesHost } from "../renderer/cloud-host";
import { getDecoder, type Decoders } from "./decoders";
import { FormatError, formatError, isAbortError, isFormatError } from "./errors";
import { rangeRepliesUnreadable } from "./http";

/** The slice of the maplibre-gl module this decoder needs (injected). */
export interface ProtocolHost {
  /** `maplibregl.addProtocol`. */
  addProtocol: (name: string, handler: never) => void;
  /** `maplibregl.config` (public in maplibre-gl 4+), for the host-wins check. */
  config?: { REGISTERED_PROTOCOLS?: Record<string, unknown> };
  /** The running maplibre-gl version, when known. */
  version?: string;
  /** The module itself: one registration per module per page. */
  module?: object;
}

/** What {@link install} did. */
export type InstallResult = "installed" | "host" | "already";

/** Modules this core has registered on (one registration per module per page). */
const installedOn = new WeakSet<object>();

/** The reader core's handler created last: its archives' headers are already read. */
let latestReader: Promise<Protocol> | undefined;

/**
 * An archive's JSON metadata (`name`, `version`, `vector_layers` …), read
 * through the reader core's `pmtiles://` handler already holds for it when
 * there is one (its header is cached; the metadata is one more range read),
 * else through a reader of its own.
 *
 * @param url - The archive URL, `pmtiles://` scheme or not.
 * @returns `undefined` when it can't be read.
 */
export async function archiveMetadata(url: string): Promise<Record<string, unknown> | undefined> {
  const archive = url.replace(/^pmtiles:\/\//i, "");
  try {
    const protocol = latestReader ? await latestReader : undefined;
    const held = (protocol as unknown as { tiles?: Map<string, { getMetadata(): Promise<unknown> }> } | undefined)?.tiles?.get(
      archive
    );
    if (held) return (await held.getMetadata()) as Record<string, unknown>;
    const lib = await pmtilesReader();
    return (await new lib.PMTiles(archive).getMetadata()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * An archive's header tile type (`1` MVT, `2`-`5` images, `6` MLT), read as
 * {@link archiveMetadata} reads (the header core's handler holds is cached:
 * no request). For the renderer's hint on a runtime that draws no MLT
 * (0.10, U4; KTD11): the protocol handler is shared by every map on the
 * page and can't report.
 *
 * @param url - The archive URL, `pmtiles://` scheme or not.
 * @returns `undefined` when it can't be read.
 */
export async function archiveTileType(url: string): Promise<number | undefined> {
  const archive = url.replace(/^pmtiles:\/\//i, "");
  try {
    const held = (latestReader ? await latestReader : undefined)?.tiles.get(archive);
    return (await (held ?? new (await pmtilesReader()).PMTiles(archive)).getHeader()).tileType;
  } catch {
    return undefined;
  }
}

/**
 * What core says about an archive's MLT tiles, worded in the reader chunk
 * (0.10, U4): their 64-bit integer columns failed (KTD10), or, given the
 * running version, this maplibre-gl draws no MLT (KTD11).
 *
 * @returns `undefined` when the reader can't be loaded.
 */
export function mltNotice(url: string, runtime?: string): Promise<string | undefined> {
  return pmtilesReader().then(
    (lib) => lib.mltNotice?.(url, runtime),
    () => undefined
  );
}

/**
 * What the reader chunk's failure path uses of core (see ../renderer/cloud-host).
 *
 * @internal
 */
export const pmtilesHost: PmtilesHost = {
  formatError,
  rangeRepliesUnreadable,
};

/** The reader chunk once it has loaded and been given the host. */
let ready: Decoders["pmtiles"] | undefined;

/**
 * The reader chunk, given the host before anything in it runs (a failed
 * download: the seam's `chunk` error). A chunk without the failure path (a
 * `chunks/` folder older than this bundle) still reads: its failures are
 * then reported as the library words them.
 */
function pmtilesReader(): Promise<Decoders["pmtiles"]> {
  return getDecoder("pmtiles").then((lib) => {
    if (ready !== lib) {
      lib.useHost?.(pmtilesHost);
      ready = lib;
    }
    return lib;
  });
}

/**
 * Register `pmtiles://` on `host`, unless the page already did.
 *
 * @returns `"host"` when a handler was already registered (left alone),
 *   `"already"` when this core registered it earlier, `"installed"` now.
 * @throws {FormatError} (`decoder`) on a maplibre-gl older than 4, whose
 *   protocol API is callback-based and can't run the pmtiles handler.
 */
export function install(host: ProtocolHost): InstallResult {
  const key = host.module ?? (host as unknown as object);
  const registered = host.config?.REGISTERED_PROTOCOLS;
  if (registered) {
    // The module's own registry is the truth: registered by us earlier, or
    // by the page (left alone) — and if someone removed it, register again.
    if (registered["pmtiles"]) return installedOn.has(key) ? "already" : "host";
  } else if (installedOn.has(key)) {
    return "already";
  }
  const major = Number(host.version?.split(".")[0]);
  if (Number.isFinite(major) && major > 0 && major < 4) {
    throw new FormatError({
      code: "decoder",
      format: "pmtiles",
      url: "pmtiles://",
      detail: `it needs maplibre-gl 4 or later; this page runs ${host.version}`,
    });
  }

  // maplibre-gl draws MLT from 6.0 (KTD11): below it an MLT archive's
  // TileJSON is left as it is. An unknown version is not a claim.
  const drawsMlt = !(major < 6);

  // One reader per registration, created when the first request arrives.
  // `metadata: true`: the TileJSON MapLibre receives carries the archive's
  // vector_layers, bounds, min/max zoom and attribution.
  // A reader that failed to download is dropped, so a later request retries.
  let reader: Promise<Protocol> | undefined;
  /** The chunk the reader came from: its failure path words a failed request. */
  let lib: Decoders["pmtiles"] | undefined;
  /** Per archive: whether its range replies can't be read (asked on a failure). */
  const encoded: Record<string, Promise<boolean>> = {};
  const handler = async (params: { url: string; type?: string }, abortController: AbortController) => {
    const current = (reader ??= pmtilesReader().then((m) => {
      lib = m;
      return new m.Protocol({ metadata: true });
    }));
    latestReader = current;
    try {
      const protocol = await current.catch((error: unknown) => {
        if (reader === current) reader = undefined;
        throw error;
      });
      const reply = await protocol.tile(params as never, abortController);
      // An MLT archive's TileJSON gets `encoding: "mlt"` (U4), in the chunk.
      return params.type === "json" && lib?.withEncoding ? await lib.withEncoding(protocol, params.url, reply, drawsMlt) : reply;
    } catch (error) {
      // The reader's own download failed (the seam's notice), or a superseded
      // request: as is. Anything the library threw: in plain words, by the chunk.
      if (!lib?.tileFailure || isFormatError(error) || isAbortError(error)) throw error;
      throw await lib.tileFailure(error, params.url, encoded);
    }
  };
  host.addProtocol("pmtiles", handler as never);
  installedOn.add(key);
  return "installed";
}
