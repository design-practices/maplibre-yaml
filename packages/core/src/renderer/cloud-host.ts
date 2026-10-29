/**
 * @file What the FlatGeobuf and GeoParquet reader chunks receive from core (bundle headroom, U5)
 * @module @maplibre-yaml/core/renderer/cloud-host
 *
 * @description
 * The FlatGeobuf and GeoParquet adapters and their data providers live in
 * their readers' on-demand chunks (`chunks/flatgeobuf.js`,
 * `chunks/geoparquet.js`), next to the libraries they call. What they need
 * from core — the plain-language error, the student-message builders, the
 * HTTP helpers that start a read in the main bundle, the size guards — is
 * handed to them as one {@link CloudHost}, built once in the main bundle
 * (`renderer/cloud-sources.ts`) and given to each chunk as it loads, as the
 * `update` chunk is given its `UpdateHost`. A chunk imports core as types
 * only: a value import would copy that code (and, for a class, a second
 * class nothing `instanceof`-matches) into every chunk.
 *
 * Types only: importing this module never brings code with it.
 */

import type { FeatureCollection } from "geojson";
import type { FormatError, FormatFailure } from "../formats/errors";
import type { OpenedFile } from "../formats/flatgeobuf";
import type * as http from "../formats/http";
import type * as messages from "../components/student-messages";
import type { LoadMode } from "../formats/detect";
import type { WholeFileTooLarge } from "./cloud-sources";

/** The GeoParquet columns to read: a list (projection) or every column. */
export type ColumnChoice = readonly string[] | "all";

/** The whole-file size guards (tests pass smaller ones). */
export interface SizeLimits {
  /** Bytes transferred above which a console note advises. */
  warn: number;
  /** Bytes transferred above which a whole read isn't attempted. */
  max: number;
  /** Features above which a whole read isn't attempted (`WHOLE_FILE_MAX_FEATURES`). */
  maxFeatures?: number;
  /** GeoParquet decoded bytes above which a whole read isn't attempted (`WHOLE_FILE_MAX_DECODED_BYTES`). */
  maxDecoded?: number;
}

/**
 * A FlatGeobuf whole-file `GET` already started (in the main bundle, while
 * the reader chunk downloads), with the controller that cancels it: the
 * reader aborts it once the header counts more features than it reads.
 */
export interface StartedOpen {
  opened: Promise<OpenedFile>;
  abort: AbortController;
}

/**
 * A GeoParquet footer read already started (in the main bundle, while the
 * reader chunk downloads: `fetchTail` with `TAIL_BYTES` and the source's
 * whole-file limit), with the controller that cancels it.
 */
export interface StartedTail {
  tail: Promise<http.Tail>;
  abort: AbortController;
}

/** What a FlatGeobuf or GeoParquet data provider reports. */
export interface FlatGeobufCallbacks {
  /** Features ready (the whole file, or the view's part of it). */
  onData: (data: FeatureCollection) => void;
  /** The read failed (plain-language {@link FormatError}, or `HTTP …` for a status). */
  onError: (error: Error) => void;
  /**
   * An author hint: the map works, but the document could say what it means
   * (a file too large to read whole, read by view instead; a view too dense
   * to read). The console only when absent.
   *
   * @param once - A key for a hint shown once per source for the life of
   *   the map: a loader recreated by a live update (a changed `load:`) says
   *   it again, and the host drops the repeat (KTD14).
   */
  onHint?: (message: string, once?: string) => void;
  /**
   * Nothing of the source is drawn until the reader zooms in (`true`): the
   * map is below the source's `minzoom`, or the view holds more features
   * than one read takes — or no longer (`false`).
   */
  onTooDense?: (dense: boolean) => void;
  /**
   * A GeoParquet overview file read by view moved to another level (a zoom
   * crossed a level's boundary), just before that level's features are
   * delivered: feature ids are unique only within a level, so the host drops
   * the source's feature state (hover, selection). A data change, not a
   * document update (0.10 U2, KTD5).
   */
  onLevelChange?: () => void;
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
  /**
   * Whole columns of the file, for computed classify breaks while reading by
   * view (GeoParquet only: its canonical level, no geometry; 0.10 U3). Rejects
   * over the scan cap or on a failed read.
   */
  readColumns?(names: readonly string[]): Promise<FeatureCollection>;
  /** Begin reading; errors go to `onError`, never rejects. */
  start(started?: Promise<FeatureCollection>): Promise<void>;
  /** Stop: no more reads, no more callbacks. */
  destroy(): void;
  /** Stop reading by view while no layer draws the source; {@link resume} starts again. */
  suspend?(): void;
  /** Read by view again after {@link suspend}. */
  resume?(): void;
  /**
   * Whether {@link suspend} is in force: carried over when a loader is
   * recreated for changed options (live documents, U3), so a source nothing
   * draws does not start following the map because its `load:` changed.
   */
  readonly suspended?: boolean;
}

