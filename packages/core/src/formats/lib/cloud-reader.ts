/**
 * @file What the FlatGeobuf and GeoParquet reader chunks share (bundle headroom, U5)
 * @module @maplibre-yaml/core/formats/lib/cloud-reader
 *
 * @description
 * The data providers behind a FlatGeobuf or GeoParquet `url:` — the
 * whole-or-by-view start, the lifecycle, reading by view — are in their
 * readers' on-demand chunks (formats/lib/flatgeobuf.ts,
 * formats/lib/geoparquet.ts); this is the part both share. The CDN build
 * carries a copy in each chunk; the npm build shares it between them.
 *
 * Core reaches these modules only through the seam (formats/decoders.ts),
 * and they import core as types only: what they need from it — the
 * plain-language error, the message builders, the HTTP helpers, the size
 * guards — is the {@link CloudHost} the main bundle hands each chunk as it
 * loads ({@link useHost}). The leaf modules they import (formats/crs,
 * formats/large-data, formats/detect) import nothing themselves.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { WholeFileCost } from "../../components/student-messages";
import type { FormatError } from "../errors";
import type { LoadMode } from "../detect";
import type { CloudHost, FlatGeobufCallbacks, FormatLoader, SizeLimits } from "../../renderer/cloud-host";
import type { WholeFileTooLarge } from "../../renderer/cloud-sources";
import { roundedRaise, SAFE_VIEW_FEATURES } from "../large-data";

// ---------------------------------------------------------------------------
// The host (renderer/cloud-host)
// ---------------------------------------------------------------------------

let bound: CloudHost | undefined;

/**
 * Give this chunk what it uses from core. The main bundle calls it once, as
 * the chunk loads (`cloudReaders` in renderer/cloud-sources), before any
 * reader runs.
 */
export function useHost(host: CloudHost): void {
  bound = host;
}

/** What this chunk uses from core (see {@link useHost}). */
export function host(): CloudHost {
  if (!bound) throw new Error("maplibre-yaml: a cloud reader ran before the renderer gave it its host (useHost)");
  return bound;
}

/**
 * Whether `error` is a `FormatError`. Duck-typed, as formats/errors's own
 * (which this chunk doesn't import: its class pulls in the message catalogue).
 */
export function isFormatError(error: unknown): error is FormatError {
  const failure = (error as { failure?: { code?: unknown; format?: unknown } } | null)?.failure;
  return typeof failure?.code === "string" && typeof failure?.format === "string";
}

/** Whether an error is an abort (a superseded request), never worth reporting (as formats/errors's). */
export function isAbortError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "AbortError" || /\baborted?\b/i.test(String(e?.message ?? ""));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Pause after the map stops moving before re-reading the view. */
export const VIEWPORT_DEBOUNCE_MS = 250;

/** `[west, south, east, north]`. */
export type BBox = [number, number, number, number];

/**
 * A file's bytes, read a range at a time: what the facts readers
 * (`parquetFacts`, `headerFacts`; large data round 2 U6) take. The shape of
 * hyparquet's `AsyncBuffer`, so either is the other: a file handle in the
 * CLI, a range reader over HTTP, or bytes in memory.
 */
export interface AsyncBuffer {
  /** The file's size in bytes. */
  byteLength: number;
  /** The bytes `[start, end)` (`end` defaults to the file's end). */
  slice(start: number, end?: number): ArrayBuffer | Promise<ArrayBuffer>;
}

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
export function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * The share of `box` that `view` covers, by area (0–1). A box with no area
 * (one point, a straight line) counts whole when the view touches it.
 */
export function shareInView(box: BBox, view: BBox): number {
  const w = Math.min(box[2], view[2]) - Math.max(box[0], view[0]);
  const h = Math.min(box[3], view[3]) - Math.max(box[1], view[1]);
  if (w < 0 || h < 0) return 0;
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  return area > 0 ? (w * h) / area : 1;
}

/** The limits a whole-file read is measured against, as the notes name them. */
export function costLimits(limits: Required<SizeLimits>): WholeFileCost["limits"] {
  return { features: limits.maxFeatures, bytes: limits.max, decoded: limits.maxDecoded };
}

/** The console note for a whole file a server sent because it ignores `Range:`. */
export function noRangeNote(url: string, what: string): string {
  return (
    "[maplibre-yaml] " +
    host().consoleText(
      `${url}: this server doesn't support range requests, so ${what}. ` +
        "Hosts like GitHub Pages, Netlify, S3 and R2 support them (`python -m http.server` " +
        "doesn't; `npx serve` does)."
    )
  );
}

// ---------------------------------------------------------------------------
// The by-view loader both data providers extend
// ---------------------------------------------------------------------------

/**
 * What the FlatGeobuf and GeoParquet providers share: the whole-or-by-view
 * start, the lifecycle, and reading by view — re-read
 * {@link VIEWPORT_DEBOUNCE_MS} after the map stops moving (a newer read
 * supersedes an older one), nothing below `minzoom`, and nothing for a view
 * the file says holds more than `maxFeatures` features (ml-37r.17).
 */
