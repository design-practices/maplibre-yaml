/**
 * @file Validation ergonomics utilities for the YAML parser
 * @module @maplibre-yaml/core/parser/validation-utils
 *
 * @description
 * Shared helpers that make validation errors and warnings actionable:
 *
 * - **Line/column mapping**: turn a Zod issue `path` (or an unknown key) into a
 *   source `{ line, column }` using the `yaml` document node ranges + a
 *   `LineCounter`.
 * - **Did-you-mean suggestions**: a small hand-rolled Levenshtein (no new
 *   dependency) powers nearest-match hints for unknown layer/source types,
 *   typo'd object keys, and unknown expression operators.
 * - **Warn-first strict checking**: {@link collectWarnings} walks a parsed value
 *   in parallel with its Zod schema and emits {@link ValidationWarning}s for
 *   unknown keys (with `x-*` always exempt), deprecated legacy refresh fields,
 *   and bounded expression-operator mistakes — without turning any of them into
 *   hard validation errors.
 */

import { z } from "zod";
import type { Document, LineCounter } from "yaml";
import { isMap } from "yaml";
import { ExpressionSchema } from "../schemas/base.schema";

/**
 * A non-fatal validation finding surfaced alongside errors.
 *
 * @property path - Dotted JSON path to the offending value (e.g. `pages.0.blocks.0.layers.0.paint.circle-radis`)
 * @property message - Human-readable description
 * @property line - 1-based source line, when it can be resolved
 * @property column - 1-based source column, when it can be resolved
 * @property suggestion - Nearest valid alternative, when one is close enough
 */
