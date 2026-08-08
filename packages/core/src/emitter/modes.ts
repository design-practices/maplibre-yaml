/**
 * @file Runtime-gated degradation of the emitted style
 * @module @maplibre-yaml/core/emitter
 *
 * @description
 * `state:` is the one thing in the erasable half whose compilation depends on
 * something outside the document: it is a style-spec root property, so it
 * compiles through verbatim — but only maplibre-gl 5.6.0 and later understand
 * it. Below that, emitting it produces a style that validates against the spec
 * and renders wrong, which is the worst of the available outcomes.
 *
 * So it degrades instead. Every `["global-state", "key"]` expression is
 * replaced with the key's literal default and the `state` root key is dropped.
 * The map loses the ability to *change* the value at runtime and keeps the
 * appearance it would have had at its default — which is what a compiled
 * artifact could offer anyway, since nothing is left to call
 * `setGlobalStateProperty`.
 *
 * Portability note worth carrying: as of style-spec 24.8.5, `state` and
 * `global-state` are supported on maplibre-gl JS only. Android and iOS are
 * still open issues, so a style emitted *with* `state` intact is not portable
 * to maplibre-native — an inlined one is.
 */

import type { CapabilityPolicy } from "../capabilities";
import { STATE_RUNTIME_FLOOR, supportsState } from "../capabilities";
import type { EmitResult, EmitWarning } from "./project";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `["global-state", "key"]` expression, if this node is one. */
function globalStateKey(node: unknown): string | null {
  if (!Array.isArray(node) || node.length < 2) return null;
  if (node[0] !== "global-state") return null;
  return typeof node[1] === "string" ? node[1] : null;
}

/**
 * Replace every `global-state` read with its default.
 *
 * @remarks
 * Returns the number of substitutions so the caller can say nothing happened
 * when nothing did — a document declaring `state:` it never reads should not
 * be reported as degraded.
 */
function inlineReads(
  node: unknown,
  defaults: Map<string, unknown>,
  missing: Set<string>
): { value: unknown; count: number } {
  const key = globalStateKey(node);
  if (key !== null) {
    if (!defaults.has(key)) {
      missing.add(key);
      return { value: node, count: 0 };
    }
    return { value: defaults.get(key), count: 1 };
  }

  if (Array.isArray(node)) {
    let count = 0;
    const value = node.map((item) => {
      const result = inlineReads(item, defaults, missing);
      count += result.count;
      return result.value;
    });
    return { value, count };
  }

  if (isPlainObject(node)) {
    let count = 0;
    const value: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      // `data` is author payload, not expression surface — a feature property
      // that happens to look like an expression is not one.
      if (k === "data" || k === "properties") {
        value[k] = v;
        continue;
      }
      const result = inlineReads(v, defaults, missing);
      count += result.count;
      value[k] = result.value;
    }
    return { value, count };
  }

  return { value: node, count: 0 };
}

/**
 * Compile `state:` away when the target runtime cannot carry it.
 *
 * @remarks
 * A no-op when the target meets the floor, or when the style declares no
 * `state` at all. The policy's `target` being undefined counts as *not* meeting
 * the floor — a caller who has not said which runtime they target has not made
 * a claim about it, and guessing generously ships a style that validates in CI
 * and renders blank in production.
 */
export function applyRuntimeGate(
  result: EmitResult,
  policy: CapabilityPolicy
): EmitResult {
  const state = result.style["state"];
  if (!isPlainObject(state) || Object.keys(state).length === 0) return result;
  if (supportsState(policy)) return result;

  // The spec's shape is `{ key: { default: value } }`.
  const defaults = new Map<string, unknown>();
  for (const [key, entry] of Object.entries(state)) {
    if (isPlainObject(entry) && "default" in entry) defaults.set(key, entry["default"]);
  }

  const missing = new Set<string>();
  const { value, count } = inlineReads(
    { ...result.style, state: undefined },
    defaults,
    missing
  );

  const style = { ...(value as Record<string, unknown>) };
  delete style["state"];

  const warnings: EmitWarning[] = [...result.warnings];
  warnings.push({
    path: "state",
    kind: "lossy",
    message:
      `\`state:\` needs maplibre-gl ${STATE_RUNTIME_FLOOR} or later` +
      (policy.target ? `; the target is ${policy.target}` : " and no target was declared") +
      `. ${count} expression read${count === 1 ? "" : "s"} inlined to the declared ` +
      "defaults and the `state` key dropped, so the map renders at its defaults " +
      "and cannot be changed at runtime.",
  });

  for (const key of missing) {
    warnings.push({
      path: "state",
      kind: "lossy",
      message:
        `\`global-state\` reads "${key}", which \`state:\` does not declare. ` +
        "The expression is left in place and will resolve to null.",
    });
  }

  return { ...result, style, warnings };
}
