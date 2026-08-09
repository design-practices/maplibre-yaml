/**
 * @file Project the model's style half into a spec-valid style.json
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * The eject guarantee, implemented: everything under the model's style half
 * contributes to `style.json`, and nothing under its runtime half does.
 *
 * **This is a projection, not a strip.** The requirement reads from the
 * author's side — "`runtime:` is dropped" — but the implementation inverts it
 * and copies only what it recognizes. That inversion is what makes emit
 * fail-closed structurally rather than by a post-check: you cannot leak a key
 * you never copied. It also means the projection never recurses into an opaque
 * data payload, so a GeoJSON feature whose properties happen to include
 * `runtime` or `x-notes` survives untouched — those are author data, not
 * document structure.
 *
 * **No schema walk.** An earlier design had this reusing a visitor extracted
 * from the validator's schema-guided descent. That turned out unnecessary: the
 * validator walks the schema because it needs to know which keys the schema
 * *names*, whereas the model already carries the split — `layer.spec` and
 * `source.spec` are the partitioned result. Rediscovering the boundary here
 * would be a second implementation of it, and two implementations of one
 * boundary is how they drift.
 */

import type { MapModel, LayerModel } from "../model/types";

/** How unrepresentable content is handled. */
export type EmitMode = "strict" | "with-fallbacks";

/**
 * Why a piece of the document is not in the emitted style.
 *
 * @remarks
 * The distinction decides what `--strict` does. Dropping `runtime:` content is
 * the *contract* — it is what emit means, and erroring on it would reject
 * essentially every real document, including the reference one in this repo's
 * own plan. A `lossy` warning is different: something the author asked for
 * could not be represented, and its absence changes what the map shows.
 */
export type EmitWarningKind = "contract" | "lossy";

export interface EmitWarning {
  /** Dotted path into the emitted style, where one applies. */
  path: string;
  message: string;
  kind: EmitWarningKind;
}

/** Where a document layer wants to sit, by id. */
export interface LayerPlacement {
  id: string;
  /** Layer id this one is inserted ahead of; may name a basemap layer. */
  before?: string;
}

export interface EmitResult {
  style: Record<string, unknown>;
  warnings: EmitWarning[];
  /**
   * Placement intent for the document's own layers.
   *
   * @remarks
   * Carried alongside the style rather than resolved into it, because `before`
   * may name a layer the basemap supplies — which does not exist until the
   * merge step. Ordering therefore resolves once, at whichever point the whole
   * layer list is known: here when there is no basemap, at the merge otherwise.
   */
  placements: LayerPlacement[];
}

export class EmitError extends Error {
  readonly warnings: EmitWarning[];
  constructor(message: string, warnings: EmitWarning[] = []) {
    super(message);
    this.name = "EmitError";
    this.warnings = warnings;
  }
}

/** Keys that must never appear in emitted output, checked as an invariant. */
const FORBIDDEN_PREFIXES = ["x-"] as const;
const FORBIDDEN_KEYS = ["runtime"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Apply the layer transforms the style spec requires.
 *
 * @remarks
 * Three model keys contribute to `style.json` by transformation rather than by
 * passthrough, which is why R1 is a *contribution* claim and not an identity
 * one. `visible` becomes `layout.visibility`; `before` is consumed as ordering
 * (handled by the caller, which needs the whole layer list); `$ref` was already
 * resolved at parse.
 */
function transformLayer(layer: LayerModel): Record<string, unknown> {
  const spec = { ...layer.spec };

  if ("visible" in spec) {
    const visible = spec["visible"];
    delete spec["visible"];
    if (visible === false) {
      const layout = isPlainObject(spec["layout"]) ? { ...spec["layout"] } : {};
      layout["visibility"] = "none";
      spec["layout"] = layout;
    }
  }

  return spec;
}

/**
 * Order layers, honoring `before`.
 *
 * @remarks
 * `before` names the layer this one is inserted ahead of — it is MapLibre's
 * second `addLayer` argument at runtime, and there is no style-spec equivalent,
 * so at compile time it can only be expressed as array position. A `before`
 * naming a layer that does not exist in the document is not an error here: the
 * basemap merge may supply it, so resolution is the merge step's problem and
 * an unresolved one simply leaves the layer in place.
 */
function orderLayers(
  layers: { id: string; spec: Record<string, unknown>; before?: string }[]
): Record<string, unknown>[] {
  const ordered: { id: string; spec: Record<string, unknown> }[] = [];
  const deferred: typeof layers = [];

  for (const layer of layers) {
    if (layer.before === undefined) {
      ordered.push(layer);
      continue;
    }
    const index = ordered.findIndex((l) => l.id === layer.before);
    if (index === -1) deferred.push(layer);
    else ordered.splice(index, 0, layer);
  }

  // A `before` naming a later layer resolves on this pass.
  for (const layer of deferred) {
    const index = ordered.findIndex((l) => l.id === layer.before);
    if (index === -1) ordered.push(layer);
    else ordered.splice(index, 0, layer);
  }

  return ordered.map((l) => l.spec);
}

/**
 * Strip extension namespaces from schema-known structure.
 *
 * @remarks
 * `x-*` keys ride passthrough — the schema admits them so a host can carry its
 * own data — and the emitter's job (R5) is to remove them, the same recursive
 * rule that drops `runtime:`. Descent stops at author payloads (`data`,
 * `properties`), because an `x-` *property name* inside a GeoJSON feature is the
 * author's data, not an extension block. This returns a cleaned copy rather
 * than mutating, so the model the caller holds is untouched.
 */
function stripExtensions(node: unknown, opaque: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => stripExtensions(item, opaque));
  if (!isPlainObject(node)) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = opaque.has(key) ? value : stripExtensions(value, opaque);
  }
  return out;
}

