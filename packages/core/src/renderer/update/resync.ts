/**
 * @file Live documents: runtime feature re-sync and the camera (0.10, ml-4ug, U4)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * After the layer and source operations applied, every runtime feature the
 * renderer builds on top of the map — controls, legend, params panel,
 * markers, popups, classify, title and description, images, effects, the
 * 3D and projection blocks — is brought in line with the next document,
 * each only when its own inputs changed (KTD6b), and the camera follows
 * ownership (KTD13). The engine decides *whether* and in what order; the
 * renderer's {@link RuntimeHost} supplies *how*, since most features need
 * its private state or a value import this chunk must not make (KTD10).
 *
 * Every step is guarded the way an operation is (KTD7): a throw becomes a
 * `summary.failures` record and a non-fatal `onError` report, and the rest
 * of the re-sync goes on.
 *
 * Type-only imports: this module ships in the engine's lazy chunk.
 */

import type { Layer } from "../../schemas/layer.schema";
import type { MapErrorContext } from "../map-renderer";
import type { AppliedDocument, CameraValues, OptionKey, OptionSetOp, UpdateHost, UpdateOp, UpdateRequest, UpdateSummary } from "./types";

type Obj = Record<string, unknown>;

/** `CLASSIFY_METADATA_KEY` in classify/compile.ts — a literal here, since the chunk imports no values. */
const CLASSIFY_KEY = "maplibre-yaml:classify";

/** The camera animation for a changed camera key: short enough to read as the edit landing, not a tour. */
const CAMERA_EASE_MS = 300;

const SCENE_OPTIONS = ["projection", "sky", "terrain", "light"] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function asObject(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
}

/** The `optionSet` operations by option key. */
function optionSets(ops: readonly UpdateOp[]): Map<OptionKey, OptionSetOp> {
  const sets = new Map<OptionKey, OptionSetOp>();
  for (const op of ops) if (op.op === "optionSet") sets.set(op.option, op);
  return sets;
}

/**
 * Run one re-sync step; a throw is recorded and reported, never fatal
 * (KTD7). `op` names the step in the failure record.
 */
async function guard(
  host: UpdateHost,
  summary: UpdateSummary,
  op: string,
  run: () => void | Promise<void>,
  context?: MapErrorContext
): Promise<void> {
  try {
    await run();
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    summary.failures.push({ op, message: error.message });
    host.onError(error, context);
  }
}

/** What the legend reads from a layer (legend-builder.ts): its kind, labels, classes and colours. */
function legendInputOf(layer: Layer): unknown {
  const l = layer as Obj;
  const colours: Obj = {};
  for (const [key, value] of Object.entries(asObject(l["paint"]))) if (key.endsWith("-color")) colours[key] = value;
  return [layer.id, layer.type, l["label"], l["legend"], l["classify"], asObject(l["metadata"])[CLASSIFY_KEY], colours];
}

function legendInputs(doc: AppliedDocument): unknown {
  return [doc.options.legend, doc.layers.map(legendInputOf)];
}

/** What the params panel is built from: the metadata, the state keys and the labelled toggleable layers. */
function panelInputs(doc: AppliedDocument): unknown {
  const toggles = doc.layers
    .filter((layer) => typeof (layer as Obj)["label"] === "string" && (layer as Obj)["toggleable"] !== false)
    .map((layer) => [layer.id, (layer as Obj)["label"]]);
  return [doc.options.parameters, Object.keys(doc.options.state ?? {}).sort(), toggles];
}

/** The layers whose classify record changed, was added or came with a replaced layer. */
function classifyChanges(applied: AppliedDocument, next: AppliedDocument, summary: UpdateSummary): { ids: string[]; changed: boolean } {
  const recordOf = (layer: Layer | undefined) => (layer ? asObject((layer as Obj)["metadata"])[CLASSIFY_KEY] : undefined);
  const before = new Map(applied.layers.map((layer) => [layer.id, layer]));
  const structural = new Set([...summary.added, ...summary.replaced]);
  const ids: string[] = [];
  for (const layer of next.layers) {
    const record = recordOf(layer);
    if (record === undefined) continue;
    if (structural.has(layer.id) || !same(recordOf(before.get(layer.id)), record)) ids.push(layer.id);
  }
  const nextIds = new Set(next.layers.map((layer) => layer.id));
  const removedClassified = applied.layers.some((layer) => !nextIds.has(layer.id) && recordOf(layer) !== undefined);
  const droppedClassify = next.layers.some((layer) => recordOf(layer) === undefined && recordOf(before.get(layer.id)) !== undefined);
  return { ids, changed: ids.length > 0 || removedClassified || droppedClassify };
}

/** Images the next document references that the applied one did not, or defines differently. */
function newImages(applied: AppliedDocument, next: AppliedDocument): Obj {
  const before = asObject(applied.options.images);
  const added: Obj = {};
  for (const [name, image] of Object.entries(asObject(next.options.images))) {
    if (!same(before[name], image)) added[name] = image;
  }
  return added;
}

