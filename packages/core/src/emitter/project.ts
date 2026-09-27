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
import { ejectClasses } from "../eject";
import type { EjectClassDefinition } from "../eject";
import { LAYER_RUNTIME_KEYS, SOURCE_RUNTIME_KEYS } from "../model/normalize";

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
  /**
   * The registered construct this warning is about (`layer.interactive`,
   * `controls`, `x-*`), when the warning is registry-driven. Machine-readable
   * — consumers should key on this, not parse `message`.
   */
  construct?: string;
  /** The construct's declared eject class, when registry-driven. */
  ejectClass?: "ejects" | "fallback" | "declared-absence";
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
   * Generated raster-asset descriptors (marker pins, pattern tiles) the
   * style's sprite references. Core describes; the CLI rasterizes and writes
   * them beside the style (KTD3). Absent when the document generates none.
   */
  assets?: import("./assets").EmitAsset[];
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
function stripExtensions(
  node: unknown,
  opaque: Set<string>,
  path = "",
  stripped?: string[]
): unknown {
  if (Array.isArray(node))
    return node.map((item, i) => stripExtensions(item, opaque, `${path}[${i}]`, stripped));
  if (!isPlainObject(node)) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_PREFIXES.some((p) => key.startsWith(p))) {
      stripped?.push(path ? `${path}.${key}` : key);
      continue;
    }
    const childPath = path ? `${path}.${key}` : key;
    out[key] = opaque.has(key) ? value : stripExtensions(value, opaque, childPath, stripped);
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
 * dependency, and keeping it out means this function is pure. It is total
 * over every parseable document: author-side unknown runtime keys warn, never
 * throw. The two deliberate throw paths are invariants on the projection
 * itself — `--strict` with lossy degradation (EmitError, by design) and a
 * runtime construct from core's own closed key lists missing its eject-class
 * registration (EmitError, a code bug the closed world refuses to ship).
 */
/**
 * The registry lookup for a construct core's own closed key boundary
 * produced. A miss here is a code bug (a runtime key added without an eject
 * class), surfaced as an EmitError like the projection's other invariants.
 * Never call this with an author-supplied key — passthrough unknowns get the
 * generic warning in the loops below, not a throw (a schema-valid document
 * must never crash emit).
 */
function requireEjectClass(construct: string): EjectClassDefinition {
  try {
    return ejectClasses.require(construct);
  } catch (error) {
    throw new EmitError((error as Error).message);
  }
}

/**
 * Keys zod materializes onto every document via schema defaults. The author
 * never wrote them, so a declared-absence warning would attribute noise to
 * them; suppressed exactly at the default value (an explicit non-default is
 * an authored choice and reports normally).
 */
function isSchemaDefault(
  scope: "layer" | "source" | "map",
  key: string,
  value: unknown
): boolean {
  if (scope === "layer" && key === "toggleable" && value === true) return true;
  if (scope === "source" && key === "fetchStrategy" && value === "runtime") return true;
  if (scope === "map" && key === "interactive" && value === true) return true;
  return false;
}

