/**
 * @file The `cog://` protocol, registered once, its reader loaded on demand (0.9, ml-cnv.2)
 * @module @maplibre-yaml/core/formats/cog-protocol
 *
 * @description
 * MapLibre reads a COG through a URL protocol registered on the maplibre-gl
 * *module*. Core registers `cog://` on the module it renders with, before any
 * map is created — the same rule as `pmtiles://` — but what it registers is
 * this thin handler: on a COG's first request it downloads the reader (the
 * COG plugin, geotiff.js and core's adapter, `chunks/cog.js`, through
 * `getDecoder("cog")`) and hands the request over, so none of it sits in the
 * main bundle (bundle headroom U5). The adapter receives what it uses of
 * core as a {@link CogHost}.
 *
 * Kept here, in the main bundle: the registration (synchronous, before
 * `new Map()`), the not-cloud-optimized hints the renderer reads back
 * ({@link cogHintFor}; the chunk reports them through {@link recordHint}),
 * and the start of a file's first 64 KB read while the chunk downloads, so
 * the two downloads overlap as they did when the preflight lived here.
 *
 * **The host wins.** A page that already registered `cog` (the 0.7 page-JS
 * route, custom request headers) keeps its handler.
 *
 * Never imports maplibre-gl: the module is injected ({@link install}).
 */

import type { CogHost } from "../renderer/cloud-host";
import { consoleText } from "../utils/console-text";
import { fileUrlOf, HEADER_BYTES, type CogRequest } from "./cog";
import type { CogHeader } from "./cog-header";
import { getDecoder, type Decoders } from "./decoders";
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

/** Keep a not-cloud-optimized hint for the renderer ({@link cogHint}): the chunk's reporter. */
function recordHint(fileUrl: string, message: string): void {
  hints.set(fileUrl, message);
}

/**
 * Files' first-64-KB reads started while the reader downloads, by file URL:
 * the reader's preflight takes each, once ({@link CogHost.takeHeaderRead}).
 */
const headerReads = new Map<string, Promise<Response>>();

/** The reader chunk once it has loaded and been given the host. */
let ready: Decoders["cog"] | undefined;

/**
 * Start `fileUrl`'s preflight read now, while the reader downloads. Only
 * before the reader has loaded: from then on its preflight reads (once per
 * file) itself.
 */
function startHeaderRead(fileUrl: string): void {
  if (ready || headerReads.has(fileUrl)) return;
  const read = fetch(fileUrl, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
  read.catch(() => undefined); // the preflight reports it
  headerReads.set(fileUrl, read);
}

/**
 * What the reader chunk uses of core (see ../renderer/cloud-host).
 *
 * @internal
 */
export const cogHost: CogHost = {
  formatError: (failure) => new FormatError(failure),
  consoleText,
  takeHeaderRead(fileUrl) {
    const read = headerReads.get(fileUrl);
    headerReads.delete(fileUrl);
    return read;
  },
};

/**
 * The reader chunk, downloaded on first use and given the host before
 * anything in it runs. A failed download (the seam's `chunk`
 * {@link FormatError}) drops the reads started for it: a retry asks again.
 */
function cogReader(): Promise<Decoders["cog"]> {
  return getDecoder("cog").then(
    (lib) => {
      if (ready !== lib) {
        lib.useHost(cogHost);
        ready = lib;
      }
      return lib;
    },
    (error: unknown) => {
      for (const read of headerReads.values()) void read.then((r) => r.body?.cancel()).catch(() => undefined);
      headerReads.clear();
      throw error;
    }
  );
}

/**
 * Read a COG's header ahead of its first tile request — the same read (once
 * per file) the `cog://` handler then reuses: `<ml-map>` frames `fitTo` on
 * the file's extent before the map is built (ml-aot.120). Never rejects: a
 * file that can't be read is reported by the handler, as before.
 *
 * @param fileUrl - The absolute file URL (no `cog://`, no fragment).
 */
export function readCogHeaderAhead(fileUrl: string): Promise<CogHeader | undefined> {
  startHeaderRead(fileUrl);
  return cogReader()
    .then((lib) => lib.preflight(fileUrl, recordHint))
    .catch(() => undefined);
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

  // The reader's first download carries the TileJSON request's header read
  // alongside it; a failed download is a FormatError ("chunk") naming the file.
  const handler = (params: CogRequest, abortController: AbortController) => {
    if (params.type === "json") startHeaderRead(fileUrlOf(params.url));
    return cogReader().then((lib) => lib.handle(params, abortController, recordHint));
  };
  host.addProtocol("cog", handler as never);
  installedOn.add(key);
  return "installed";
}
