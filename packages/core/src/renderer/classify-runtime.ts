/**
 * @file Live half of `classify:` — breaks computed when fetched data lands
 * @module @maplibre-yaml/core/renderer/classify-runtime
 *
 * @description
 * `toModel` compiles every `classify:` before the renderer sees the layers,
 * and fills in computed breaks when the data is inline. A `method:` over
 * fetched data (`url:`, a `data:` URL, a decoded FlatGeobuf file) arrives
 * *pending*; this computes its breaks once the data lands and re-applies the
 * paint with `setPaintProperty`. A refresh recomputes from the new data, so
 * the classes always describe the features on the map.
 *
 * Data reaches it through the layer manager's own pipeline (the same
 * `getSourceData` the `fitTo` camera reads), so every loader that delivers
 * GeoJSON through that pipeline — fetch, refresh, stream, the FlatGeobuf
 * decoder — feeds classify without knowing about it. A `data:` *string*
 * (a URL MapLibre fetches itself) is the one path outside the pipeline; it
 * is fetched here once.
 *
 * Two orderings have to work: a named source's first fetch can land before
 * the layers over it are added (they wait on images), and the pipeline's
 * "data loaded" can name either a layer (inline sources) or the source
 * (named ones). So a delivery is matched against both, the computed paint
 * is written onto the layer object the renderer is about to add, and
 * {@link ClassifyRuntime.layersReady} catches up once every layer is in.
 *
 * **Sources read by view.** A FlatGeobuf or GeoParquet source read by view — asked for
 * (`load: viewport`, which validation already refuses under `method:`), or
 * switched to because the file is too large to read whole — only ever holds
 * the features in view. Breaks computed from those would describe part of
 * the data and change as the map pans, so they are never computed: the
 * layer keeps its no-data colour and one notice asks for explicit `breaks:`.
 * A layer with explicit `breaks:` keeps drawing them; its legend shows the
 * classes without data-derived edges (the min/max of the part in view would
 * mislead just the same).
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  classifyRecordOf,
  compileClassify,
  isPending,
  withData,
  CLASSIFY_METADATA_KEY,
  type ClassifyRecord,
} from "../classify/compile";
import { classifyFieldProblems, isFeatureData, type ClassifyFieldProblem } from "../classify/breaks";
import { DataFetcher } from "../data/data-fetcher";
import { classifiedHighlightProperty, withHighlight } from "./highlight-paint";

/** A renderer layer (loosely: the v1 layer shape, after `toModel`). */
interface RuntimeLayer {
  id: string;
  type: string;
  source?: unknown;
  paint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  interactive?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Features in a GeoJSON value (a Feature counts as one). */
function featureCount(data: unknown): number {
  if (!isObject(data)) return 0;
  if (data["type"] === "Feature") return 1;
  return Array.isArray(data["features"]) ? data["features"].length : 0;
}

/** One plain-language line for a {@link ClassifyFieldProblem} (an author hint). */
export function classifyFieldMessage(layerId: string, problem: ClassifyFieldProblem): string {
  const where = `Layer \`${layerId}\`: classify ${problem.key}: "${problem.name}"`;
  const props =
    problem.available.length > 0
      ? ` The data's properties: ${problem.available.map((n) => `"${n}"`).join(", ")}.`
      : "";
  if (problem.unread) {
    return (
      `${where} is a column of the file, but columns: leaves it out, so it wasn't read and every ` +
      "feature is drawn as no data. Add it to columns:."
    );
  }
  if (problem.reason === "missing") {
    return (
      `${where} is not a property of any feature, so every feature is drawn as no data.` +
      (problem.suggestion ? ` Did you mean "${problem.suggestion}"?` : "") +
      props
    );
  }
  const sample =
    typeof problem.sample === "string" || typeof problem.sample === "number" || typeof problem.sample === "boolean"
      ? ` (for example "${String(problem.sample)}")`
      : "";
  return (
    `${where} holds no numbers${sample}, so numeric classes draw every feature as no data.` +
    (problem.key === "field"
      ? " Classify a numeric property, or list its values with categories:."
      : " normalize: needs a numeric property to divide by.") +
    props
  );
}

/** How the runtime learns that a source is read by view, and reports it. */
export interface ClassifyByView {
  /**
   * Whether a source holds only the features in view (a FlatGeobuf or
   * GeoParquet source read by view: LayerManager.readsByView).
   */
  readsByView: (sourceId: string) => boolean;
  /**
   * A computed-break layer over such a source: its classes can't be
   * computed. Called once per layer, with a plain-language error.
   */
  onRefused: (layerId: string, sourceId: string, error: Error) => void;
  /**
   * The loaded data has no usable value for a layer's `field:` (or
   * `normalize:`): a misspelt or wrong-case name, or text under numeric
   * classes (ml-aot.95). Called once per layer, with an author hint.
   */
  onFieldProblem?: (layerId: string, message: string) => void;
}

/** The notice for a computed-break layer over a source read by view. */
export function byViewClassifyError(layerId: string, sourceId: string): Error {
  return new Error(
    `Layer \`${layerId}\` can't compute its classes: source \`${sourceId}\` is read by view ` +
      "(only the features in view are loaded — load: viewport, or a FlatGeobuf or GeoParquet file too large " +
      "to load whole), and computed classes need the whole file. Write the class thresholds " +
      "yourself with breaks:, for example breaks: [10, 25, 50]."
  );
}

/** Live classify state for one renderer. */
export class ClassifyRuntime {
  /** The record each layer was compiled with — always recompute from it. */
  private readonly templates = new Map<string, ClassifyRecord>();
  private readonly layers = new Map<string, RuntimeLayer>();
  /** Layers already reported as unable to compute (one notice each). */
  private readonly refused = new Set<string>();
  /** Layers whose field was already checked against loaded data. */
  private readonly diagnosed = new Set<string>();
  /** Layers classified from data with features at least once. */
  private readonly classified = new Set<string>();
  private destroyed = false;

