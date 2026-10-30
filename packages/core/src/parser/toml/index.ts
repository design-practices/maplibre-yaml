/**
 * @file The `toml` chunk: what `getDecoder("toml")` hands the entry
 * @module @maplibre-yaml/core/parser/toml
 *
 * @description
 * TOML documents are read by toml-eslint-parser, bundled into this chunk
 * (KTD4), so YAML and JSON pages never download it. The entry
 * (`parser/document-text.ts`) calls {@link readToml}, validates the value
 * through the value entry points with the positions registered (KTD5), then
 * adds the TOML hints with {@link hintsFor}.
 *
 * This chunk imports core for types only: a value import would make the
 * build share code with the entry through a file every page downloads
 * (tests/lazy-chunks.test.ts).
 */

export { readToml, MAX_DEPTH, type TomlRead, type BigInteger } from "./reader";
export { hintsFor, type KnownKeys } from "./hints";
export type { TomlPositions } from "./index-positions";
