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
 * - **FlatGeobuf** and **GeoParquet** (`geojson`): decoded into the
 *   source's GeoJSON by a {@link FlatGeobufLoader} / {@link GeoParquetLoader},
 *   the data providers the GeoJSON `url:` pipeline calls instead of its JSON
 *   fetch — so `fitTo`, data events, popups and the legend see ordinary
 *   GeoJSON.
 * - **COG** (`raster` / `raster-dem`): like PMTiles, a `cog://` protocol
 *   (registered by `prepareProtocols`, its reader fetched on demand); the
 *   URL becomes `cog://<absolute URL>` plus `#dem` or the `colorRamp:`
 *   colours, with `tileSize: 256` (`formats/cog-spec`).
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  formatOfSource,
  loadModeOf,
  stripScheme,
  VIEWPORT_DEFAULT_MAX_FEATURES,
  typeReadsFormat,
  type CloudFormat,
  type LoadMode,
} from "../formats/detect";
import { prefetchDecoder } from "../formats/decoders";
import * as fgb from "../formats/flatgeobuf";
import { cogSourceSpec } from "../formats/cog-spec";
import type { FlatGeobufHeader } from "../formats/flatgeobuf";
import * as gp from "../formats/geoparquet";
import type { ColumnChoice, GeoParquetFile } from "../formats/geoparquet";
import { FormatError, isAbortError, isFormatError } from "../formats/errors";
import { BodyTooLarge } from "../formats/http";
import { registerSourceDataLoader, type SourceDataLoader } from "../data/source-data";
import {
  formatCount,
  indexedFlatGeobufCommand,
  largeDataLinks,
  pmtilesCommand,
  sortedParquetCommand,
  commandStem,
  raiseCost,
  wholeFileCause,
  type WholeFileCost,
} from "../components/student-messages";
import { roundedRaise, SAFE_VIEW_FEATURES } from "../formats/large-data";
import { consoleText } from "../utils/console-text";
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
/**
 * Above this many features (a FlatGeobuf header's count, a GeoParquet
 * footer's rows) a whole-file read is not attempted either, whatever the
 * bytes (ml-37r.16): the cost of a whole read is the features it decodes on
 * the page, and compressed bytes hide it. An author's `load: { maxFeatures }`
 * above it raises it for that source.
 *
 * @remarks
 * Measured on NYC PLUTO parcels (Chromium, desktop with a GPU, 2026-10-23/24):
 * Brooklyn's 275,628 parcels read whole draw in 13–17 s at 2.1–2.3 GB of
 * renderer memory and pan at 42–50 fps, as GeoJSON or GeoParquet — usable,
 * and what 0.9.1 did, so a file that size still loads whole. The citywide
 * 856,687 parcels, whose read columns were 47 MB on the wire (under
 * {@link WHOLE_FILE_MAX_BYTES}), decode to 142 MB and took 3.9–4.3 GB.
 * 400,000 sits between the two; {@link WHOLE_FILE_MAX_DECODED_BYTES} is the
 * safety net for fewer, heavier features — and for an author who raised the
 * feature limit (the citywide file trips both).
 */
export const WHOLE_FILE_MAX_FEATURES = 400_000;
/**
 * Above this many decoded bytes of the columns a map reads (a GeoParquet
 * footer's uncompressed sizes) a whole-file read is not attempted: few
 * features with heavy geometry cost as much as many light ones, and an
 * author's `maxFeatures` doesn't lift it.
 *
 * @remarks
 * Measured on NYC PLUTO (zstd GeoParquet): the citywide map's 7 read
 * columns decode to 142 MB (the geometry alone to 111 MB) and drawing them
 * took 4.3 GB; Brooklyn's decode to 44 MB (2.3–2.5 GB). 100 MB catches the
 * citywide file whatever its columns, passes the borough, and matches the
 * 600,000 parcels a hint may suggest loading whole (formats/large-data).
 * It was 150 MB, which the real citywide file passed.
 */
export const WHOLE_FILE_MAX_DECODED_BYTES = 100 * 1024 * 1024;
// `load:` is read by `loadModeOf` in formats/detect (side-effect free, so the
// parser's classify check can use it too); re-exported here for the renderer.
export {
  VIEWPORT_DEFAULT_MINZOOM,
  VIEWPORT_DEFAULT_MAX_FEATURES,
  loadModeOf,
  type LoadMode,
} from "../formats/detect";
/**
 * A GeoParquet view is not read when the row groups it touches hold more than
 * this many times `maxFeatures` rows (M2 of the PR #206 review): a reader
 * decodes each row group it touches whole, so the per-view estimate (rows
 * actually in view) can be well under budget while the decode is not.
 *
 * @remarks
 * Measured on NYC PLUTO (856,687 parcels, Chromium on a desktop with a GPU,
 * 2026-10-24): with 100,000-row groups, a citywide view at zoom 12.5
 * estimated at about 145,000 features touched 600,000 rows — 3.8 GB of
 * renderer memory and 10 fps while panning — and a borough view at zoom 13
 * touched 556,687 rows (3.7 GB, 13 fps). The same views of the file in
 * 10,000-row groups touched 260,000 and 210,000 rows (2.9 GB at 25 fps,
 * 2.7 GB at 29 fps).
 *
 * How tightly 10,000-row groups pack depends on the sort (the 26 measured
 * views of 1280 × 800 px at zooms 12–14 that hold at most 150,000 features,
 * 2026-10-26): a Hilbert sort (GeoPandas or `gpio sort hilbert`) touches at
 * most 260,000 rows; GDAL's `SORT_BY_BBOX` up to 329,495 from a sorted input
 * and 449,120 from an unsorted one (379,394 at Brooklyn zoom 13). The
 * 100,000-row file touches 500,000–600,000 rows in the same views, except
 * close in. At 3 × the default 150,000 (450,000 rows) every view of every
 * 10,000-row file that fits the estimate is read — at 2.5 × a file sorted by
 * the hint's own command was refused — while the 100,000-row views of
 * 500,000 rows and more are not, and its block views (200,000–300,000 rows)
 * still are.
 */