  /**
   * @param getSourceData - The GeoJSON the layer pipeline last delivered to
   *   a source id (LayerManager.getSourceData).
   * @param byView - Sources read by view: never computed from (see above).
   */
  constructor(
    private readonly map: MapLibreMap,
    layers: readonly RuntimeLayer[],
    private sources: Record<string, unknown> | undefined,
    private readonly getSourceData: (sourceId: string) => unknown,
    private readonly onChange: (layerId: string, record: ClassifyRecord) => void,
    private readonly byView?: ClassifyByView
  ) {
    for (const layer of layers) {
      const record = classifyRecordOf(layer);
      if (!record) continue;
      this.templates.set(layer.id, record);
      this.layers.set(layer.id, layer);
    }
  }

  /**
   * Re-seed from the next document (live documents, U4): `layerIds` get
   * their template and layer object from `layers` afresh — a changed
   * `classify:` block, or a layer rebuilt by an update — and are checked
   * and computed again; layers the document no longer classifies are
   * forgotten. Other layers keep their objects, so computed breaks stand.
   */
  reseed(layers: readonly RuntimeLayer[], sources: Record<string, unknown> | undefined, layerIds: readonly string[]): void {
    this.sources = sources;
    const next = new Map(layers.map((layer) => [layer.id, layer]));
    for (const id of [...this.layers.keys()]) {
      if (!next.has(id) || !classifyRecordOf(next.get(id)!)) this.forget(id);
    }
    for (const id of layerIds) {
      const layer = next.get(id);
      const record = layer ? classifyRecordOf(layer) : undefined;
      if (!layer || !record) continue;
      this.forget(id);
      this.templates.set(id, record);
      this.layers.set(id, layer);
    }
  }

  private forget(id: string): void {
    this.templates.delete(id);
    this.layers.delete(id);
    this.refused.delete(id);
    this.diagnosed.delete(id);
    this.classified.delete(id);
  }

  /** Whether any layer is classified. */
  get active(): boolean {
    return this.templates.size > 0;
  }

  /** Every classified layer's current record (for the legend and listeners). */
  records(): Array<[string, ClassifyRecord]> {
    const out: Array<[string, ClassifyRecord]> = [];
    for (const [id, layer] of this.layers) {
      const record = classifyRecordOf(layer);
      if (record) out.push([id, record]);
    }
    return out;
  }

  /** The source id a layer's data is delivered under. */
  private sourceIdOf(layer: RuntimeLayer): string {
    return typeof layer.source === "string" ? layer.source : `${layer.id}-source`;
  }

  /**
   * Data arrived for `id` — a layer id (inline source) or a source id (a
   * named source's fetch, refresh, stream or decode): recompute every
   * classified layer drawing from it.
   */
  dataLoaded(id: string): void {
    if (this.destroyed) return;
    for (const layer of this.layers.values()) {
      if (layer.id === id || this.sourceIdOf(layer) === id) this.compute(layer);
    }
  }

  /**
   * Every layer is on the map: compute what data that landed early left
   * pending, and fetch `data:` URL strings MapLibre loads by itself.
   */
  async layersReady(fetcher: DataFetcher = new DataFetcher()): Promise<void> {
    for (const layer of this.layers.values()) {
      const record = classifyRecordOf(layer);
      if (record && isPending(record)) {
        this.compute(layer);
      } else {
        // Inline data never passes through a delivery: check its field here
        // (the pipeline's copy, else the document's own `data:` object).
        const sourceId = this.sourceIdOf(layer);
        if (this.byView?.readsByView(sourceId)) continue;
        const delivered = this.getSourceData(sourceId);
        const data = featureCount(delivered) > 0 ? delivered : this.inlineDataOf(layer);
        if (isFeatureData(data)) this.diagnose(layer, data);
      }
    }
    await this.loadUrlData(fetcher);
  }