export abstract class ViewLoader<Opening extends { abort: AbortController } = { abort: AbortController }>
  implements FormatLoader
{
  protected generation = 0;
  protected destroyed = false;
  /**
   * The file's first request, started by the main bundle while this chunk
   * downloaded (see {@link start}): taken by the first read that needs it.
   */
  private opening: Opening | undefined;
  private viewport = false;
  /** Why the last view wasn't read (below `minzoom`, too dense), or undefined. */
  private skipped: "minzoom" | "dense" | undefined;
  /**
   * Following was stopped by {@link suspend} (and {@link resume} restarts
   * it). Set before the loader reaches by-view mode, it holds the follow
   * back until {@link resume}: a loader recreated while nothing draws its
   * source (live documents, U3) is started this way.
   */
  private _suspended = false;
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

  /**
   * The zoom below which a by-view read reads nothing: `load.minzoom` (a
   * GeoParquet overview file without an author `minzoom`: 0, its coarsest
   * level serving wide views).
   */
  get minzoom(): number {
    return this.load.minzoom;
  }

  /** Whether {@link suspend} is in force (see {@link FormatLoader.suspended}). */
  get suspended(): boolean {
    return this._suspended;
  }

  /**
   * The outermost zoom, in quarter steps from `from` (and never below
   * `minzoom`), whose view of `width` × `height` px around `center` would be
   * read: its estimate within `maxFeatures`, and (GeoParquet) its row groups
   * within the decode budget. What `fitTo` frames a source read by view at,
   * so the map opens showing features rather than the zoom-in line.
   */
  zoomThatFits(center: [number, number], from: number, width: number, height: number): number | undefined {
    const start = Math.max(from, this.minzoom);
    for (let zoom = start; zoom <= Math.min(start + 8, 22); zoom += 0.25) {
      const view = viewAround(center, zoom, width, height);
      const estimate = Math.round(this.estimate(view, zoom));
      if (estimate <= this.load.maxFeatures && this.decodeTooCostly(view, estimate, zoom) === undefined) return zoom;
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
   * @param opening - The file's first request, already in flight (the main
   *   bundle starts it while this chunk downloads, so the two overlap):
   *   the first read uses it instead of asking again.
   */
  async start(started?: Promise<FeatureCollection>, opening?: Opening): Promise<void> {
    this.opening = opening;
    try {
      if (this.load.mode === "viewport") {
        await this.startViewport(false);
      } else {
        await this.readWhole(started);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      // A first request no read took (a read that didn't need it).
      this.takeOpening()?.abort.abort();
    }
  }

  /** Stop: no more reads, no more callbacks. */
  destroy(): void {
    this.suspend();
    this.destroyed = true;
    // A first request no read took (destroyed before it was needed).
    this.takeOpening()?.abort.abort();
  }

  /** The first request the host started (see {@link start}), once: later reads ask anew. */
  protected takeOpening(): Opening | undefined {
    const opening = this.opening;
    this.opening = undefined;
    return opening;
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
    this._suspended = true;
  }

  /**
   * Follow the map again after {@link suspend} (a layer draws the source
   * again). A whole-file loader has nothing to resume.
   */
  resume(): void {
    if (this.destroyed || !this._suspended) return;
    this._suspended = false;
    if (!this.viewport) return;
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

  /**
   * About how many features `view` at map zoom `zoom` holds, from what the
   * reader already has (no request). `zoom` chooses a GeoParquet overview
   * file's level.
   */
  protected abstract estimate(view: BBox, zoom: number): number;

  /**
   * An author hint when reading `view` would decode far more than the
   * features in it (GeoParquet's whole row groups), else undefined: the view
   * is then not read either.
   */
  protected decodeTooCostly(_view: BBox, _estimate: number, _zoom: number): string | undefined {
    return undefined;
  }

  /**
   * The author hint for a view over `maxFeatures`, when the reader words its
   * own (a GeoParquet overview level too dense), else undefined.
   */
  protected denseHint(_view: BBox, _estimate: number, _zoom: number): string | undefined {
    return undefined;
  }

  /**
   * The routes to drawing the file at every zoom, as hints end with them
   * (the Large data guide's table, 0.10 U5): PMTiles — a FlatGeobuf through
   * GeoParquet, in the command itself. GeoParquet adds an overview file.
   */
  protected everyZoom(): string {
    return `To draw it at every zoom (a citywide view too), convert it to PMTiles: ${host().messages.pmtilesCommand(this.url, this.format)}. `;
  }

  /** Whether a by-view read picks a level by zoom (a GeoParquet overview file), rather than reading from `minzoom`. */
  protected get readsLevels(): boolean {
    return false;
  }

  /** Read the features in `view` at map zoom `zoom` (`null` when superseded). */
  protected abstract readView(view: BBox, isCurrent: () => boolean, zoom: number): Promise<FeatureCollection | null>;

  protected fail(error: unknown): void {
    if (this.destroyed || isAbortError(error)) return;
    this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }

  protected deliver(data: FeatureCollection | null): void {
    if (data && !this.destroyed) this.callbacks.onData(data);
  }

  /**
   * An author hint. `once`: the host shows it once for the source, across
   * the loaders a live update recreates (see {@link FlatGeobufCallbacks.onHint}).
   */
  protected hint(message: string, once?: string): void {
    if (this.callbacks.onHint) this.callbacks.onHint(message, once);
    else console.warn(`[maplibre-yaml] ${host().consoleText(message)}`);
  }

  /**
   * The note for a file too large to read whole that is read by view
   * instead: why, and the ways to change it.
   */
  protected autoNote(tooLarge: WholeFileTooLarge | undefined, size?: number): void {
    const cause = host().messages.wholeFileCause({
      format: this.format,
      size: tooLarge?.size ?? size,
      features: tooLarge?.features,
      ...tooLarge?.cost,
    });
    this.hint(
      `\`${this.url}\` ${cause.text}, so only the part in view is read, ` +
        // An overview file is read from zoom 0 because its coarsest level
        // serves the widest views: say that, not "from zoom 0" (U5).
        (this.readsLevels ? "at the overview level that fits the zoom. " : `from zoom ${this.minzoom}. `) +
        "Add `load: viewport` to the source to say so (this note then goes). " +
        (cause.raise !== undefined
          ? `To load it whole anyway, raise \`load: { maxFeatures: ${cause.raise} }\` (${host().messages.raiseCost(cause.raise, false)}). `
          : "") +
        this.everyZoom() +
        host().messages.largeDataLinks(this.format),
      "auto"
    );
  }

  /**
   * Follow the map: read the view now, and again after every move. Under
   * {@link suspend} the loader only notes that it reads by view; the first
   * read waits for {@link resume}.
   */
  protected async follow(): Promise<void> {
    if (this.destroyed) return;
    this.viewport = true;
    if (this._suspended) return;
    this.map.on("moveend", this.onMoveEnd);
    await this.refresh();
  }

  /**
   * Read the current view — or nothing below `minzoom`, or for a view too
   * dense to read. The zoom is read once: it chooses an overview file's level
   * for the estimate, the decode budget and the read alike.
   */
  private async refresh(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.generation;
    const zoom = this.map.getZoom();
    if (zoom < this.minzoom) {
      // Once per stretch below minzoom, not on every pan.
      if (this.skip("minzoom")) {
        // Lowering minzoom helps only when this view would then be read
        // (ml-cnv.35): further out, a citywide file's view is over budget.
        const view = viewBBox(this.map);
        const estimate = Math.round(this.estimate(view, zoom));
        const lower = Math.floor(zoom);
        const helps = estimate <= this.load.maxFeatures && this.decodeTooCostly(view, estimate, zoom) === undefined;
        console.info(
          "[maplibre-yaml] " +
            host().consoleText(
            `${this.url} is read by view from zoom ${this.minzoom}, so nothing of it is drawn further ` +
              "out and the reader is asked to zoom in. " +
              (helps
                ? `To read it from here, lower \`minzoom\` to ${lower} under \`load:\`; to draw it at every zoom, convert it to PMTiles. `
                : `Further out its views hold more than \`maxFeatures\`, so a lower \`minzoom\` wouldn't draw it; to draw it at every zoom, convert it to PMTiles: ${host().messages.pmtilesCommand(this.url, this.format)}. `) +
              host().messages.largeDataLinks(this.format)
          )
        );
      }
      return;
    }
    const view = viewBBox(this.map);
    const estimate = Math.round(this.estimate(view, zoom));
    const max = this.load.maxFeatures;
    if (estimate > max) {
      // Reading it would decode (and draw) more than a tab can take: the
      // citywide parcels view read 261 MB and ran at 8 fps, or crashed.
      this.skip("dense");
      if (!this.hintedDense) {
        this.hintedDense = true;
        const own = this.denseHint(view, estimate, zoom);
        // A raise only while the view stays usable (formats/large-data):
        // 800,000 parcels by view ran at 6 fps on 5.1 GB.
        const raise = roundedRaise(estimate);
        // Once per source and budget, across the readers a live update
        // recreates (KTD14): a changed `maxFeatures` is worth a new hint.
        if (own !== undefined) this.hint(own, `dense-level:${max}`);
        else this.hint(
          `\`${this.url}\` has about ${host().messages.formatCount(estimate)} features in view, more than one read ` +
            `takes (\`maxFeatures\`: ${host().messages.formatCount(max)}), so nothing of it is drawn until the map is ` +
            "zoomed in. " +
            (raise <= SAFE_VIEW_FEATURES
              ? `To draw this view, raise \`maxFeatures\` to ${raise} under \`load:\` (${host().messages.raiseCost(raise, true)}). `
              : "That is too many to draw at once in a browser. ") +
            this.everyZoom() +
            host().messages.largeDataLinks(this.format),
          `dense:${max}`
        );
      }
      return;
    }
    const costly = this.decodeTooCostly(view, estimate, zoom);
    if (costly !== undefined) {
      this.skip("dense");
      if (!this.hintedDecode) {
        this.hintedDecode = true;
        this.hint(costly, `decode:${max}`);
      }
      return;
    }
    const data = await this.readView(view, () => generation === this.generation && !this.destroyed, zoom);
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