/**
 * Assert no runtime or extension key survived into the output.
 *
 * @remarks
 * Under an allowlist projection this should be unreachable, which is exactly
 * why it is worth checking: it is an invariant on the projection itself, not a
 * cleanup pass. Emit fails closed rather than shipping a style carrying a key
 * that was supposed to be erased.
 *
 * Descent stops at `sources.*.data` and at any GeoJSON `properties`, because
 * those are author data. A feature property named `runtime` is not a leak.
 */
function assertClean(node: unknown, path: string, opaque: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertClean(item, `${path}[${i}]`, opaque));
    return;
  }
  if (!isPlainObject(node)) return;

  for (const key of Object.keys(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.includes(key as (typeof FORBIDDEN_KEYS)[number])) {
      throw new EmitError(
        `Emit produced a style containing a \`${key}\` key at ${childPath}. ` +
          "This is a projection bug: the style half should never carry one."
      );
    }
    if (FORBIDDEN_PREFIXES.some((p) => key.startsWith(p))) {
      throw new EmitError(
        `Emit produced a style containing the extension key "${key}" at ${childPath}. ` +
          "Extension namespaces are stripped on emit."
      );
    }
    if (opaque.has(key)) continue;
    assertClean(node[key], childPath, opaque);
  }
}

/**
 * Project a model into a MapLibre style object.
 *
 * @param model - the normalized document
 * @param mode - `strict` errors on content that cannot be represented;
 *   `with-fallbacks` degrades it and warns
 *
 * @remarks
 * The basemap is not merged here — that is a separate step with a network
 * dependency, and keeping it out means this function is pure and total.
 */
export function projectStyle(
  model: MapModel,
  mode: EmitMode = "with-fallbacks"
): EmitResult {
  const warnings: EmitWarning[] = [];
  const sources: Record<string, unknown> = {};

  for (const [name, source] of Object.entries(model.style.sources)) {
    sources[name] = isPlainObject(source.spec) ? { ...source.spec } : source.spec;
    if (Object.keys(source.runtime).length > 0) {
      const hasData = isPlainObject(source.spec) && "data" in source.spec;
      warnings.push({
        path: `sources.${name}`,
        kind: hasData ? "contract" : "lossy",
        message: hasData
          ? `Live-data configuration (${Object.keys(source.runtime).join(", ")}) ` +
            "does not compile; the emitted source carries the data present at compile time."
          : `Live-data configuration (${Object.keys(source.runtime).join(", ")}) ` +
            "does not compile, and this source has no compile-time data — the " +
            "emitted style renders it empty.",
      });
    }
  }

  const positioned = model.style.layers.map((layer) => {
    const spec = transformLayer(layer);
    const id = String(spec["id"] ?? "");

    // The style spec has no inline-source concept: `layer.source` must name an
    // entry in `sources:`. An inline source is hoisted into a generated one.
    if (isPlainObject(spec["source"])) {
      const generated = `${id}-source`;
      sources[generated] = spec["source"];
      spec["source"] = generated;
    }

    if (Object.keys(layer.runtime).length > 0) {
      const dropped = Object.keys(layer.runtime).filter((k) => k !== "before");
      if (dropped.length > 0) {
        warnings.push({
          path: `layers.${id}`,
          kind: "contract",
          message: `${dropped.join(", ")} do not compile and are absent from the emitted style.`,
        });
      }
    }

    const before = layer.runtime["before"];
    return {
      id,
      spec,
      ...(typeof before === "string" ? { before } : {}),
    };
  });

  const style: Record<string, unknown> = {
    version: 8,
    ...model.style.camera,
    sources,
    layers: orderLayers(positioned),
  };
  const placements: LayerPlacement[] = positioned.map((l) => ({
    id: l.id,
    ...(l.before !== undefined ? { before: l.before } : {}),
  }));

  if (model.style.state !== undefined) style["state"] = model.style.state;
  // `style.metadata` (v2 style-root slot, ml-tay) compiles through to the
  // style.json root `metadata` — the spec carries it, so it is not dropped.
  if (model.style.metadata !== undefined)
    style["metadata"] = model.style.metadata;

  const runtimeKeys = Object.keys(model.runtime.map);
  if (runtimeKeys.length > 0) {
    warnings.push({
      path: "runtime.map",
      kind: "contract",
      message:
        `Map options (${runtimeKeys.join(", ")}) are constructor-only and have no ` +
        "style-spec equivalent; the emitted style uses MapLibre's defaults.",
    });
  }

  // `--strict` means no *lossy* degradation was required, not "the document
  // declares no runtime content". The literal second reading would reject
  // essentially every document ever written in this format, which would make
  // the flag useless rather than strict.
  const lossy = warnings.filter((w) => w.kind === "lossy");
  if (mode === "strict" && lossy.length > 0) {
    throw new EmitError(
      `Emit failed in strict mode: ${lossy.length} item(s) could not be represented ` +
        "without changing what the map shows.",
      warnings
    );
  }

  const opaque = new Set(["data", "properties", "clusterProperties", "metadata"]);
  const cleaned = stripExtensions(style, opaque) as Record<string, unknown>;
  // The invariant, now over the stripped output: `x-*` is gone by the strip
  // above, so anything assertClean still finds — a `runtime` key — is a real
  // projection bug and fails closed rather than shipping.
  assertClean(cleaned, "", opaque);

  return { style: cleaned, warnings, placements };
}
