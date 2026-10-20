/**
 * @file Cloud-native sources at render time: protocols, URLs, FlatGeobuf (0.9, ml-cnv)
 * @module @maplibre-yaml/core/renderer/cloud-sources
 *
 * @description
 * What the renderer does with a source whose URL names a cloud-native file
 * (see `formats/detect.ts` for the authoring rule):
 *
 * - **PMTiles** (`vector` / `raster` / `raster-dem`): the `pmtiles://`
 *   protocol is registered once on the renderer's maplibre-gl module
 *   (`prepareProtocols` in ./cloud-protocols, host wins), and the source URL is rewritten to
 *   the canonical `pmtiles://<absolute URL>` ({@link toMapLibreTileSpec}) —
 *   absolute so the protocol's per-archive cache has one key per file and the
 *   request works wherever MapLibre issues it.
 * - **FlatGeobuf** (`geojson`): decoded into the source's GeoJSON by a
 *   {@link FlatGeobufLoader}, the data provider the GeoJSON `url:` pipeline
 *   calls instead of its JSON fetch — so `fitTo`, data events, popups and the
 *   legend see ordinary GeoJSON.
 * - **GeoParquet / COG**: recognized, not read yet. They fail with a plain
 *   "not supported yet" ({@link unsupportedFormatError}) instead of a JSON or
 *   tile error — unless the page registered `cog://` itself, which COG
 *   sources then use.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  formatOfSource,
  loadModeOf,
  stripScheme,
  typeReadsFormat,
  type CloudFormat,
  type LoadMode,
} from "../formats/detect";
import { getDecoder } from "../formats/decoders";
import type { FlatGeobufHeader } from "../formats/flatgeobuf";
import { FormatError, isAbortError, isFormatError } from "../formats/errors";
import { registerSourceDataLoader, type SourceDataLoader } from "../data/source-data";
// No maplibre-gl here: the layer manager imports this module, and it loads
// without maplibre-gl (types only). Protocol registration, which needs the
// module, lives in ./cloud-protocols (MapRenderer only).

// ---------------------------------------------------------------------------
// Size guards and viewport defaults (design §4.4; maintainer-accepted)
// ---------------------------------------------------------------------------

/** Above this a whole-file FlatGeobuf read still loads, with console advice. */
export const WHOLE_FILE_WARN_BYTES = 10 * 1024 * 1024;
/**
 * Above this a whole-file read is not attempted: an indexed file switches to
 * reading the part in view; an unindexed one is refused with a notice.
 */
export const WHOLE_FILE_MAX_BYTES = 50 * 1024 * 1024;
// `load:` is read by `loadModeOf` in formats/detect (side-effect free, so the
// parser's classify check can use it too); re-exported here for the renderer.
export { VIEWPORT_DEFAULT_MINZOOM, loadModeOf, type LoadMode } from "../formats/detect";
/** Pause after the map stops moving before re-reading the view. */
export const VIEWPORT_DEBOUNCE_MS = 250;

/** Keys that are ours, never MapLibre's: stripped before a source reaches it. */
export const FORMAT_SOURCE_KEYS = ["format", "load"] as const;

type Obj = Record<string, unknown>;

/** `spec` without our format keys (unchanged when it has none). */
export function withoutFormatKeys<T extends Obj>(spec: T): T {
  if (!FORMAT_SOURCE_KEYS.some((k) => k in spec)) return spec;
  const copy: Obj = { ...spec };
  for (const key of FORMAT_SOURCE_KEYS) delete copy[key];
  return copy as T;
}

// ---------------------------------------------------------------------------
// Tile sources (PMTiles, and the COG reservation)
// ---------------------------------------------------------------------------

