/**
 * @file The version-dispatching entry into the internal model.
 * @module model/to-model
 *
 * @description
 * The parser returns a RAW block (`ParseResult<MapBlock>`); the consumers
 * (`<ml-map>`, `mlym emit`) turn that block into the internal {@link MapModel}.
 * v0.6.0 adds a second format, so that turn is the seam where v1 and v2 fork:
 * consumers call {@link toModel} instead of {@link normalizeMapBlock} directly,
 * and the version tag on the block selects the front end.
 */

import type { MapModel, V1MapInput } from "./types";
import type { MapBlockV2 } from "../schemas/map-v2.schema";
import { normalizeMapBlock } from "./normalize";
import { readV2Block } from "./read-v2";

/**
 * Turn a parsed block into the internal model, selecting the reader by version.
 *
 * @param block - A parsed block; `version` (when present) selects the front end.
 * @returns The internal {@link MapModel}.
 *
 * @remarks
 * `version: 2` routes to {@link readV2Block} (U3). Absent or `version: 1` is the
 * v1 normalizer, unchanged.
 */
export function toModel(
  block: { version?: number } & Record<string, unknown>
): MapModel {
  if (block.version === 2) {
    return readV2Block(block as unknown as MapBlockV2);
  }
  return normalizeMapBlock(block as unknown as V1MapInput);
}