/** The student-message builders the readers' notes and hints use. */
export type CloudMessages = Pick<
  typeof messages,
  | "commandStem"
  | "formatCount"
  | "indexedFlatGeobufCommand"
  | "largeDataLinks"
  | "overviewsCommand"
  | "pmtilesCommand"
  | "raiseCost"
  | "sortedParquetCommand"
  | "wholeFileCause"
>;

/** The HTTP helpers (formats/http) the readers' range and whole-file reads use. */
export type CloudHttp = Pick<
  typeof http,
  "fetchTail" | "fetchWhole" | "httpError" | "isEncodedRange" | "rangeRepliesUnreadable"
>;

/** Everything the FlatGeobuf and GeoParquet chunks use from core. */
export interface CloudHost {
  /**
   * The plain-language error for a failure. A factory, not the class: the
   * class's constructor words the message from the whole message catalogue.
   */
  formatError(failure: FormatFailure): FormatError;
  /**
   * The seam, for the GeoParquet chunk's own on-demand codec
   * (`geoparquet-brotli`): a copy of the seam inside a chunk would resolve
   * it to `chunks/chunks/…`.
   */
  getDecoder(name: "geoparquet-brotli"): Promise<typeof import("../formats/lib/geoparquet-brotli")>;
  /** Thrown by the body reads (`http.fetchTail` and the FlatGeobuf stream guard); one class, so `instanceof` holds. */
  BodyTooLarge: typeof http.BodyTooLarge;
  /** A whole-file read refused for size (one class, so `instanceof` holds on both sides). */
  WholeFileTooLarge: typeof WholeFileTooLarge;
  /** The size guards in force (defaults, the test hook, `given`, then the author's `maxFeatures`). */
  sizeLimits(given?: SizeLimits, load?: Pick<LoadMode, "authorMaxFeatures">): Required<SizeLimits>;
  /** The FlatGeobuf whole-file `GET` (`formats/flatgeobuf`), when the main bundle didn't start it. */
  openWhole(url: string, signal?: AbortSignal): Promise<OpenedFile>;
  /** Throw away a response body that won't be read. */
  discard(opened: OpenedFile): void;
  http: CloudHttp;
  /** A message with its `` `code` `` spans quoted for the console. */
  consoleText(message: string): string;
  /** Record a file's own column names against the data read from it (the property-name hints read them back). */
  recordPropertyNames(data: object, names: readonly string[]): void;
  messages: CloudMessages;
}

/**
 * Everything the COG chunk's adapter (formats/lib/cog-reader.ts) uses from
 * core, handed in by formats/cog-protocol.ts as the chunk loads.
 */
export interface CogHost {
  /** The plain-language error for a failure (its `message` is the wording a hint shows, too). */
  formatError(failure: FormatFailure): FormatError;
  /** A message with its `` `code` `` spans quoted for the console. */
  consoleText(message: string): string;
  /**
   * The file's first-64-KB read the main bundle started while the chunk
   * downloaded, if it did — handed over once (the preflight reads it
   * itself otherwise).
   */
  takeHeaderRead(fileUrl: string): Promise<Response> | undefined;
}

/**
 * Everything the PMTiles chunk's failure path (formats/lib/pmtiles.ts) uses
 * from core, handed in by formats/pmtiles.ts as the chunk loads.
 */
export interface PmtilesHost {
  /** The plain-language error for a failure. */
  formatError(failure: FormatFailure): FormatError;
  /** Whether an archive's host serves its range replies from a compressed copy (asked once per archive). */
  rangeRepliesUnreadable: typeof http.rangeRepliesUnreadable;
}