/** `url` resolved against the page (absolute), or as given outside a browser. */
export function absoluteUrl(url: string): string {
  const base = typeof document !== "undefined" ? document.baseURI : undefined;
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** The "not supported yet" error for a reserved format. */
export function unsupportedFormatError(format: CloudFormat, url: string): FormatError {
  return new FormatError({ code: "unsupported", format, url: stripScheme(url) });
}

/**
 * The MapLibre spec for a tile source (`vector`, `raster`, `raster-dem`)
 * that may name a cloud-native file.
 *
 * @returns `spec` — the input without our keys, with a PMTiles URL rewritten
 *   to `pmtiles://<absolute>` — and `problem` when the source can't be read
 *   in this version (a COG without a page-registered `cog://`); the spec is
 *   then an empty placeholder of the same type, so layers over it are added
 *   and draw nothing instead of each failing on a missing source.
 * @param isRegistered - Whether the page registered a URL protocol itself
 *   (the renderer passes `isProtocolRegistered` from ./cloud-protocols).
 */
export function toMapLibreTileSpec(
  spec: Obj,
  isRegistered: (scheme: string) => boolean = () => false
): { spec: Obj; problem?: FormatError } {
  const clean = withoutFormatKeys(spec);
  const format = formatOfSource(spec);
  const url = spec["url"];
  if (!format || typeof url !== "string" || !typeReadsFormat(spec["type"], format)) {
    return { spec: clean };
  }
  if (format === "pmtiles") {
    return { spec: { ...clean, url: `pmtiles://${absoluteUrl(stripScheme(url))}` } };
  }
  if (format === "cog" && isRegistered("cog")) {
    // The page registered a COG protocol itself (the 0.7 page-JS route): use it.
    return { spec: { ...clean, url: `cog://${absoluteUrl(stripScheme(url))}` } };
  }
  return { spec: placeholderTileSpec(spec["type"]), problem: unsupportedFormatError(format, url) };
}

/** A 1×1 transparent PNG. */
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

/**
 * A tile source of `type` that draws nothing and requests nothing: its
 * bounds are a sliver at the edge of the world, and the one tile it names
 * is a transparent pixel (MapLibre needs a non-empty `tiles` list).
 */
function placeholderTileSpec(type: unknown): Obj {
  return {
    type,
    tiles: [TRANSPARENT_PNG],
    tileSize: 256,
    bounds: [-180, -85, -179.9999, -84.9999],
    maxzoom: 0,
  };
}

// ---------------------------------------------------------------------------
// FlatGeobuf data provider
// ---------------------------------------------------------------------------

/** A whole-file read refused for size: the caller reads by view instead. */
export class WholeFileTooLarge extends Error {
  constructor(readonly size: number) {
    super(`${mb(size)}: too large to load whole`);
    this.name = "WholeFileTooLarge";
  }
}

/**
 * Read a whole FlatGeobuf file, with the size guards: over
 * {@link WHOLE_FILE_WARN_BYTES} a console note; over
 * {@link WHOLE_FILE_MAX_BYTES} nothing is decoded and it rejects with
 * {@link WholeFileTooLarge} (the loader then reads by view).
 *
 * @returns `null` when `isCurrent()` turned false mid-read (superseded).
 */
export async function loadFlatGeobufWhole(
  url: string,
  options: { isCurrent?: () => boolean; onHeader?: (header: FlatGeobufHeader) => void } = {}
): Promise<FeatureCollection | null> {
  const fgb = await getDecoder("flatgeobuf");
  const opened = await fgb.openWhole(url);
  if (opened.size !== undefined && opened.size > WHOLE_FILE_MAX_BYTES) {
    fgb.discard(opened);
    throw new WholeFileTooLarge(opened.size);
  }
  if (opened.size !== undefined && opened.size > WHOLE_FILE_WARN_BYTES) {
    console.warn(
      `[maplibre-yaml] ${url} is ${mb(opened.size)}; loading it whole may take a ` +
        "few seconds. For big files add `load: viewport` (needs a spatial index) or " +
        "convert to PMTiles."
    );
  }
  return fgb.decodeStream(opened, url, options);
}

/**
 * The FlatGeobuf entry on the shared source-data seam (`data/source-data.ts`,
 * ml-aot.75): a `fitTo` on a FlatGeobuf source read whole is loaded — and
 * decoded — ahead of the map, like a GeoJSON one, so the map is built
 * already framed on it. The layer manager then reuses that load (one
 * request). A source read by view, or a format this version doesn't read,
 * is not loaded ahead: the loader declines with a rejection the prefetch
 * settles on at once, and the layer manager reads the source itself.
 */
export const cloudSourceDataLoader: SourceDataLoader = (source) => {
  const format = formatOfSource(source);
  if (!format || !typeReadsFormat(source["type"], format)) return undefined;
  if (format === "flatgeobuf" && loadModeOf(source as Obj).mode === "all") {
    const url = String(source["url"]);
    return loadFlatGeobufWhole(url).then(
      (data) => data ?? { type: "FeatureCollection", features: [] }
    );
  }
  if (format === "flatgeobuf" || format === "geoparquet") {
    return Promise.reject(new Error(`${format}: not loaded ahead of the map`));
  }
  return undefined;
};

registerSourceDataLoader(cloudSourceDataLoader);

/** What a {@link FlatGeobufLoader} reports. */
export interface FlatGeobufCallbacks {
  /** Features ready (the whole file, or the view's part of it). */
  onData: (data: FeatureCollection) => void;
  /** The read failed (plain-language {@link FormatError}, or `HTTP …` for a status). */
  onError: (error: Error) => void;
}

/** `[west, south, east, north]`. */
export type BBox = [number, number, number, number];

/** A rectangle no feature intersects: reading it fetches just the header and index root. */
const HEADER_ONLY: BBox = [-180, -90, -180, -90];

/** The map's view as a bbox clamped to longitude/latitude (antimeridian → whole width). */
function viewBBox(map: MapLibreMap): BBox {
  const b = map.getBounds();
  let w = b.getWest();
  let e = b.getEast();
  const s = Math.max(-90, b.getSouth());
  const n = Math.min(90, b.getNorth());
  if (e - w >= 360 || w < -180 || e > 180) {
    w = Math.max(-180, w);
    e = Math.min(180, e);
    if (w >= e) [w, e] = [-180, 180];
  }
  return [w, s, e, n];
}

/** "180 MB". */
function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Reads one FlatGeobuf source into its GeoJSON data — the data provider
 * the GeoJSON `url:` pipeline calls instead of its JSON fetch.
 *
 * @remarks
 * `load: all` (default): one streamed `GET`, decoded once; works on any
 * static host. Size guards: up to {@link WHOLE_FILE_WARN_BYTES} silently,
 * up to {@link WHOLE_FILE_MAX_BYTES} with console advice, beyond that an
 * indexed file switches to the viewport read and an unindexed one is
 * refused with a notice.
 *
 * `load: viewport`: only the features in view, through the spatial index,
 * re-read {@link VIEWPORT_DEBOUNCE_MS} after the map stops moving (a newer
 * read supersedes an older one); empty below `minzoom`. Needs range
 * requests — on a server without them a file that fits the size guard is
 * read whole instead (with a console note), a larger one is refused.
 */
export class FlatGeobufLoader {
  private generation = 0;
  private destroyed = false;
  private header: FlatGeobufHeader | undefined;
  private viewport = false;
  private belowMinzoom = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onMoveEnd = () => {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch((error: unknown) => this.fail(error));
    }, VIEWPORT_DEBOUNCE_MS);
  };

  constructor(
    private readonly map: MapLibreMap,
    private readonly url: string,
    private readonly load: LoadMode,
    private readonly callbacks: FlatGeobufCallbacks
  ) {}

  /** Whether this loader reads by view (asked for, or switched to for size). */
  get readsByView(): boolean {
    return this.viewport;
  }

  /**
   * The file's extent from its header, `[[w, s], [e, n]]` — what `fitTo`
   * frames for a source read by view, whose data is only the part in view.
   */
  get extent(): [[number, number], [number, number]] | undefined {
    const env = this.header?.envelope;
    return env ? [[env[0], env[1]], [env[2], env[3]]] : undefined;
  }

  /**
   * Begin reading. Errors go to `onError`; never rejects.
   *
   * @param started - A whole-file load the host already started for this
   *   source (the `fitTo` prefetch): used instead of a second request.
   *   Ignored by `load: viewport`.
   */
  async start(started?: Promise<FeatureCollection>): Promise<void> {
    try {
      if (this.load.mode === "viewport") {
        await this.startViewport(false);
      } else {
        await this.readWhole(started);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** Stop: no more reads, no more callbacks. */
  destroy(): void {
    this.destroyed = true;
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.map.off("moveend", this.onMoveEnd);
  }

  private fail(error: unknown): void {
    if (this.destroyed || isAbortError(error)) return;
    this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }

  private deliver(data: FeatureCollection | null): void {
    if (data && !this.destroyed) this.callbacks.onData(data);
  }

  /**
   * The whole-file read — or, when the host already started it (the `fitTo`
   * prefetch, ml-aot.75, through {@link loadFlatGeobufWhole}), its result.
   */
  private async readWhole(started?: Promise<FeatureCollection>): Promise<void> {
    const generation = ++this.generation;
    let data: FeatureCollection | null;
    try {
      data = started
        ? await started
        : await loadFlatGeobufWhole(this.url, {
            isCurrent: () => generation === this.generation && !this.destroyed,
            onHeader: (header) => (this.header = header),
          });
    } catch (error) {
      if (!(error instanceof WholeFileTooLarge)) throw error;
      // The "reading by view instead" note is logged once the header shows
      // an index (startViewport): an unindexed file is refused instead, and
      // a note promising the by-view read would contradict that (ml-aot.103).
      await this.startViewport(true, error.size);
      return;
    }
    this.deliver(data);
  }

  /**
   * Switch to reading by view: check range support, read the header (and
   * whether there is an index), then follow the map.
   *
   * @param auto - true when a too-large whole-file read switched here; a
   *   missing index then means "too large", not "add an index for viewport".
   */
  private async startViewport(auto: boolean, size?: number): Promise<void> {
    const fgb = await getDecoder("flatgeobuf");
    const probe = await fgb.probe(this.url);
    const total = probe.size ?? size;
    if (!probe.ranges) {
      if (!auto && (total === undefined || total <= WHOLE_FILE_MAX_BYTES)) {
        console.warn(
          `[maplibre-yaml] ${this.url}: this server doesn't support range requests, so ` +
            "`load: viewport` reads the whole file instead. Hosts like GitHub Pages, Netlify, " +
            "S3 and R2 support them (`python -m http.server` doesn't; `npx serve` does)."
        );
        await this.readWhole();
        return;
      }
      throw new FormatError({ code: "no-range", format: "flatgeobuf", url: this.url });
    }

    // Header first: fitTo frames the whole file, and a missing index fails
    // before the map starts following the view.
    try {
      await fgb.readBbox(this.url, HEADER_ONLY, { onHeader: (h) => (this.header = h) });
    } catch (error) {
      if (auto && isFormatError(error) && error.failure.code === "no-index") {
        throw new FormatError({
          code: "too-large",
          format: "flatgeobuf",
          url: this.url,
          ...(total !== undefined ? { size: total } : {}),
        });
      }
      throw error;
    }
    if (this.destroyed) return;
    if (auto) {
      console.warn(
        `[maplibre-yaml] ${this.url} is ${total !== undefined ? mb(total) : "very large"}, too large ` +
          "to load whole; reading only the part in view instead (add `load: viewport` to say so, " +
          "or convert the file to PMTiles)."
      );
    }
    this.viewport = true;
    this.map.on("moveend", this.onMoveEnd);
    await this.refresh();
  }

  /** Read the current view (or deliver nothing below `minzoom`). */
  private async refresh(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    if (this.map.getZoom() < this.load.minzoom) {
      // Once per stretch below minzoom, not on every pan.
      if (!this.belowMinzoom) {
        this.belowMinzoom = true;
        console.info(
          `[maplibre-yaml] ${this.url} is read by view (load: viewport) from zoom ` +
            `${this.load.minzoom}; zoom in to see its features.`
        );
        this.deliver({ type: "FeatureCollection", features: [] });
      }
      return;
    }
    const fgb = await getDecoder("flatgeobuf");
    const data = await fgb.readBbox(this.url, viewBBox(this.map), {
      isCurrent: () => generation === this.generation && !this.destroyed,
      onHeader: (h) => (this.header = h),
    });
    if (data) this.belowMinzoom = false;
    this.deliver(data);
  }
}
