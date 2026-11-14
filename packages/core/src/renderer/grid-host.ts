/**
 * @file What the grid reader chunk receives from core, and the field it hands back (grid source, U2)
 * @module @maplibre-yaml/core/renderer/grid-host
 *
 * @description
 * A `type: grid` source is a regular raster field on a longitude/latitude
 * grid — elevation, temperature, density, any scalar or vector field — that
 * maplibre-yaml decodes itself and page code samples by position. The
 * decoders (PNG, nullschool JSON, GeoTIFF through the COG chunk's band
 * reader) and the sampler live in the `grid` on-demand chunk
 * (`chunks/grid.js`, formats/lib/grid.ts), reached through the seam
 * (formats/decoders.ts). What the chunk needs from core — the
 * plain-language error, the seam itself, the size guards — is handed in as
 * one {@link GridHost}, as the cloud readers are given theirs
 * (renderer/cloud-host.ts). The chunk imports core as types only.
 *
 * Types only: importing this module never brings code with it.
 */

import type { Decoders } from "../formats/decoders";
import type { FormatError, FormatFailure } from "../formats/errors";

/** A position to sample: `{ lng, lat }` (MapLibre's LngLat shape) or `[lng, lat]`. */
export type GridPosition = { lng: number; lat: number } | readonly [number, number];

/**
 * A grid's node geometry. `lo1`/`la1` is the centre of node (0, 0), the
 * north-west node; `dx` counts eastward and `dy` southward, both positive;
 * `nx` columns, `ny` rows.
 */
export interface GridGeometry {
  nx: number;
  ny: number;
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
}

/** A vector field's value at a position. */
export interface VectorSample {
  u: number;
  v: number;
  /** `Math.hypot(u, v)`. */
  speed: number;
}

/**
 * What every decoded field exposes, scalar or vector. A field is immutable
 * once built: a live update never changes a field page code already holds —
 * it hands out a new one.
 */
export interface GridFieldBase {
  readonly kind: "scalar" | "vector";
  /** The unit label the document gave (`units:`), if any. */
  readonly units: string | undefined;
  /** The field's cell edges, `[west, south, east, north]`. */
  readonly bounds: readonly [number, number, number, number];
  /** The node geometry (both authored forms normalize to it). */
  readonly grid: GridGeometry;
  /** Whether the grid spans the globe in longitude, so sampling wraps at the date line. */
  readonly wraps: boolean;
  /** Columns and rows (`grid.nx`, `grid.ny`). */
  readonly nx: number;
  readonly ny: number;
  /** The values bytes 0 and 255 stand for (byte encodings only). */
  readonly range: readonly [number, number] | undefined;
  /**
   * Whether node (`col`, `row`) carries no value: marked by the document's
   * `nodata:` rule or by the encoding's own marker (alpha 0, a JSON `null`,
   * a GeoTIFF's nodata).
   */
  isMissing(col: number, row: number): boolean;
  /**
   * The same field with another `range:` — a new field from the retained
   * bytes, no decode. Byte encodings only (`rg-uv`, `scalar-r`); a field
   * carrying physical values throws.
   */
  rescale(range: readonly [number, number]): GridField;
}

/** A scalar field: one value per node. */
export interface ScalarGridField extends GridFieldBase {
  readonly kind: "scalar";
  /**
   * The value at a position, interpolated bilinearly over the four
   * surrounding nodes; `null` outside a non-wrapping grid or when any of the
   * four is missing. Latitude clamps to the first and last row.
   */
  sample(position: GridPosition): number | null;
  /** Every node's value, row-major from the north-west node, and the missing mask (1 = missing). Built once, on first call. */
  values(): { value: Float32Array; missing: Uint8Array };
}

/** A vector field: two components per node. */
export interface VectorGridField extends GridFieldBase {
  readonly kind: "vector";
  /** As {@link ScalarGridField.sample}, with `u`, `v` and `speed`. */
  sample(position: GridPosition): VectorSample | null;
  /** Every node's components, row-major from the north-west node, and the missing mask (1 = missing). Built once, on first call. */
  values(): { u: Float32Array; v: Float32Array; missing: Uint8Array };
}

/** A decoded grid, ready to sample. */
export type GridField = ScalarGridField | VectorGridField;

/** The size guards a grid is loaded under (tests pass smaller ones). */
export interface GridLimits {
  /** Cells (`nx * ny`) above which a grid isn't decoded (`GRID_MAX_CELLS`). */
  cells: number;
  /**
   * Bytes above which a grid file isn't downloaded (the whole-file cap the
   * cloud readers apply, `WHOLE_FILE_MAX_BYTES`); absent, no cap.
   */
  bytes: number;
}

/** Everything the grid chunk uses from core. */
export interface GridHost {
  /**
   * The plain-language error for a failure. A factory, not the class: the
   * class's constructor words the message from the whole message catalogue.
   */
  formatError(failure: FormatFailure): FormatError;
  /**
   * The seam, for the COG chunk's GeoTIFF band reader (`encoding: geotiff`):
   * a copy of the seam inside a chunk would resolve it to `chunks/chunks/…`.
   */
  getDecoder(name: "cog"): Promise<Decoders["cog"]>;
  /** The size guards in force; the chunk's defaults where absent. */
  limits?: Partial<GridLimits> | undefined;
}

/**
 * What the chunk's `loadGrid` — the source manager's body: fetch, cache,
 * decode — uses from core beyond decoding: the fetch helpers the main
 * bundle already carries for the cloud readers.
 */
export interface GridLoadHost extends GridHost {
  /**
   * formats/http `fetchWhole`: one `GET`, the body read up to
   * `maxWholeBytes`. Throws the `HTTP <status>` shape (`status` set),
   * whatever `fetch` threw, or `BodyTooLarge` (`name`, `size`).
   */
  fetchWhole(url: string, options: { maxWholeBytes?: number | undefined }): Promise<{ bytes: ArrayBuffer }>;
  /** `url` resolved against the page: the cache key. */
  absoluteUrl(url: string): string;
  /** `url` when a page may fetch it, else null (utils/html `safeUrl`). */
  safeUrl(url: string): string | null;
}
