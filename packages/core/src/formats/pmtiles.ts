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
 * neither replaces nor wraps it. Same rule as `setWorkerModuleUrl`.
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
 */

import type { Protocol } from "pmtiles";
import { getDecoder } from "./decoders";
import { classifyPmtilesError, FormatError, isFormatError } from "./errors";
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

/** The archive URL inside a `pmtiles://` request URL (tile suffix dropped). */
function archiveUrl(requestUrl: string): string {
  const inner = requestUrl.replace(/^pmtiles:\/\//i, "");
  // Tile requests are `pmtiles://<archive>/{z}/{x}/{y}`.
  return inner.replace(/\/\d+\/\d+\/\d+(?:\.\w+)?$/, "");
}

/** The URL as a reader sees it: a same-origin path, else the full URL. */
function displayUrl(url: string): string {
  try {
    const here = typeof location !== "undefined" ? location : undefined;
    const target = new URL(url, here?.href);
    return here && target.origin === here.origin ? target.pathname + target.search : url;
  } catch {
    return url;
  }
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

  // One reader per registration, created when the first request arrives.
  // `metadata: true`: the TileJSON MapLibre receives carries the archive's
  // vector_layers, bounds, min/max zoom and attribution.
  // A reader that failed to download is dropped, so a later request retries.
  let reader: Promise<Protocol> | undefined;
  /** Per archive: whether its range replies can't be read (asked on a failure). */
  const encoded: Record<string, Promise<boolean>> = {};
  const handler = async (params: { url: string }, abortController: AbortController) => {
    const current = (reader ??= getDecoder("pmtiles").then((m) => new m.Protocol({ metadata: true })));
    try {
      const protocol = await current.catch((error: unknown) => {
        if (reader === current) reader = undefined;
        throw error;
      });
      return await protocol.tile(params as never, abortController);
    } catch (error) {
      const archive = archiveUrl(params.url);
      const classified = classifyPmtilesError(error, displayUrl(archive));
      // A reply that couldn't be read, or bytes that aren't the archive's, from
      // a host that serves the file compressed: its range replies are cut
      // from the compressed copy (jsDelivr's Cloudflare leg). Asked once per file.
      const code = isFormatError(classified) ? classified.failure.code : undefined;
      if (code === "cors" || code === "not-format") {
        encoded[archive] ??= rangeRepliesUnreadable(archive);
        if (await encoded[archive]) {
          throw new FormatError({ code: "encoded-range", format: "pmtiles", url: displayUrl(archive) });
        }
      }
      throw classified;
    }
  };
  host.addProtocol("pmtiles", handler as never);
  installedOn.add(key);
  return "installed";
}