export const VIEW_DECODE_FACTOR = 3;
/**
 * Row groups up to this many rows are small enough: a decode over budget is
 * then their packing (the sort), not their size.
 */
const SMALL_ROW_GROUP = 15_000;
/** Pause after the map stops moving before re-reading the view. */
export const VIEWPORT_DEBOUNCE_MS = 250;

/** Keys that are ours, never MapLibre's: stripped before a source reaches it. */
export const FORMAT_SOURCE_KEYS = ["format", "load", "columns", "colorRamp"] as const;

type Obj = Record<string, unknown>;

/** `spec` without our format keys (unchanged when it has none). */
export function withoutFormatKeys<T extends Obj>(spec: T): T {
  if (!FORMAT_SOURCE_KEYS.some((k) => k in spec)) return spec;
  const copy: Obj = { ...spec };
  for (const key of FORMAT_SOURCE_KEYS) delete copy[key];
  return copy as T;
}

// ---------------------------------------------------------------------------
// Tile sources (PMTiles, COG)
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

/** The "can't read" error for a format recognized ahead of its reader (none in 0.9). */
export function unsupportedFormatError(format: CloudFormat, url: string): FormatError {
  return new FormatError({ code: "unsupported", format, url: stripScheme(url) });
}

/**
 * The MapLibre spec for a tile source (`vector`, `raster`, `raster-dem`)
 * that may name a cloud-native file.
 *
 * @returns `spec` — the input without our keys, with a PMTiles URL rewritten
 *   to `pmtiles://<absolute>` and a COG's to `cog://<absolute>` (see
 *   `formats/cog-spec`) — and `problem` when the source can't be read in
 *   this version; the spec is then an empty placeholder of the same type, so
 *   layers over it are added and draw nothing instead of each failing on a
 *   missing source.
 * @param _isRegistered - Whether the page registered a URL protocol itself
 *   (unused since COG is read YAML-only; kept for callers).
 */
