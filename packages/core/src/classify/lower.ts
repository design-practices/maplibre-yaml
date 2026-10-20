/**
 * @file Lower `classify:` in the internal model (live render and `mlym emit`)
 * @module @maplibre-yaml/core/classify/lower
 *
 * @description
 * `toModel` calls {@link lowerClassifyInModel} for v1 and v2 alike, so the
 * renderer and the emitter both see plain MapLibre: the compiled paint, the
 * no-data filter, and the record in `metadata["maplibre-yaml:classify"]`.
 * Nothing downstream knows `classify:` existed (`exports` class).
 *
 * Breaks a `method:` computes are filled in here when the data is inline.
 * When it is fetched (`url:`, a `data:` URL, a FlatGeobuf file), the layer
 * stays *pending*: live, the renderer computes once the data lands
 * (`renderer/classify-runtime.ts`); on export, {@link bakeClassify} fetches
 * the data and bakes the breaks into the style.
 */

import type { MapModel, LayerModel, SourceModel } from "../model/types";
import type { ClassifyConfig } from "../schemas/classify.schema";
import {
  applyClassifyToSpec,
  classifyRecordOf,
  compileClassify,
  isPending,
  resolveClassify,
  withData,
  CLASSIFY_METADATA_KEY,
  type ClassifyRecord,
} from "./compile";
import { isFeatureData } from "./breaks";

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Where a layer's GeoJSON data is, as far as the model knows. */
export type LayerDataLocation =
  | { kind: "inline"; data: unknown }
  | { kind: "url"; url: string; source: string }
  | { kind: "none" };

/**
 * Find a layer's data: inline (`data:` object, `prefetchedData`), a URL to
 * fetch (`url:`, or a `data:` string), or neither (tiles, a basemap source).
 */
export function layerDataLocation(
  layer: LayerModel,
  sources: Record<string, SourceModel>
): LayerDataLocation {
  const ref = layer.spec["source"];
  let spec: Record<string, unknown> | undefined;
  let runtime: Record<string, unknown> | undefined;
  let name: string;
  if (typeof ref === "string") {
    const source = sources[ref];
    if (!source) return { kind: "none" };
    spec = isObject(source.spec) ? source.spec : undefined;
    runtime = source.runtime;
    name = ref;
  } else if (isObject(ref)) {
    spec = ref;
    runtime = isObject(layer.runtime["source"]) ? (layer.runtime["source"] as Record<string, unknown>) : undefined;
    name = `${String(layer.spec["id"])}-source`;
  } else {
    return { kind: "none" };
  }
  if (!spec || spec["type"] !== "geojson") return { kind: "none" };
  if (isFeatureData(spec["data"])) return { kind: "inline", data: spec["data"] };
  if (runtime && isFeatureData(runtime["prefetchedData"])) {
    return { kind: "inline", data: runtime["prefetchedData"] };
  }
  if (typeof spec["url"] === "string") return { kind: "url", url: spec["url"], source: name };
  if (typeof spec["data"] === "string") return { kind: "url", url: spec["data"], source: name };
  return { kind: "none" };
}

/**
 * Compile every layer's `classify:` in a model. Layers without one pass
 * through by reference; a model without any comes back as the same object.
 */
export function lowerClassifyInModel(model: MapModel): MapModel {
  if (!model.style.layers.some((l) => isObject(l.spec["classify"]))) return model;
  const layers = model.style.layers.map((layer) => {
    const config = layer.spec["classify"];
    if (!isObject(config)) return layer;
    const type = String(layer.spec["type"] ?? "");
    let record = resolveClassify(config as unknown as ClassifyConfig, type);
    const where = layerDataLocation(layer, model.style.sources);
    if (where.kind === "inline") record = withData(record, where.data);
    return { ...layer, spec: applyClassifyToSpec(layer.spec, record) };
  });
  return { ...model, style: { ...model.style, layers } };
}

/**
 * Replace a layer's classify record and recompiled paint — the filter is left
 * as it is (it never depends on the breaks, and it already carries the guard).
 */
export function updateClassifySpec(
  spec: Record<string, unknown>,
  record: ClassifyRecord
): Record<string, unknown> {
  const compiled = compileClassify(record);
  const paint = isObject(spec["paint"]) ? spec["paint"] : {};
  const metadata = isObject(spec["metadata"]) ? spec["metadata"] : {};
  return {
    ...spec,
    paint: { ...paint, ...compiled.paint },
    metadata: { ...metadata, [CLASSIFY_METADATA_KEY]: record },
  };
}

/** Loads a GeoJSON URL for {@link bakeClassify}. Throws (or rejects) on failure. */
export type ClassifyDataLoader = (url: string) => Promise<unknown>;

/** A layer whose breaks could not be computed at export. */
export interface ClassifyBakeError {
  layer: string;
  path: string;
  message: string;
}

/**
 * Fetch the data of every pending `method:` layer and bake its breaks into
 * the model (`mlym emit`).
 *
 * @remarks
 * There is no honest fallback for a classed map whose classes are unknown —
 * an all-grey style would look like a result — so a URL that cannot be
 * loaded is an error, naming the layer, the URL and the fix. Each URL is
 * loaded once, however many layers share it.
 */
export async function bakeClassify(
  model: MapModel,
  load: ClassifyDataLoader
): Promise<{ model: MapModel; errors: ClassifyBakeError[] }> {
  const errors: ClassifyBakeError[] = [];
  const cache = new Map<string, Promise<unknown>>();
  const layers = await Promise.all(
    model.style.layers.map(async (layer) => {
      const record = classifyRecordOf(layer.spec);
      if (!record || !isPending(record)) return layer;
      const id = String(layer.spec["id"]);
      const where = layerDataLocation(layer, model.style.sources);
      const fail = (message: string) => {
        errors.push({ layer: id, path: `layers.${id}.classify`, message });
        return layer;
      };
      if (where.kind !== "url") {
        return fail(
          `Layer "${id}" computes its breaks (method: ${record.method}) but its source has no data ` +
            "to compute them from at export. Write breaks: yourself."
        );
      }
      let pending = cache.get(where.url);
      if (!pending) {
        pending = load(where.url);
        cache.set(where.url, pending);
      }
      let data: unknown;
      try {
        data = await pending;
      } catch (error) {
        return fail(
          `Layer "${id}" computes its breaks (method: ${record.method}) from ${where.url}, ` +
            `which could not be loaded at export: ${error instanceof Error ? error.message : String(error)}. ` +
            "Run mlym emit where that URL is reachable, or write the breaks yourself (breaks: [...])."
        );
      }
      if (!isFeatureData(data)) {
        return fail(
          `Layer "${id}" computes its breaks from ${where.url}, which did not load as GeoJSON ` +
            "(a Feature or FeatureCollection)."
        );
      }
      return { ...layer, spec: updateClassifySpec(layer.spec, withData(record, data)) };
    })
  );
  return { model: { ...model, style: { ...model.style, layers } }, errors };
}
