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
 * ({@link install}), so it can become an on-demand chunk later without
 * pulling a second maplibre-gl into it.
 */

import { Protocol } from "pmtiles";
import { classifyPmtilesError, FormatError } from "./errors";

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

  // `metadata: true`: the TileJSON MapLibre receives carries the archive's
  // vector_layers, bounds, min/max zoom and attribution.
  const protocol = new Protocol({ metadata: true });
  const handler = async (params: { url: string }, abortController: AbortController) => {
    try {
      return await protocol.tile(params as never, abortController);
    } catch (error) {
      throw classifyPmtilesError(error, displayUrl(archiveUrl(params.url)));
    }
  };
  host.addProtocol("pmtiles", handler as never);
  installedOn.add(key);
  return "installed";
}