export function toMapLibreTileSpec(
  spec: Obj,
  _isRegistered: (scheme: string) => boolean = () => false
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
  if (format === "cog") {
    // `cog://<absolute>`, `#dem` / `#color:` and tileSize 256 (ml-cnv.2).
    return { spec: cogSourceSpec({ ...clean, colorRamp: spec["colorRamp"] }, absoluteUrl) };
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
  /**
   * @param size - The bytes a whole read would transfer, when known.
   * @param opened - The file already opened (GeoParquet: its footer), reused
   *   by the by-view read instead of a second open.
   * @param features - The feature count, when that is what decided (ml-37r.16).
   * @param cost - What the read would cost against which limits (the notes
   *   and notices name the one it is over).
   */
  constructor(
    readonly size?: number,
    readonly opened?: unknown,
    readonly features?: number,
    readonly cost?: Omit<WholeFileCost, "format">
  ) {
    super("too large to load whole");
    this.name = "WholeFileTooLarge";
  }
}

/** The limits a whole-file read is measured against, as the notes name them. */
function costLimits(limits: Required<SizeLimits>): WholeFileCost["limits"] {
  return { features: limits.maxFeatures, bytes: limits.max, decoded: limits.maxDecoded };
}

/**
 * Read a whole FlatGeobuf file, with the size guards: over
 * {@link WHOLE_FILE_WARN_BYTES} a console note; over
 * {@link WHOLE_FILE_MAX_BYTES}, or a header counting more than
 * {@link WHOLE_FILE_MAX_FEATURES} features, nothing is decoded and it rejects
 * with {@link WholeFileTooLarge} (the loader then reads by view).
 *
 * @returns `null` when `isCurrent()` turned false mid-read (superseded).
 */
export async function loadFlatGeobufWhole(
  url: string,
  options: {
    isCurrent?: () => boolean;
    onHeader?: (header: FlatGeobufHeader) => void;
    /** The size guards (tests pass smaller ones). */
    limits?: SizeLimits;
  } = {}
): Promise<FeatureCollection | null> {
  const limits = sizeLimits(options.limits);
  // The reader (an on-demand chunk) downloads while the file's GET starts.
  prefetchDecoder("flatgeobuf");
  const abort = new AbortController();
  const opened = await fgb.openWhole(url, abort.signal);
  const cost = (size: number | undefined, features?: number) => ({ size, features, limits: costLimits(limits) });
  if (opened.size !== undefined && opened.size > limits.max) {
    fgb.discard(opened);
    throw new WholeFileTooLarge(opened.size, undefined, undefined, cost(opened.size));
  }
  // Over the note's size, the note waits for the header: whether the file
  // has an index decides what to suggest (ml-cnv.35).
  const noteSize = opened.size !== undefined && opened.size > limits.warn ? opened.size : undefined;
  const ranges = /bytes/i.test(opened.response.headers.get("accept-ranges") ?? "");
  // The header's feature count arrives before any feature: what decoding
  // will cost, whatever the bytes (ml-37r.16).
  let features: number | undefined;
  // Without Content-Length (a chunked or compressed response) the guard
  // counts the bytes as they stream.
  try {
    return await fgb.decodeStream(opened, url, {
      ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
      onHeader: (header) => {
        if (header.featuresCount > limits.maxFeatures) {
          features = header.featuresCount;
          abort.abort();
          throw Error();
        }
        if (noteSize !== undefined) {
          const byView = header.indexed
            ? `To read only the part in view, add \`load: viewport\` (it has a spatial index${ranges ? "" : "; it needs a host with HTTP range requests"})`
            : `To read only the part in view, give it a spatial index (${indexedFlatGeobufCommand(url)}) and add \`load: viewport\``;
          console.warn(
            "[maplibre-yaml] " +
              consoleText(
              `${url} is ${mb(noteSize)}; loading it whole may take a few seconds. ${byView}; to draw it at ` +
                `every zoom, convert it to PMTiles. ${largeDataLinks("flatgeobuf")}`
            )
          );
        }
        options.onHeader?.(header);
      },
      ...(opened.size === undefined ? { maxBytes: limits.max } : {}),
    });
  } catch (error) {
    if (features !== undefined) throw new WholeFileTooLarge(opened.size, undefined, features, cost(opened.size, features));
    if (error instanceof BodyTooLarge) throw new WholeFileTooLarge(error.size, undefined, undefined, cost(error.size));
    throw error;
  }
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
  const load = loadModeOf(source as Obj);
  if (format === "flatgeobuf" && load.mode === "all") {
    const url = String(source["url"]);
    return loadFlatGeobufWhole(url, { limits: sizeLimits(undefined, load) }).then(
      (data) => data ?? { type: "FeatureCollection", features: [] }
    );
  }
  if (format === "geoparquet" && load.mode === "all") {
    const url = String(source["url"]);
    return loadGeoParquetWhole(url, columnChoiceOf(source), { limits: sizeLimits(undefined, load) }).then(
      (read) => read.data ?? { type: "FeatureCollection", features: [] }
    );
  }
  if (format === "flatgeobuf" || format === "geoparquet") {
    return Promise.reject(new Error(`${format}: not loaded ahead of the map`));
  }
  return undefined;
};

registerSourceDataLoader(cloudSourceDataLoader);

/** What a {@link FlatGeobufLoader} or {@link GeoParquetLoader} reports. */
export interface FlatGeobufCallbacks {
  /** Features ready (the whole file, or the view's part of it). */
  onData: (data: FeatureCollection) => void;
  /** The read failed (plain-language {@link FormatError}, or `HTTP …` for a status). */
  onError: (error: Error) => void;
  /**
   * An author hint: the map works, but the document could say what it means
   * (a file too large to read whole, read by view instead; a view too dense
   * to read). The console only when absent.
   */
  onHint?: (message: string) => void;
  /**
   * Nothing of the source is drawn until the reader zooms in (`true`): the
   * map is below the source's `minzoom`, or the view holds more features
   * than one read takes — or no longer (`false`).
   */
  onTooDense?: (dense: boolean) => void;
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

/**
 * The bbox a `width` × `height` px view centred on `center` covers at
 * `zoom` (Web Mercator, 512 px tiles, as MapLibre draws), clamped like
 * {@link viewBBox}.
 */
export function viewAround(center: [number, number], zoom: number, width: number, height: number): BBox {
  const world = 512 * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, center[1]));
  const x = ((center[0] + 180) / 360) * world;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  const lng = (px: number) => (px / world) * 360 - 180;
  const latOf = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) * 180) / Math.PI;
  const w = Math.max(-180, lng(x - width / 2));
  const e = Math.min(180, lng(x + width / 2));
  return [w, Math.max(-90, latOf(y + height / 2)), e, Math.min(90, latOf(y - height / 2))];
}

/** "180 MB". */
function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** What every cloud-native data provider offers the layer manager. */
export interface FormatLoader {
  /** Whether this loader reads by view (asked for, or switched to for size). */
  readonly readsByView: boolean;
  /** The file's full extent, `[[w, s], [e, n]]`, when its metadata records one. */
  readonly extent: [[number, number], [number, number]] | undefined;
  /** The zoom below which a by-view read reads nothing (`load: { minzoom }`). */
  readonly minzoom: number;
  /**
   * The outermost zoom, from `from` in, at which a by-view read of a
   * `width` × `height` px view centred on `center` is read — at or above
   * `minzoom`, within the per-view budget — or undefined when none is within
   * 8 zooms. From what the reader already holds (no request).
   */
  zoomThatFits?(center: [number, number], from: number, width: number, height: number): number | undefined;
  /** Begin reading; errors go to `onError`, never rejects. */
  start(started?: Promise<FeatureCollection>): Promise<void>;
  /** Stop: no more reads, no more callbacks. */
  destroy(): void;
  /** Stop reading by view while no layer draws the source; {@link resume} starts again. */
  suspend?(): void;
  /** Read by view again after {@link suspend}. */
  resume?(): void;
}

/**
 * What the FlatGeobuf and GeoParquet providers share: the whole-or-by-view
 * start, the lifecycle, and reading by view — re-read
 * {@link VIEWPORT_DEBOUNCE_MS} after the map stops moving (a newer read
 * supersedes an older one), nothing below `minzoom`, and nothing for a view
 * the file says holds more than `maxFeatures` features (ml-37r.17).
 */