/** Whether an effect-bearing layer of the next document was replaced or moved (its `::fx-` layer must follow). */
function effectLayerMoved(next: AppliedDocument, summary: UpdateSummary): boolean {
  const touched = new Set([...summary.replaced, ...summary.moved]);
  return next.layers.some((layer) => touched.has(layer.id) && (layer as Obj)["effect"] !== undefined);
}

/**
 * Register the images the next document newly references, before the
 * layers that use them are placed — as first render loads `images:` before
 * `addLayer`, so an `icon-image` resolves on its first frame.
 */
export async function preloadImages(host: UpdateHost, request: UpdateRequest, summary: UpdateSummary): Promise<void> {
  const images = newImages(request.applied, request.next);
  if (Object.keys(images).length === 0) return;
  await guard(host, summary, "optionSet", () => host.runtime.loadImages(images as never));
}

/**
 * Bring every runtime feature in line with the next document (KTD6b), then
 * move the camera by ownership (KTD13). Called after `applyOps`.
 */
export async function resync(host: UpdateHost, request: UpdateRequest, ops: readonly UpdateOp[], summary: UpdateSummary): Promise<void> {
  const { applied, next } = request;
  const { runtime, map } = host;
  const sets = optionSets(ops);
  const changed = (key: OptionKey) => sets.has(key);

  // Controls: the whole block, so a removed control goes and order follows the document.
  if (changed("controls")) {
    await guard(host, summary, "optionSet", () => {
      host.controlsManager.removeAllControls();
      if (next.options.controls) host.controlsManager.addControls(next.options.controls);
    });
  }

  // Legend: the block, or any layer input it reads.
  if (!same(legendInputs(applied), legendInputs(next))) {
    await guard(host, summary, "optionSet", () => runtime.syncLegend(next.layers, next.options.legend));
  }

  // State defaults that changed or arrived, then the panel that shows them.
  if (changed("state")) {
    const before = asObject(applied.options.state);
    const keys = Object.entries(asObject(next.options.state))
      .filter(([key, value]) => !same(before[key], value))
      .map(([key]) => key);
    if (keys.length > 0) await guard(host, summary, "optionSet", () => runtime.syncState(next.options.state, keys));
  }
  if (!same(panelInputs(applied), panelInputs(next))) {
    await guard(host, summary, "optionSet", () => runtime.syncParamsPanel(next.layers, next.options));
  }

  if (changed("markers")) await guard(host, summary, "optionSet", () => runtime.syncMarkers(next.options.markers));
  if (changed("popups")) await guard(host, summary, "optionSet", () => runtime.syncPopups(next.options.popups));

  // Classify: re-seed the layers whose record changed, and catch up on data that landed meanwhile.
  const classify = classifyChanges(applied, next, summary);
  if (classify.changed) {
    await guard(host, summary, "layerSetProperty", () => runtime.syncClassify(next.layers, next.sources, classify.ids));
  }

  if (changed("title") || changed("description")) {
    await guard(host, summary, "optionSet", () => runtime.setTitle(next.options.title, next.options.description));
  }

  // Effects: a block added or removed, or an effect-bearing layer rebuilt or moved (KTD6b).
  if (changed("effects") || effectLayerMoved(next, summary)) {
    await guard(host, summary, "optionSet", () => host.reattachEffects());
  }

  // 3D, projection and light, through the feature-detecting helpers (one warning, never a failure).
  for (const option of SCENE_OPTIONS) {
    const op = sets.get(option);
    if (op) await guard(host, summary, "optionSet", () => runtime.applyScene(option, op.value));
  }

  // Map options with a setter (KTD7).
  const setter = map as unknown as Record<string, ((value: unknown) => unknown) | undefined>;
  for (const [option, name] of [["minZoom", "setMinZoom"], ["maxZoom", "setMaxZoom"], ["maxBounds", "setMaxBounds"]] as const) {
    const op = sets.get(option);
    const apply = setter[name];
    if (op && typeof apply === "function") await guard(host, summary, "optionSet", () => void apply.call(map, op.value ?? null));
  }

  // Camera (KTD13): the document's keys that changed, and a fitTo added or re-targeted; nothing under host ownership.
  if (host.camera === "host") {
    summary.cameraMoved = false;
    return;
  }
  for (const op of ops) {
    if (op.op === "cameraSet") {
      const camera: CameraValues & { duration: number } = { ...op.camera, duration: CAMERA_EASE_MS };
      await guard(host, summary, "cameraSet", () => void map.easeTo(camera as never));
    } else if (op.op === "fitTo") {
      await guard(host, summary, "fitTo", () => runtime.fitTo(op.fitTo, next.sources), { kind: "fit", sourceId: op.fitTo.source });
    }
  }
}