/** One registry-driven live-data warning per source runtime key. */
function pushSourceRuntimeWarnings(
  warnings: EmitWarning[],
  basePath: string,
  runtime: Record<string, unknown>,
  hasData: boolean
): void {
  for (const key of Object.keys(runtime)) {
    if (isSchemaDefault("source", key, runtime[key])) continue;
    if (!(SOURCE_RUNTIME_KEYS as readonly string[]).includes(key)) {
      // A passthrough unknown (v2 runtime blocks accept forward-compat keys):
      // warn generically, never throw — the pre-doctrine posture for
      // author-side unknowns.
      warnings.push({
        path: `${basePath}.${key}`,
        kind: "contract",
        message: `\`${key}\` is not a recognized runtime construct and is absent from the emitted style.`,
      });
      continue;
    }
    const definition = requireEjectClass(`source.${key}`);
    warnings.push({
      path: `${basePath}.${key}`,
      kind: hasData ? "contract" : "lossy",
      construct: `source.${key}`,
      ejectClass: definition.class,
      message:
        `\`${key}\` — ${definition.onEmit}` +
        (hasData
          ? ""
          : " This source has no compile-time data — the emitted style renders it empty."),
    });
  }
}

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
      pushSourceRuntimeWarnings(warnings, `sources.${name}`, source.runtime, hasData);
    }
  }

  const positioned = model.style.layers.map((layer) => {
    const spec = transformLayer(layer);
    const id = String(spec["id"] ?? "");

    // Captured before the hoist below replaces the inline object with a
    // generated source name — the contract/lossy split needs it.
    const inlineHasData = isPlainObject(spec["source"]) && "data" in spec["source"];

    // The style spec has no inline-source concept: `layer.source` must name an
    // entry in `sources:`. An inline source is hoisted into a generated one.
    if (isPlainObject(spec["source"])) {
      const generated = `${id}-source`;
      sources[generated] = spec["source"];
      spec["source"] = generated;
    }

    if (Object.keys(layer.runtime).length > 0) {
      // Registry-driven declared absences (R6): one warning per construct,
      // wording and class from its registration, so the report and the
      // construct list cannot drift. `before` ejects (honored via ordering
      // below); `source` holds an inline source's own runtime half, reported
      // at source granularity with the same contract/lossy split as named
      // sources. A key outside the closed lists (v2 runtime blocks are
      // passthrough) warns generically — a schema-valid document never
      // crashes emit.
      for (const key of Object.keys(layer.runtime)) {
        if (key === "before") continue;
        if (key === "source") {
          const sourceRuntime = layer.runtime["source"];
          if (isPlainObject(sourceRuntime)) {
            pushSourceRuntimeWarnings(
              warnings,
              `layers.${id}.source`,
              sourceRuntime,
              inlineHasData
            );
          }
          continue;
        }
        if (isSchemaDefault("layer", key, layer.runtime[key])) continue;
        if (!(LAYER_RUNTIME_KEYS as readonly string[]).includes(key)) {
          warnings.push({
            path: `layers.${id}.${key}`,
            kind: "contract",
            message: `\`${key}\` is not a recognized runtime construct and is absent from the emitted style.`,
          });
          continue;
        }
        const definition = requireEjectClass(`layer.${key}`);
        warnings.push({
          path: `layers.${id}.${key}`,
          kind: "contract",
          construct: `layer.${key}`,
          ejectClass: definition.class,
          message: `\`${key}\` — ${definition.onEmit}`,
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

  const runtimeKeys = Object.keys(model.runtime.map).filter(
    (key) => !isSchemaDefault("map", key, model.runtime.map[key])
  );
  if (runtimeKeys.length > 0) {
    const definition = requireEjectClass("map.options");
    warnings.push({
      path: "runtime.map",
      kind: "contract",
      construct: "map.options",
      ejectClass: definition.class,
      message: `Map options (${runtimeKeys.join(", ")}) — ${definition.onEmit}`,
    });
  }

  // Root chrome constructs previously vanished from emit with no trace at
  // all — the exact silent omission the doctrine forbids (R5/R6). Iterating
  // the model's own keys (not a hand-kept list) means a future RuntimeHalf
  // field cannot silently opt out: registered fields report with their
  // wording, and an unknown one still surfaces generically.
  for (const [construct, value] of Object.entries(model.runtime)) {
    if (construct === "map" || value === undefined) continue;
    const definition = ejectClasses.get(construct);
    if (definition) {
      warnings.push({
        path: construct,
        kind: "contract",
        construct,
        ejectClass: definition.class,
        message: `\`${construct}\` — ${definition.onEmit}`,
      });
    } else {
      warnings.push({
        path: construct,
        kind: "contract",
        message: `\`${construct}\` is not a recognized runtime construct and is absent from the emitted style.`,
      });
    }
  }

  // Extension strips are collected BEFORE the strict gate so a strict
  // failure's EmitError.warnings still carries them — the failure report
  // must be the complete report. One warning per stripped location.
  const opaque = new Set(["data", "properties", "clusterProperties", "metadata"]);
  const strippedExtensions: string[] = [];
  const cleaned = stripExtensions(style, opaque, "", strippedExtensions) as Record<
    string,
    unknown
  >;
  if (strippedExtensions.length > 0) {
    const definition = requireEjectClass("x-*");
    for (const strippedPath of strippedExtensions) {
      warnings.push({
        path: strippedPath,
        kind: "contract",
        construct: "x-*",
        ejectClass: definition.class,
        message: `\`${strippedPath.split(".").pop()}\` — ${definition.onEmit}`,
      });
    }
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
  // The invariant, now over the stripped output: `x-*` is gone by the strip
  // above, so anything assertClean still finds — a `runtime` key — is a real
  // projection bug and fails closed rather than shipping.
  assertClean(cleaned, "", opaque);

  return { style: cleaned, warnings, placements };
}
