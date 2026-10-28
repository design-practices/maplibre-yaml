/**
 * @file Plain-language failures for cloud-native sources (0.9, ml-cnv)
 * @module @maplibre-yaml/core/formats/errors
 *
 * @description
 * The decoders surface raw library strings ("Wrong magic number for PMTiles
 * archive", "Failed to fetch", "Server returned no content-length header…").
 * None of those tell a student what to do. Every failure is classified here
 * into a {@link FormatFailure} — a code plus the facts — and worded by the
 * shared on-page message catalogue (`components/student-messages.ts`,
 * {@link describeFormatFailure}), so the notice, the console and
 * `ml-map:layer-data-error` all carry the same sentence, and the notice-split
 * work (ml-aot.57) can route these the way it routes every other message.
 */

import { describeFormatFailure } from "../components/student-messages.js";
import type { CloudFormat } from "./detect";

/** Why a cloud-native source didn't load. */
export type FormatFailureCode =
  /** The server ignored `Range:` and sent the whole file (python -m http.server). */
  | "no-range"
  /**
   * The server compresses the parts of a file it sends (a range response
   * with `Content-Encoding`, as jsDelivr's Cloudflare leg does), so a part
   * can't be decoded on its own.
   */
  | "encoded-range"
  /** The request never completed: CORS refusal or an unreachable host. */
  | "cors"
  /** The bytes aren't this format (a wrong path that returned a web page). */
  | "not-format"
  /** A Zstandard-compressed file (a compressed FlatGeobuf), which this version doesn't read. */
  | "compressed"
  /** An HTTP error status. */
  | "http"
  /** Too large to load whole (and no index to read part of it). */
  | "too-large"
  /** `load: viewport` (or an oversized file) needs a spatial index it lacks. */
  | "no-index"
  /** Not longitude/latitude (FlatGeobuf), or not Web Mercator (COG). */
  | "crs"
  /** A Parquet file without GeoParquet metadata (no `geo` key). */
  | "not-geoparquet"
  /** GeoParquet geometry in an encoding this version doesn't decode (GeoArrow). */
  | "encoding"
  /** A GeoTIFF that draws but isn't cloud-optimized (an author hint, not a failure). */
  | "not-cloud-optimized"
  /** A recognized format this version doesn't read (none in 0.9; kept for the next one). */
  | "unsupported"
  /** The reader itself couldn't be set up (e.g. maplibre-gl too old). */
  | "decoder"
  /**
   * The reader's file (`dist/chunks/<name>.js`, loaded on demand) couldn't be
   * downloaded: offline, a content blocker or CSP, or a self-hosted copy of
   * maplibre-yaml without its `chunks/` folder. `url` is that file.
   */
  | "chunk"
  /** Anything else the reader reported while decoding. */
  | "read";

/** The facts behind one failure; the message is built from these. */
export interface FormatFailure {
  code: FormatFailureCode;
  format: CloudFormat;
  /** The file as the page requested it (base already applied). */
  url: string;
  status?: number;
  statusText?: string;
  /** File size in bytes, when known (`too-large`). */
  size?: number | undefined;
  /** Number of features, when that is what made it too large (`too-large`; wins over `size`). */
  features?: number | undefined;
  /**
   * `too-large`: the GeoParquet columns' decoded bytes, the limits the file
   * was measured against (so the notice can say which it is over), and
   * whether `size` is the whole file rather than the columns a map reads.
   */
  decoded?: number | undefined;
  limits?: { features?: number; bytes?: number; decoded?: number } | undefined;
  sizeIsFile?: boolean | undefined;
  /**
   * `too-large`: why the file can't be read by view instead — no `bbox`
   * column, unsorted row groups, no spatial index, a server without range
   * requests, or one that hides the file's size from the page.
   */
  blocker?: "no-bbox" | "unsorted" | "no-index" | "no-range" | "no-size" | undefined;
  /** The CRS the file declares (`crs`), e.g. "EPSG:3857". */
  crs?: string;
  /** The geometry encoding a GeoParquet file uses (`encoding`), e.g. "point". */
  encoding?: string;
  /** The underlying library message (`read`, `decoder`, `chunk`). */
  detail?: string;
}

/**
 * A classified cloud-native failure. `message` is the plain-language
 * sentence; `failure` keeps the facts for callers that add page context
 * (the resolved URL, a `base` hint).
 */
export class FormatError extends Error {
  readonly failure: FormatFailure;
  /** Same as `failure.url`; the shape `describeDataProblem` already reads. */
  readonly url: string;

  constructor(failure: FormatFailure) {
    super(describeFormatFailure(failure));
    this.name = "FormatError";
    this.failure = failure;
    this.url = failure.url;
  }
}

/**
 * Whether `error` is a {@link FormatError}. Duck-typed, not `instanceof`:
 * the error may cross a bundle boundary (two copies of core on a page).
 */
export function isFormatError(error: unknown): error is FormatError {
  const failure = (error as { failure?: { code?: unknown; format?: unknown } } | null)?.failure;
  return typeof failure?.code === "string" && typeof failure?.format === "string";
}

/** Whether an error is an abort (a superseded request), never worth reporting. */
export function isAbortError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "AbortError" || /\baborted?\b/i.test(String(e?.message ?? ""));
}
