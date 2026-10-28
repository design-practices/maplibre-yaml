/**
 * @file The live-data chunk: polling, streaming and merging (bundle headroom, U4)
 * @module @maplibre-yaml/core/data/live
 *
 * @description
 * What a source with `refresh:` (an interval with a `url`, or a `stream`
 * beside it) runs once its first data is on the map. Reached only through
 * `getDecoder("live")` (formats/decoders.ts), so a static page never
 * downloads it: `LayerManager` holds these behind a null-safe facade and
 * awaits this module inside `setupDataUpdates`, after the layer is added.
 *
 * These modules import no core code but the leaf modules `retry-manager`
 * and `utils/event-emitter`, which the CDN chunk carries a copy of
 * (`tests/lazy-chunks.test.ts` holds that line). The npm API still exports
 * the managers from `data/`, unchanged.
 */

export { PollingManager } from "../polling-manager";
export { StreamManager } from "../streaming/stream-manager";
export { DataMerger, mergeKeyOf } from "../merge/data-merger";