abstract class ViewLoader implements FormatLoader {
  protected generation = 0;
  protected destroyed = false;
  private viewport = false;
  /** Why the last view wasn't read (below `minzoom`, too dense), or undefined. */
  private skipped: "minzoom" | "dense" | undefined;
  /** Following was stopped by {@link suspend} (and {@link resume} restarts it). */
  private suspended = false;
  private hintedDense = false;
  private hintedDecode = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onMoveEnd = () => {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch((error: unknown) => this.fail(error));
    }, VIEWPORT_DEBOUNCE_MS);
  };

  constructor(
    protected readonly map: MapLibreMap,
    protected readonly url: string,
    protected readonly load: LoadMode,
    protected readonly callbacks: FlatGeobufCallbacks,
    protected readonly limits: Required<SizeLimits>
  ) {}

  /** Whether this loader reads by view (asked for, or switched to for size). */
  get readsByView(): boolean {
    return this.viewport;
  }

  /** The zoom below which a by-view read reads nothing. */
  get minzoom(): number {
    return this.load.minzoom;
  }

  /**
   * The outermost zoom, in quarter steps from `from` (and never below
   * `minzoom`), whose view of `width` × `height` px around `center` would be
   * read: its estimate within `maxFeatures`, and (GeoParquet) its row groups
   * within the decode budget. What `fitTo` frames a source read by view at,
   * so the map opens showing features rather than the zoom-in line.
   */
  zoomThatFits(center: [number, number], from: number, width: number, height: number): number | undefined {
    const start = Math.max(from, this.load.minzoom);
    for (let zoom = start; zoom <= Math.min(start + 8, 22); zoom += 0.25) {
      const view = viewAround(center, zoom, width, height);
      const estimate = Math.round(this.estimate(view));
      if (estimate <= this.load.maxFeatures && this.decodeTooCostly(view, estimate) === undefined) return zoom;
    }
    return undefined;
  }

  abstract get extent(): [[number, number], [number, number]] | undefined;

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
    this.suspend();
    this.destroyed = true;
  }

  /**
   * Stop following the map while nothing draws the source (its last layer
   * removed): no reads on `moveend`, and the reader's "zoom in" line for it
   * withdrawn (ml-cnv.32). {@link resume} starts again.
   */
  suspend(): void {
    if (this.destroyed) return;
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.map.off("moveend", this.onMoveEnd);
    if (this.skipped) this.callbacks.onTooDense?.(false);
    this.skipped = undefined;
    this.suspended = this.viewport;
  }

  /** Follow the map again after {@link suspend} (a layer draws the source again). */
  resume(): void {
    if (this.destroyed || !this.suspended) return;
    this.suspended = false;
    void this.follow().catch((error: unknown) => this.fail(error));
  }

  /** The file's format, for messages. */
  protected abstract readonly format: "flatgeobuf" | "geoparquet";

  /** The whole-file read (or the host's, already started). */
  protected abstract readWhole(started?: Promise<FeatureCollection>): Promise<void>;

  /**
   * Switch to reading by view.
   *
   * @param auto - true when a too-large whole-file read switched here.
   */
  protected abstract startViewport(auto: boolean, tooLarge?: WholeFileTooLarge): Promise<void>;

  /** About how many features `view` holds, from what the reader already has (no request). */
  protected abstract estimate(view: BBox): number;

  /**
   * An author hint when reading `view` would decode far more than the
   * features in it (GeoParquet's whole row groups), else undefined: the view
   * is then not read either.
   */
  protected decodeTooCostly(_view: BBox, _estimate: number): string | undefined {
    return undefined;
  }

  /** Read the features in `view` (`null` when superseded). */
  protected abstract readView(view: BBox, isCurrent: () => boolean): Promise<FeatureCollection | null>;

  protected fail(error: unknown): void {
    if (this.destroyed || isAbortError(error)) return;
    this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }

  protected deliver(data: FeatureCollection | null): void {
    if (data && !this.destroyed) this.callbacks.onData(data);
  }

  protected hint(message: string): void {
    if (this.callbacks.onHint) this.callbacks.onHint(message);
    else console.warn(`[maplibre-yaml] ${consoleText(message)}`);
  }

  /**
   * The note for a file too large to read whole that is read by view
   * instead: why, and the ways to change it.
   */
  protected autoNote(tooLarge: WholeFileTooLarge | undefined, size?: number): void {
    const cause = wholeFileCause({
      format: this.format,
      size: tooLarge?.size ?? size,
      features: tooLarge?.features,
      ...tooLarge?.cost,
    });
    this.hint(
      `\`${this.url}\` ${cause.text}, so only the part in view is read, from zoom ${this.load.minzoom}. ` +
        "Add `load: viewport` to the source to say so (this note then goes). " +
        (cause.raise !== undefined
          ? `To load it whole anyway, raise \`load: { maxFeatures: ${cause.raise} }\` (${raiseCost(cause.raise, false)}). `
          : "") +
        `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${pmtilesCommand(this.url, this.format)}. ` +
        largeDataLinks(this.format)
    );
  }

  /** Follow the map: read the view now, and again after every move. */
  protected async follow(): Promise<void> {
    if (this.destroyed) return;
    this.viewport = true;
    this.map.on("moveend", this.onMoveEnd);
    await this.refresh();
  }

  /** Read the current view — or nothing below `minzoom`, or for a view too dense to read. */
  private async refresh(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    if (this.map.getZoom() < this.load.minzoom) {
      // Once per stretch below minzoom, not on every pan.
      if (this.skip("minzoom")) {
        // Lowering minzoom helps only when this view would then be read
        // (ml-cnv.35): further out, a citywide file's view is over budget.
        const view = viewBBox(this.map);
        const estimate = Math.round(this.estimate(view));
        const lower = Math.floor(this.map.getZoom());
        const helps = estimate <= this.load.maxFeatures && this.decodeTooCostly(view, estimate) === undefined;
        console.info(
          "[maplibre-yaml] " +
            consoleText(
            `${this.url} is read by view from zoom ${this.load.minzoom}, so nothing of it is drawn further ` +
              "out and the reader is asked to zoom in. " +
              (helps
                ? `To read it from here, lower \`minzoom\` to ${lower} under \`load:\`; to draw it at every zoom, convert it to PMTiles. `
                : `Further out its views hold more than \`maxFeatures\`, so a lower \`minzoom\` wouldn't draw it; to draw it at every zoom, convert it to PMTiles: ${pmtilesCommand(this.url, this.format)}. `) +
              largeDataLinks(this.format)
          )
        );
      }
      return;
    }
    const view = viewBBox(this.map);
    const estimate = Math.round(this.estimate(view));
    const max = this.load.maxFeatures;
    if (estimate > max) {
      // Reading it would decode (and draw) more than a tab can take: the
      // citywide parcels view read 261 MB and ran at 8 fps, or crashed.
      this.skip("dense");
      if (!this.hintedDense) {
        this.hintedDense = true;
        // A raise only while the view stays usable (formats/large-data):
        // 800,000 parcels by view ran at 6 fps on 5.1 GB.
        const raise = roundedRaise(estimate);
        this.hint(
          `\`${this.url}\` has about ${formatCount(estimate)} features in view, more than one read ` +
            `takes (\`maxFeatures\`: ${formatCount(max)}), so nothing of it is drawn until the map is ` +
            "zoomed in. " +
            (raise <= SAFE_VIEW_FEATURES
              ? `To draw this view, raise \`maxFeatures\` to ${raise} under \`load:\` (${raiseCost(raise, true)}). `
              : "That is too many to draw at once in a browser. ") +
            `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${pmtilesCommand(this.url, this.format)}. ` +
            largeDataLinks(this.format)
        );
      }
      return;
    }
    const costly = this.decodeTooCostly(view, estimate);
    if (costly !== undefined) {
      this.skip("dense");
      if (!this.hintedDecode) {
        this.hintedDecode = true;
        this.hint(costly);
      }
      return;
    }
    const data = await this.readView(view, () => generation === this.generation && !this.destroyed);
    if (data) this.skip(undefined);
    this.deliver(data);
  }

  /**
   * Enter a state. Leaving a read view for a skipped one delivers no
   * features (once) and tells the host the reader must zoom in — below
   * `minzoom` as much as for a view too dense to read, since either way the
   * map draws nothing of the source (a `fitTo` that framed a citywide file
   * at zoom 9.9 opened blank, without a word); reading a view again tells
   * the host it no longer must.
   *
   * @returns Whether the state is new.
   */
  private skip(why: "minzoom" | "dense" | undefined): boolean {
    const was = this.skipped;
    if (was === why) return false;
    this.skipped = why;
    if (Boolean(was) !== Boolean(why)) this.callbacks.onTooDense?.(Boolean(why));
    if (why && !was) this.deliver({ type: "FeatureCollection", features: [] });
    return true;
  }
}