export interface ValidationWarning {
  path: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

/** Valid MapLibre layer `type` values, in the order surfaced to users. */
export const LAYER_TYPES = [
  "circle",
  "line",
  "fill",
  "symbol",
  "raster",
  "fill-extrusion",
  "heatmap",
  "hillshade",
  "background",
] as const;

/** Valid source `type` values, in the order surfaced to users. */
export const SOURCE_TYPES = [
  "geojson",
  "vector",
  "raster",
  "image",
  "video",
] as const;

/** Valid top-level block `type` values for the block dispatcher. */
export const BLOCK_TYPES = ["map", "scrollytelling"] as const;

/**
 * Known MapLibre expression operators.
 *
 * @remarks
 * Bounded on purpose — full expression type-checking is MapLibre's job. This
 * list only powers first-element (operator) validation with did-you-mean.
 * @see {@link https://maplibre.org/maplibre-style-spec/expressions/}
 */
export const EXPRESSION_OPERATORS = new Set<string>([
  // Types
  "array", "boolean", "collator", "format", "image", "literal", "number",
  "number-format", "object", "string", "to-boolean", "to-color", "to-number",
  "to-string", "typeof",
  // Feature data
  "accumulated", "feature-state", "geometry-type", "id", "line-progress",
  "properties",
  // Lookup
  "at", "get", "has", "in", "index-of", "length", "slice",
  // Decision
  "!", "!=", "<", "<=", "==", ">", ">=", "all", "any", "case", "coalesce",
  "match", "within",
  // Ramps, scales, curves
  "interpolate", "interpolate-hcl", "interpolate-lab", "step",
  // Variable binding
  "let", "var",
  // String
  "concat", "downcase", "is-supported-script", "resolved-locale", "upcase",
  // Color
  "rgb", "rgba", "to-rgba",
  // Math
  "-", "*", "/", "%", "^", "+", "abs", "acos", "asin", "atan", "ceil", "cos",
  "distance", "e", "floor", "ln", "ln2", "log10", "log2", "max", "min", "pi",
  "round", "sin", "sqrt", "tan",
  // Zoom / heatmap
  "zoom", "heatmap-density",
]);

/**
 * Operators that are legitimately used with zero operands.
 *
 * @remarks
 * Any other *known* operator invoked as a one-element array (just the operator,
 * no operands) is flagged as a probable arity-zero mistake.
 */
export const ZERO_ARG_OPERATORS = new Set<string>([
  "zoom", "pi", "e", "ln2", "geometry-type", "id", "properties", "accumulated",
  "heatmap-density", "line-progress", "resolved-locale",
]);

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * @remarks
 * Small hand-rolled implementation (iterative two-row DP) so we do not take on a
 * dependency just for did-you-mean hints.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Return the closest candidate to `input` within `maxDistance` edits, or
 * `undefined` when nothing is close enough.
 */
export function suggest(
  input: string,
  candidates: Iterable<string>,
  maxDistance = 2
): string | undefined {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === input) continue;
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

/**
 * Build the canonical "unknown type" message for a layer or source.
 *
 * @remarks
 * These strings are product surface and are snapshot-tested; keep changes
 * intentional.
 */
export function unknownTypeMessage(
  kind: "layer" | "source",
  received: unknown,
  validTypes: readonly string[]
): string {
  const value =
    typeof received === "string" ? received : JSON.stringify(received);
  const hint =
    typeof received === "string"
      ? suggest(received, validTypes as string[])
      : undefined;
  return (
    `Unknown ${kind} type "${value}". ` +
    `Valid types: ${validTypes.join(", ")}.` +
    (hint ? ` Did you mean "${hint}"?` : "")
  );
}

/**
 * Read the value at a JSON path from an already-parsed value (tolerant of
 * missing intermediate nodes).
 */
export function valueAtPath(
  root: unknown,
  path: (string | number)[]
): unknown {
  let current: any = root;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Classify a discriminated-union option list as the layer or source vocabulary.
 */
export function typeKindForOptions(
  options: unknown[]
): "layer" | "source" | "other" {
  const set = new Set(options.map((o) => String(o)));
  if (
    set.size === LAYER_TYPES.length &&
    LAYER_TYPES.every((t) => set.has(t))
  ) {
    return "layer";
  }
  if (
    set.size === SOURCE_TYPES.length &&
    SOURCE_TYPES.every((t) => set.has(t))
  ) {
    return "source";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Position mapping
// ---------------------------------------------------------------------------

/** A resolved 1-based source position. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * Resolve the source position of the value at `path`.
 *
 * @remarks
 * Falls back to progressively shorter parent paths when the exact node is
 * missing (e.g. Zod errors that report a *missing* key point at a node that
 * does not exist — we then anchor on the containing node).
 */
export function positionForPath(
  doc: Document,
  lineCounter: LineCounter,
  path: (string | number)[]
): SourcePosition | undefined {
  let current = [...path];
  while (current.length > 0) {
    const node: any = doc.getIn(current, true);
    if (node && Array.isArray(node.range)) {
      const { line, col } = lineCounter.linePos(node.range[0]);
      return { line, column: col };
    }
    current = current.slice(0, -1);
  }
  // Fall back to the document root (e.g. a missing top-level key).
  const root: any = doc.contents;
  if (root && Array.isArray(root.range)) {
    const { line, col } = lineCounter.linePos(root.range[0]);
    return { line, column: col };
  }
  return undefined;
}

/**
 * Resolve the source position of the *key* `key` inside the object at
 * `objectPath` (points at the key token itself, not its value).
 */
export function positionForKey(
  doc: Document,
  lineCounter: LineCounter,
  objectPath: (string | number)[],
  key: string
): SourcePosition | undefined {
  const parent: any =
    objectPath.length === 0 ? doc.contents : doc.getIn(objectPath, true);
  if (isMap(parent)) {
    const pair = parent.items.find((p: any) => {
      const k = p.key;
      const kv = k && typeof k === "object" && "value" in k ? k.value : k;
      return kv === key;
    });
    if (pair && (pair as any).key && Array.isArray((pair as any).key.range)) {
      const { line, col } = lineCounter.linePos((pair as any).key.range[0]);
      return { line, column: col };
    }
  }
  return positionForPath(doc, lineCounter, [...objectPath, key]);
}

// ---------------------------------------------------------------------------
// Schema-aware warning collection
// ---------------------------------------------------------------------------

interface WalkContext {
  doc: Document;
  lineCounter: LineCounter;
  warnings: ValidationWarning[];
}

/**
 * Schemas whose unknown keys are intentional (open MapLibre passthrough) and
 * therefore must not produce unknown-key warnings.
 *
 * @remarks
 * The map `config` block passes arbitrary MapLibre `MapOptions` through by
 * design, so flagging unlisted-but-valid options there would be noise. Authored
 * styling objects (layers, paint, layout, sources, ...) are *not* in this set —
 * that is exactly where typo protection is wanted.
 */
const OPEN_SCHEMAS = new WeakSet<object>();

/** Register a schema as an intentional open-passthrough object. */
export function markOpenSchema(schema: z.ZodTypeAny): void {
  OPEN_SCHEMAS.add(schema as unknown as object);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

/** Peel Optional/Nullable/Default wrappers (but not Effects — see below). */
function peelOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: any = schema;
  while (s && s._def) {
    const t = s._def.typeName;
    if (
      t === "ZodOptional" ||
      t === "ZodNullable" ||
      t === "ZodDefault"
    ) {
      s = s._def.innerType;
      continue;
    }
    break;
  }
  return s;
}

/** Peel every transparent wrapper, including Effects and Lazy. */
function fullyUnwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: any = peelOptional(schema);
  while (s && s._def) {
    const t = s._def.typeName;
    if (t === "ZodEffects") {
      s = s._def.schema;
      s = peelOptional(s);
      continue;
    }
    if (t === "ZodLazy") {
      s = peelOptional(s._def.getter());
      continue;
    }
    break;
  }
  return s;
}

/** Whether a field schema (after peeling wrappers) is the shared expression schema. */
function isExpressionSchema(schema: z.ZodTypeAny): boolean {
  return peelOptional(schema) === (ExpressionSchema as unknown as z.ZodTypeAny);
}

/**
 * Walk a parsed value in parallel with its schema, collecting warnings.
 *
 * @param value - The parsed JS value (may be partially invalid; the walk is
 *   tolerant and simply stops descending where types disagree).
 * @param schema - The schema `value` was validated against.
 * @param doc - The parsed `yaml` document (for position mapping).
 * @param lineCounter - Line counter paired with `doc`.
 */
export function collectWarnings(
  value: unknown,
  schema: z.ZodTypeAny,
  doc: Document,
  lineCounter: LineCounter
): ValidationWarning[] {
  const ctx: WalkContext = { doc, lineCounter, warnings: [] };
  walk(value, schema, [], ctx);
  return ctx.warnings;
}

function walk(
  value: unknown,
  schema: z.ZodTypeAny,
  path: (string | number)[],
  ctx: WalkContext
): void {
  if (value == null || schema == null) return;

  // Expression operator checks live before unwrapping (identity match).
  if (isExpressionSchema(schema)) {
    if (Array.isArray(value)) checkExpression(value, path, ctx);
    return;
  }

  const s: any = fullyUnwrap(schema);
  if (!s || !s._def) return;
  const typeName: string = s._def.typeName;

  switch (typeName) {
    case "ZodObject": {
      if (!isPlainObject(value)) return;
      const shape = s._def.shape() as Record<string, z.ZodTypeAny>;
      const knownKeys = Object.keys(shape);
      const open = OPEN_SCHEMAS.has(s);

      // Deprecation: legacy top-level refresh fields on a GeoJSON source.
      if (value.type === "geojson") checkLegacyRefresh(value, path, ctx);

      for (const key of Object.keys(value)) {
        if (key.startsWith("x-")) continue; // extension escape hatch
        const fieldSchema = shape[key];
        if (fieldSchema) {
          walk(value[key], fieldSchema, [...path, key], ctx);
        } else if (!open) {
          const hint = suggest(key, knownKeys);
          const pos = positionForKey(ctx.doc, ctx.lineCounter, path, key);
          ctx.warnings.push({
            path: [...path, key].join("."),
            message:
              `Unknown key "${key}".` +
              (hint ? ` Did you mean "${hint}"?` : ""),
            ...(pos ? { line: pos.line, column: pos.column } : {}),
            ...(hint ? { suggestion: hint } : {}),
          });
        }
      }
      return;
    }

    case "ZodArray": {
      if (!Array.isArray(value)) return;
      const el = s._def.type as z.ZodTypeAny;
      value.forEach((v, i) => walk(v, el, [...path, i], ctx));
      return;
    }

    case "ZodTuple": {
      if (!Array.isArray(value)) return;
      const items = s._def.items as z.ZodTypeAny[];
      value.forEach((v, i) => {
        const itemSchema = items[i];
        if (itemSchema) walk(v, itemSchema, [...path, i], ctx);
      });
      return;
    }

    case "ZodRecord": {
      if (!isPlainObject(value)) return;
      const vt = s._def.valueType as z.ZodTypeAny;
      // Record keys are user-chosen names; only descend into the values.
      for (const key of Object.keys(value)) {
        walk(value[key], vt, [...path, key], ctx);
      }
      return;
    }

    case "ZodDiscriminatedUnion": {
      if (!isPlainObject(value)) return;
      const discriminator: string = s._def.discriminator;
      const optionsMap: Map<unknown, z.ZodTypeAny> | undefined =
        s._def.optionsMap;
      const option = optionsMap?.get(value[discriminator]);
      if (option) walk(value, option, path, ctx);
      return;
    }

    case "ZodUnion": {
      const options = s._def.options as z.ZodTypeAny[];
      for (const option of options) {
        if (option.safeParse(value).success) {
          walk(value, option, path, ctx);
          return;
        }
      }
      return;
    }

    default:
      // Leaf (string/number/boolean/enum/literal/any/unknown) — nothing to do.
      return;
  }
}

const LEGACY_REFRESH_FIELDS = [
  "refreshInterval",
  "updateStrategy",
  "updateKey",
] as const;

function checkLegacyRefresh(
  value: Record<string, unknown>,
  path: (string | number)[],
  ctx: WalkContext
): void {
  for (const field of LEGACY_REFRESH_FIELDS) {
    if (value[field] === undefined) continue;
    const pos = positionForKey(ctx.doc, ctx.lineCounter, path, field);
    ctx.warnings.push({
      path: [...path, field].join("."),
      message:
        `The top-level "${field}" field on a GeoJSON source is deprecated. ` +
        `Move it into a "refresh:" block (refresh.${field}).`,
      ...(pos ? { line: pos.line, column: pos.column } : {}),
      suggestion: "refresh",
    });
  }
}

function checkExpression(
  value: unknown[],
  path: (string | number)[],
  ctx: WalkContext
): void {
  if (value.length === 0) return; // empty arrays are already a hard error
  const operator = value[0];
  if (typeof operator !== "string") return;

  const pos = positionForPath(ctx.doc, ctx.lineCounter, path);

  if (!EXPRESSION_OPERATORS.has(operator)) {
    const hint = suggest(operator, EXPRESSION_OPERATORS);
    ctx.warnings.push({
      path: path.join("."),
      message:
        `Unknown expression operator "${operator}".` +
        (hint ? ` Did you mean "${hint}"?` : ""),
      ...(pos ? { line: pos.line, column: pos.column } : {}),
      ...(hint ? { suggestion: hint } : {}),
    });
    return;
  }

  if (value.length === 1 && !ZERO_ARG_OPERATORS.has(operator)) {
    ctx.warnings.push({
      path: path.join("."),
      message: `Expression operator "${operator}" expects at least one argument.`,
      ...(pos ? { line: pos.line, column: pos.column } : {}),
    });
  }
}
