/**
 * @file The FlatGeobuf library as the `flatgeobuf` on-demand chunk sees it
 * @module @maplibre-yaml/core/formats/lib/flatgeobuf
 *
 * @description
 * Only what formats/flatgeobuf.ts uses: re-exporting the whole
 * `flatgeobuf/geojson` module would ship its writer (`serialize`) in the
 * chunk too. A leaf module: it imports nothing from core (see the seam,
 * formats/decoders.ts).
 */

export { deserialize } from "flatgeobuf/geojson";