  /**
   * Once per layer: report a field the loaded data has no value for. Only
   * data with features counts as checked: a named source holds an empty
   * placeholder until its fetch lands, and latching on that would skip the
   * real data (ml-aot.105).
   */
  private diagnose(layer: RuntimeLayer, data: unknown): void {
    const template = this.templates.get(layer.id);
    if (!template || this.diagnosed.has(layer.id) || !this.byView?.onFieldProblem) return;
    if (featureCount(data) === 0) return;
    this.diagnosed.add(layer.id);
    for (const problem of classifyFieldProblems(data, template)) {
      this.byView.onFieldProblem(layer.id, classifyFieldMessage(layer.id, problem));
    }
  }

  private compute(layer: RuntimeLayer): void {
    const template = this.templates.get(layer.id);
    if (!template) return;
    const sourceId = this.sourceIdOf(layer);
    if (this.byView?.readsByView(sourceId)) {
      // Only the part in view: never classify from it. A computed-break
      // layer stays on its no-data colour, with one notice.
      if (isPending(template) && !this.refused.has(layer.id)) {
        this.refused.add(layer.id);
        // Back to the template's paint (the no-data colour) if anything was
        // drawn from earlier data.
        const current = classifyRecordOf(layer);
        if (current && !isPending(current)) this.apply(layer, template);
        this.byView.onRefused(layer.id, sourceId, byViewClassifyError(layer.id, sourceId));
      }
      return;
    }
    const data = this.getSourceData(sourceId);
    if (!isFeatureData(data)) return;
    // A source's first data can be the empty placeholder it holds until its
    // read lands (a named url:, a FlatGeobuf still opening): classes computed
    // from nothing would be one flat palette colour (ml-aot.106), and stats
    // from nothing would empty the legend. Wait for features; once a layer
    // has been classified, an empty refresh is real and recomputes.
    if (featureCount(data) === 0 && !this.classified.has(layer.id)) return;
    this.diagnose(layer, data);
    this.classified.add(layer.id);
    this.apply(layer, withData(template, data));
  }

  /**
   * Fetch the data of pending layers whose `data:` is a URL string — MapLibre
   * fetches those itself, so they never pass through the layer pipeline.
   */
  private async loadUrlData(fetcher: DataFetcher): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [layerId, template] of this.templates) {
      const layer = this.layers.get(layerId)!;
      const current = classifyRecordOf(layer);
      if (!current || !isPending(current)) continue;
      const url = this.dataUrlOf(layer);
      if (!url) continue;
      jobs.push(
        fetcher
          .fetch(url)
          .then((result) => {
            if (this.destroyed || !isFeatureData(result.data)) return;
            this.diagnose(layer, result.data);
            this.apply(layer, withData(template, result.data));
          })
          .catch((error: unknown) => {
            console.warn(
              `[maplibre-yaml] classify on layer "${layerId}" could not load ${url} to compute ` +
                "its breaks:",
              error
            );
          })
      );
    }
    await Promise.all(jobs);
  }

  /** A layer's inline GeoJSON `data:` object (its own source, or the named one). */
  private inlineDataOf(layer: RuntimeLayer): unknown {
    let spec: unknown = layer.source;
    if (typeof spec === "string") spec = this.sources?.[spec];
    if (!isObject(spec)) return undefined;
    const data = spec["data"] ?? spec["prefetchedData"];
    return isFeatureData(data) ? data : undefined;
  }

  /** A layer's `data:` URL string, when its source is GeoJSON given that way. */
  private dataUrlOf(layer: RuntimeLayer): string | undefined {
    let spec: unknown = layer.source;
    if (typeof spec === "string") spec = this.sources?.[spec];
    if (!isObject(spec) || spec["type"] !== "geojson") return undefined;
    if (spec["url"] !== undefined) return undefined; // the layer pipeline delivers it
    return typeof spec["data"] === "string" ? spec["data"] : undefined;
  }

  private apply(layer: RuntimeLayer, record: ClassifyRecord): void {
    const compiled = compileClassify(record);
    // The renderer's layer object is what a not-yet-added layer is built
    // from, and what the legend reads.
    layer.paint = { ...(layer.paint ?? {}), ...compiled.paint };
    layer.metadata = { ...(layer.metadata ?? {}), [CLASSIFY_METADATA_KEY]: record };
    if (this.map.getLayer(layer.id)) {
      // hover.highlight wraps the classified colour (layer-manager does the
      // same when it adds the layer from `layer.paint`, kept unwrapped).
      const highlighted = classifiedHighlightProperty(layer);
      for (const [property, value] of Object.entries(compiled.paint)) {
        (this.map.setPaintProperty as (id: string, name: string, value: unknown) => void).call(
          this.map,
          layer.id,
          property,
          property === highlighted ? withHighlight(value) : value
        );
      }
    }
    this.onChange(layer.id, record);
  }

  destroy(): void {
    this.destroyed = true;
  }
}