/**
 * Reads one FlatGeobuf source into its GeoJSON data — the data provider
 * the GeoJSON `url:` pipeline calls instead of its JSON fetch.
 *
 * @remarks
 * `load: all` (default): one streamed `GET`, decoded once; works on any
 * static host. Size guards: up to {@link WHOLE_FILE_WARN_BYTES} silently,
 * up to {@link WHOLE_FILE_MAX_BYTES} (and {@link WHOLE_FILE_MAX_FEATURES})
 * with console advice, beyond that an indexed file switches to the viewport
 * read and an unindexed one is refused with a notice.
 *
 * `load: viewport`: only the features in view, through the spatial index
 * (see {@link ViewLoader}); a view's features are estimated before reading
 * from one level of that index. Needs range requests — on a server without
 * them a file that fits the size guard is read whole instead (with a console
 * note), a larger one is refused.
 */
export class FlatGeobufLoader extends ViewLoader {
  protected readonly format = "flatgeobuf" as const;
  private header: FlatGeobufHeader | undefined;
  private inView: fgb.FeaturesInView | undefined;

  constructor(
    map: MapLibreMap,
    url: string,
    load: LoadMode,
    callbacks: FlatGeobufCallbacks,
    limits?: SizeLimits
  ) {
    super(map, url, load, callbacks, sizeLimits(limits, load));
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
   * The whole-file read — or, when the host already started it (the `fitTo`
   * prefetch, ml-aot.75, through {@link loadFlatGeobufWhole}), its result.
   */
  protected async readWhole(started?: Promise<FeatureCollection>): Promise<void> {
    const generation = ++this.generation;
    let data: FeatureCollection | null;
    try {
      data = started
        ? await started
        : await loadFlatGeobufWhole(this.url, {
            isCurrent: () => generation === this.generation && !this.destroyed,
            onHeader: (header) => (this.header = header),
            limits: this.limits,
          });
    } catch (error) {
      if (!(error instanceof WholeFileTooLarge)) throw error;
      // The "reading by view instead" note is logged once the header shows
      // an index (startViewport): an unindexed file is refused instead, and
      // a note promising the by-view read would contradict that (ml-aot.103).
      await this.startViewport(true, error);
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
  protected async startViewport(auto: boolean, tooLarge?: WholeFileTooLarge): Promise<void> {
    prefetchDecoder("flatgeobuf");
    const probe = await fgb.probe(this.url);
    const total = probe.size ?? tooLarge?.size;
    if (!probe.ranges) {
      if (!auto && (total === undefined || total <= this.limits.max)) {
        console.warn(noRangeNote(this.url, "`load: viewport` reads the whole file instead"));
        await this.readWhole();
        return;
      }
      // Too large to read whole, and this host can't serve it by view: the
      // hosting is what to change (not `load: viewport`, which needs it).
      throw this.tooLarge(tooLarge, total, "no-range");
    }

    // Header first: fitTo frames the whole file, and a missing index fails
    // before the map starts following the view.
    try {
      await fgb.readBbox(this.url, HEADER_ONLY, { onHeader: (h) => (this.header = h) });
    } catch (error) {
      if (auto && isFormatError(error) && error.failure.code === "no-index") {
        throw this.tooLarge(tooLarge, total, "no-index");
      }
      throw error;
    }
    if (this.destroyed) return;
    if (auto) this.autoNote(tooLarge, total);
    // One level of the index (at most 160 KB, once): each view's features
    // are estimated from it before anything is read (ml-37r.17). Without
    // it, the header's count and extent estimate them.
    try {
      if (this.header) this.inView = await fgb.readIndexLevel(this.url, this.header);
    } catch {
      /* the header's estimate */
    }
    await this.follow();
  }

  /** The refusal of a file too large to read whole that can't be read by view either. */
  private tooLarge(
    tooLarge: WholeFileTooLarge | undefined,
    size: number | undefined,
    blocker: "no-range" | "no-index"
  ): FormatError {
    return new FormatError({
      code: "too-large",
      format: "flatgeobuf",
      url: this.url,
      size: tooLarge?.size ?? size,
      features: tooLarge?.features ?? this.header?.featuresCount,
      limits: costLimits(this.limits),
      blocker,
    });
  }

  /** From the index (or the header's count and extent, without it). */
  protected estimate(view: BBox): number {
    const header = this.header;
    if (this.inView) return this.inView(view);
    return header?.envelope ? header.featuresCount * gp.shareInView(header.envelope, view) : 0;
  }

  protected readView(view: BBox, isCurrent: () => boolean): Promise<FeatureCollection | null> {
    return fgb.readBbox(this.url, view, { isCurrent, onHeader: (h) => (this.header = h) });
  }
}

// ---------------------------------------------------------------------------
// GeoParquet data provider (ml-cnv.4)
// ---------------------------------------------------------------------------

/**
 * A source's resolved `columns` (the explicit list or `all` an author or
 * {@link geoParquetColumns} put there); every column when absent.
 */
export function columnChoiceOf(source: Readonly<Record<string, unknown>>): ColumnChoice {
  const columns = source["columns"];
  if (Array.isArray(columns)) return columns.filter((c): c is string => typeof c === "string");
  return "all";
}

/** The whole-file size guards (tests pass smaller ones). */
export interface SizeLimits {
  /** Bytes transferred above which a console note advises. */
  warn: number;
  /** Bytes transferred above which a whole read isn't attempted. */
  max: number;
  /** Features above which a whole read isn't attempted ({@link WHOLE_FILE_MAX_FEATURES}). */
  maxFeatures?: number;
  /** GeoParquet decoded bytes above which a whole read isn't attempted ({@link WHOLE_FILE_MAX_DECODED_BYTES}). */
  maxDecoded?: number;
}

const DEFAULT_LIMITS: Required<SizeLimits> = {
  warn: WHOLE_FILE_WARN_BYTES,
  max: WHOLE_FILE_MAX_BYTES,
  maxFeatures: WHOLE_FILE_MAX_FEATURES,
  maxDecoded: WHOLE_FILE_MAX_DECODED_BYTES,
};

/**
 * The size guards in force: the defaults, then any a browser test set on
 * `globalThis.__MAPLIBRE_YAML_LIMITS__` (a test hook, so a small fixture can
 * stand in for a large file — not an authoring option), then `given`; then
 * the author's `load: { maxFeatures }`, which raises the feature limit (never
 * lowers it).
 */
export function sizeLimits(given?: SizeLimits, load?: Pick<LoadMode, "authorMaxFeatures">): Required<SizeLimits> {
  const hook = (globalThis as { __MAPLIBRE_YAML_LIMITS__?: Partial<SizeLimits> }).__MAPLIBRE_YAML_LIMITS__;
  const limits = { ...DEFAULT_LIMITS, ...hook, ...given } as Required<SizeLimits>;
  if (load?.authorMaxFeatures !== undefined && load.authorMaxFeatures > limits.maxFeatures) {
    limits.maxFeatures = load.authorMaxFeatures;
  }
  return limits;
}

/** The console note for a whole file a server sent because it ignores `Range:`. */
function noRangeNote(url: string, what: string): string {
  return (
    "[maplibre-yaml] " +
    consoleText(
      `${url}: this server doesn't support range requests, so ${what}. ` +
        "Hosts like GitHub Pages, Netlify, S3 and R2 support them (`python -m http.server` " +
        "doesn't; `npx serve` does)."
    )
  );
}

/**
 * Read a whole GeoParquet file (the projected columns), with the size
 * guards, all from the footer before any data is read: the transfer (over
 * {@link WHOLE_FILE_WARN_BYTES} a console note), and what decoding costs —
 * the rows and the read columns' uncompressed size (ml-37r.16). Over
 * {@link WHOLE_FILE_MAX_BYTES}, {@link WHOLE_FILE_MAX_FEATURES} rows or
 * {@link WHOLE_FILE_MAX_DECODED_BYTES} decoded, nothing is read: a file that
 * can be read by view (bbox covering column, sorted row groups, range
 * requests) rejects with {@link WholeFileTooLarge} (the loader then reads by
 * view), any other is refused with a `too-large` notice.
 *
 * @param opened - The file, when the caller already opened it.
 * @returns The features (`null` when `isCurrent()` turned false mid-read)
 *   and the opened file.
 */
export async function loadGeoParquetWhole(
  url: string,
  columns: ColumnChoice,
  options: {
    isCurrent?: () => boolean;
    opened?: GeoParquetFile;
    limits?: SizeLimits;
  } = {}
): Promise<{ data: FeatureCollection | null; source: GeoParquetFile }> {
  const limits = sizeLimits(options.limits);
  const source = options.opened ?? (await gp.open(url, { maxWholeBytes: limits.max }));
  const tooLarge = geoParquetTooLarge(source, columns, limits);
  if (tooLarge) {
    const blocker = byViewBlocker(source);
    if (!blocker) throw tooLarge;
    throw new FormatError({
      code: "too-large",
      format: "geoparquet",
      url,
      ...tooLarge.cost,
      blocker,
    });
  }
  const [size] = gp.projectedSize(source, columns);
  if (size > limits.warn) {
    // What reading by view would take, from the footer (ml-cnv.35): nothing
    // when the file is ready for it, the sort when it isn't, and nothing at
    // all from a host without range requests (its own note follows).
    const blocker = byViewBlocker(source);
    const byView =
      blocker === "no-range"
        ? ""
        : blocker
          ? `To read only the part in view, sort it (${sortedParquetCommand(url)}) and add \`load: viewport\`; or `
          : "To read only the part in view, add `load: viewport` (it has a `bbox` column and sorted row groups); or ";
    console.warn(
      "[maplibre-yaml] " +
        consoleText(
        `${url}: the columns this map reads are ${mb(size)}; loading them whole may take a few seconds. ` +
          `${byView}list fewer \`columns:\`; or, to draw it at every zoom, convert it to PMTiles. ` +
          largeDataLinks("geoparquet")
      )
    );
  }
  if (!source.ranges && source.byteLength > gp.TAIL_BYTES) {
    console.warn(noRangeNote(url, "the whole file was downloaded, not just the columns this map reads"));
  }
  const data = await gp.readAll(source, {
    columns,
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
  });
  return { data, source };
}

/**
 * Whether a GeoParquet file is over the whole-file limits (rows, decoded
 * bytes of the read columns, compressed bytes transferred), from its footer
 * alone: the {@link WholeFileTooLarge} to throw (carrying the opened file
 * and what it costs), or undefined when it can be read whole.
 */
function geoParquetTooLarge(
  source: GeoParquetFile,
  columns: ColumnChoice,
  limits: Required<SizeLimits>
): WholeFileTooLarge | undefined {
  const [size, decoded] = gp.projectedSize(source, columns);
  const rows = source.info.rows;
  if (size <= limits.max && rows <= limits.maxFeatures && decoded <= limits.maxDecoded) return undefined;
  const features = rows > limits.maxFeatures || decoded > limits.maxDecoded ? rows : undefined;
  return new WholeFileTooLarge(size, source, features, {
    size,
    features: rows,
    decoded,
    limits: costLimits(limits),
  });
}

/** Why a GeoParquet file can't be read by view, or undefined when it can. */
function byViewBlocker(source: GeoParquetFile): "no-bbox" | "unsorted" | "no-range" | undefined {
  if (!source.info.covering) return "no-bbox";
  if (!gp.canSkipByView(source)) return "unsorted";
  if (!source.ranges) return "no-range";
  return undefined;
}

/**
 * Reads one GeoParquet source into its GeoJSON data — the data provider the
 * GeoJSON `url:` pipeline calls instead of its JSON fetch. Mirrors
 * {@link FlatGeobufLoader}.
 *
 * @remarks
 * `load: all` (default): the footer, then the projected columns of every
 * row group. Size guards as in {@link loadGeoParquetWhole}.
 *
 * `load: viewport`: only the rows whose bbox intersects the view — row
 * groups outside it are never fetched (GeoParquet 1.1 `bbox` covering
 * statistics) — see {@link ViewLoader}; a view's rows are estimated from the
 * same statistics before reading. A file that can't skip anything by view
 * (no covering column: a notice; unsorted row groups, or a server without
 * range requests: a console note) is read whole instead, under the same
 * size guards.
 */
export class GeoParquetLoader extends ViewLoader {
  protected readonly format = "geoparquet" as const;
  private opened: GeoParquetFile | undefined;

  constructor(
    map: MapLibreMap,
    url: string,
    load: LoadMode,
    private readonly columns: ColumnChoice,
    callbacks: FlatGeobufCallbacks,
    limits?: SizeLimits
  ) {
    super(map, url, load, callbacks, sizeLimits(limits, load));
  }

  private overviewsNoted = false;

  /**
   * An overview file whose `geo:overviews` major version this version
   * doesn't know: its full-detail level is read, and the author told (once).
   */
  private noteOverviews(source: GeoParquetFile | undefined): void {
    const overviews = source?.info.overviews;
    if (!overviews || overviews.known || this.overviewsNoted) return;
    this.overviewsNoted = true;
    this.hint(
      `\`${this.url}\` has overviews in a newer format (geo:overviews ${overviews.version || "?"}) than this ` +
        `version of maplibre-yaml reads: ${overviews.canonical ? "drawing its full-detail level only" : "reading every row"}. ` +
        "Update maplibre-yaml, or write the file without overviews."
    );
  }

  /** The file's extent from its GeoParquet metadata — what `fitTo` frames when read by view. */
  get extent(): [[number, number], [number, number]] | undefined {
    const bbox = this.opened?.info.bbox;
    return bbox ? [[bbox[0], bbox[1]], [bbox[2], bbox[3]]] : undefined;
  }

  /**
   * The whole-file read — or, when the host already started it (the `fitTo`
   * prefetch, through {@link loadGeoParquetWhole}), its result.
   */
  protected async readWhole(started?: Promise<FeatureCollection>): Promise<void> {
    const generation = ++this.generation;
    let data: FeatureCollection | null;
    try {
      if (started) {
        data = await started;
      } else {
        const read = await loadGeoParquetWhole(this.url, this.columns, {
          isCurrent: () => generation === this.generation && !this.destroyed,
          limits: this.limits,
          ...(this.opened ? { opened: this.opened } : {}),
        });
        this.opened = read.source;
        this.noteOverviews(read.source);
        data = read.data;
      }
    } catch (error) {
      if (!(error instanceof WholeFileTooLarge)) throw error;
      this.opened ??= error.opened as GeoParquetFile | undefined;
      await this.startViewport(true, error);
      return;
    }
    this.deliver(data);
  }

  /**
   * Switch to reading by view: open the file (its footer says whether it has
   * a bbox covering column and how its row groups are laid out), then follow
   * the map.
   *
   * @param auto - true when a too-large whole-file read switched here.
   */
  protected async startViewport(auto: boolean, tooLarge?: WholeFileTooLarge): Promise<void> {
    this.opened ??= await gp.open(this.url, { maxWholeBytes: this.limits.max });
    const source = this.opened;
    this.noteOverviews(source);
    const blocker = byViewBlocker(source);
    if (blocker) {
      // Can't be read by view. Whole, then — unless that is too large too,
      // when the refusal names what blocks the by-view read (not "add
      // `load: viewport`", which the source may already say; ml-cnv.33),
      // before anything is said about reading it whole.
      const whole = tooLarge ?? geoParquetTooLarge(source, this.columns, this.limits);
      if (whole) {
        throw new FormatError({
          code: "too-large",
          format: "geoparquet",
          url: this.url,
          ...whole.cost,
          blocker,
        });
      }
      if (blocker === "no-bbox") throw new FormatError({ code: "no-index", format: "geoparquet", url: this.url });
      console.warn(
        blocker === "no-range"
          ? noRangeNote(this.url, "`load: viewport` reads the whole file instead")
          : "[maplibre-yaml] " +
              consoleText(
                `${this.url} isn't spatially sorted (each row group spans most of the file), so reading by view ` +
                  `would read almost all of it: reading it whole instead. Sort it to make \`load: viewport\` pay ` +
                  `off: ${sortedParquetCommand(this.url)}.`
              )
      );
      await this.readWhole();
      return;
    }
    if (this.destroyed) return;
    if (auto) this.autoNote(tooLarge);
    await this.follow();
  }

  /** The row groups in view, each counting its rows by the share of it in view. */
  protected estimate(view: BBox): number {
    return this.opened ? gp.rowsInView(this.opened, view) : 0;
  }

  /**
   * Whether the row groups `view` touches hold more rows than
   * {@link VIEW_DECODE_FACTOR} × `maxFeatures`: each is decoded whole, so
   * large row groups cost far more than the features in view.
   */
  protected decodeTooCostly(view: BBox, estimate: number): string | undefined {
    if (!this.opened) return undefined;
    const touched = gp.rowGroupsInView(this.opened, view);
    const budget = Math.round(this.load.maxFeatures * VIEW_DECODE_FACTOR);
    if (touched.rows <= budget) return undefined;
    const n = formatCount;
    // A raise only when the author lowered maxFeatures below the default:
    // the default's decode limit is already the most a view should decode.
    const raise = roundedRaise(touched.rows / VIEW_DECODE_FACTOR);
    const offer = touched.rows <= VIEWPORT_DEFAULT_MAX_FEATURES * VIEW_DECODE_FACTOR;
    // What to rewrite, if anything (PR #206 verification): large row groups
    // → 10,000-row groups; small ones loosely packed (GDAL's SORT_BY_BBOX
    // packs 1.5–2 × looser than a Hilbert sort) → a Hilbert sort; a file
    // already Hilbert-sorted by the hint's own command → nothing to rewrite.
    const stem = commandStem(this.url, "parquet");
    const rewrite =
      touched.largest > SMALL_ROW_GROUP
        ? `To fix it, rewrite the file with about 10,000-row groups, sorted along a Hilbert curve: ${sortedParquetCommand(this.url)}. `
        : /-hilbert$/.test(stem)
          ? ""
          : "Its row groups are already small, but loosely packed (each spans a wide area): sort it along a Hilbert " +
            `curve, which packs nearby rows tightly: ${sortedParquetCommand(this.url)}. `;
    return (
      `\`${this.url}\` has row groups of up to ${n(touched.largest)} rows, and each row group a view touches ` +
      `is decoded whole: this view holds about ${n(estimate)} features but touches ${touched.groups} row group${touched.groups === 1 ? "" : "s"}, ` +
      `${n(touched.rows)} rows, over this map's decode limit of ${n(budget)} rows (${VIEW_DECODE_FACTOR} × \`maxFeatures\`), ` +
      "so nothing is read until the map is zoomed in. " +
      rewrite +
      `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${pmtilesCommand(this.url, "geoparquet")}. ` +
      (offer ? `Or raise \`maxFeatures\` to ${raise} under \`load:\` (${raiseCost(raise, true)}). ` : "") +
      largeDataLinks("geoparquet")
    );
  }

  protected readView(view: BBox, isCurrent: () => boolean): Promise<FeatureCollection | null> {
    return gp.readBbox(this.opened!, view, { columns: this.columns, isCurrent });
  }
}
