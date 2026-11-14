/**
 * @file Grid decoding from the package entry (grid source, U4)
 * @module @maplibre-yaml/core/formats/grid
 *
 * @description
 * `decodeGrid(bytes, spec)` for tooling and tests that hold a grid file's
 * bytes and want the field page code gets — a converter checking its own
 * output, a CI check, `mlym`. Node-safe. It is a thin async wrapper: the
 * decoders, the sampler and the PNG reader live in the `grid` on-demand
 * module (formats/lib/grid.ts), reached through the seam, so the package
 * entry never imports the chunk and a page without a grid never downloads
 * it (tests/lazy-chunks.test.ts). The renderer's own path to the same
 * decoder is renderer/grid-sources.ts, whose host this passes along.
 */

import type { GridSource } from "../schemas/source.schema";
import type { GridField } from "../renderer/grid-host";
import { getDecoder } from "./decoders";
import { gridHost } from "../renderer/grid-sources";

/**
 * Decode a whole grid file already in memory into its field (R7–R11).
 *
 * @param bytes - The file: a PNG for `rg-uv` / `scalar-r`, the JSON text for
 *   `nullschool-json`, a GeoTIFF for `geotiff`.
 * @param spec - The source as declared (`encoding`, geometry, `range`, …):
 *   what the bytes cannot say for themselves.
 * @returns A field that samples by position and never changes.
 * @throws {FormatError} (format `grid`) when the bytes are not what `spec`
 *   says, or the grid is over the cell cap — the same messages the map's
 *   notice shows.
 */
export async function decodeGrid(bytes: ArrayBuffer | ArrayBufferView, spec: GridSource): Promise<GridField> {
  return (await getDecoder("grid")).decodeGrid(bytes, spec, gridHost);
}
