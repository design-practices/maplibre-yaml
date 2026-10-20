/**
 * @file The `cog://` protocol, registered once, its reader loaded on demand (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog-protocol
 *
 * @description
 * MapLibre reads a COG through a URL protocol registered on the maplibre-gl
 * *module*. Core registers `cog://` on the module it renders with, before any
 * map is created — the same rule as `pmtiles://` — but what it registers is
 * this thin handler: on a COG's first request `./cog` downloads the library
 * (the COG plugin and geotiff.js, `chunks/cog.js`, through
 * `getDecoder("cog")`) and hands the request over, so the library never sits
 * in the main bundle.
 *
 * **The host wins.** A page that already registered `cog` (the 0.7 page-JS
 * route, custom request headers) keeps its handler.
 *
 * Never imports maplibre-gl: the module is injected ({@link install}).
 */

import { handle } from "./cog";
import { FormatError } from "./errors";
import type { InstallResult, ProtocolHost } from "./pmtiles";

/** Modules this core has registered `cog://` on (one registration per module per page). */
const installedOn = new WeakSet<object>();

/** Not-cloud-optimized hints by file URL, for the page that shows them. */
const hints = new Map<string, string>();

/**
 * The "isn't cloud-optimized" hint for a COG file, once the reader has
 * looked at it (`undefined` otherwise). The renderer shows it as an author
 * hint: the file draws, but slowly on a large image.
 *
 * @param fileUrl - The absolute file URL (no `cog://`, no fragment).
 */
export function cogHint(fileUrl: string): string | undefined {
  return hints.get(fileUrl);
}

/**
 * {@link cogHint} for a source's URL as MapLibre holds it
 * (`cog://<file URL>#…`).
 */
export function cogHintFor(sourceUrl: string): string | undefined {
  return hints.get(fileOf(sourceUrl));
}

/** The lowest maplibre-gl the COG plugin supports (its peer range). */
const MIN_VERSION = [4, 5] as const;

/** The file inside a `cog://` URL, for a message (scheme and fragment dropped). */
function fileOf(url: string): string {
  return url.replace(/^cog:\/\//i, "").replace(/#.*$/, "").replace(/\/\d+\/\d+\/\d+$/, "");
}

/**
 * Register `cog://` on `host`, unless the page already did.
 *
 * @returns `"host"` when a handler was already registered (left alone),
 *   `"already"` when this core registered it earlier, `"installed"` now.
 * @throws {FormatError} (`decoder`) on a maplibre-gl older than 4.5, whose
 *   protocol API the COG plugin can't use.
 */
export function install(host: ProtocolHost): InstallResult {
  const key = host.module ?? (host as unknown as object);
  const registered = host.config?.REGISTERED_PROTOCOLS;
  if (registered) {
    if (registered["cog"]) return installedOn.has(key) ? "already" : "host";
  } else if (installedOn.has(key)) {
    return "already";
  }
  const [major, minor] = (host.version ?? "").split(".").map(Number);
  if (
    Number.isFinite(major) &&
    major! > 0 &&
    (major! < MIN_VERSION[0] || (major === MIN_VERSION[0] && Number(minor) < MIN_VERSION[1]))
  ) {
    throw new FormatError({
      code: "decoder",
      format: "cog",
      url: "cog://",
      detail: `it needs maplibre-gl ${MIN_VERSION.join(".")} or later; this page runs ${host.version}`,
    });
  }

  const handler = (params: { url: string; type?: string }, abortController: AbortController) =>
    handle(params, abortController, (fileUrl, message) => hints.set(fileUrl, message));
  host.addProtocol("cog", handler as never);
  installedOn.add(key);
  return "installed";
}
