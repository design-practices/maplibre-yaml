/**
 * @file Value normalizations every document goes through before validation,
 * whatever format it was written in (KTD6): a root `$schema` key is dropped,
 * nested tables under a `locale:` flatten to dotted keys, and date objects
 * that arrive as values become text.
 */

import type { Document, LineCounter } from "yaml";
import { positionForKey, positionForPath, type ValidationWarning } from "./validation-utils";
import type { ParseError, ParseResult } from "./yaml-parser";

type Rec = Record<string, unknown>;
type Path = (string | number)[];
interface Positions {
  doc: Document;
  lineCounter: LineCounter;
}
/** What {@link normalizeDocument} found: its errors fail the document. */
export interface Normalized {
  errors: ParseError[];
  warnings: ValidationWarning[];
  /** Each error's path as segments, in the same order as `errors`. */
  segments: Path[];
}

const isObject = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

/** Flattened locale table → each key's authored segments below the table. */
const origins = new WeakMap<object, Map<string, string[]>>();

/** The authored segments of a `locale` key: `["Popup", "Close"]` for a nested `Popup: {Close}`. */
export function localeOrigin(table: unknown, key: string): string[] {
  return (isObject(table) && origins.get(table)?.get(key)) || [key];
}

/**
 * The value with every date object turned into text: a `Date` gives ISO
 * 8601, and a date-like value gives its own `toJSON()` string (a TOML local
 * date from an Astro collection stays `2024-01-02`).
 *
 * The input is never changed. An array or plain object with no date in it
 * comes back as is (the same reference), so a large GeoJSON with no dates is
 * not copied; one holding a date is copied along the path to it, and its
 * untouched siblings keep their identity.
 */
export function normalizeDates(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    let out: unknown[] | undefined;
    for (let i = 0; i < v.length; i++) {
      const x = normalizeDates(v[i]);
      if (x !== v[i]) (out ??= v.slice())[i] = x;
    }
    return out ?? v;
  }
  const toJSON = (v as { toJSON?: unknown }).toJSON;
  const text = typeof toJSON === "function" ? toJSON.call(v) : undefined;
  if (typeof text === "string") return text;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const obj = v as Rec;
  const keys = Object.keys(obj);
  let out: Array<[string, unknown]> | undefined;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    // An own `__proto__` key shadows the accessor, so this reads the data.
    const x = obj[k];
    const y = normalizeDates(x);
    if (y !== x && !out) out = keys.slice(0, i).map((p) => [p, obj[p]]);
    out?.push([k, y]);
  }
  // fromEntries defines own properties, so a `__proto__` key stays data.
  return out ? Object.fromEntries(out) : v;
}

/** A shallow copy of a plain object (a `__proto__` key stays data), or the value as is. */
const shallow = (v: unknown): unknown => (isObject(v) ? Object.fromEntries(Object.entries(v)) : v);

/**
 * Drop a root `$schema` key and flatten nested `locale` tables (v1
 * `config.locale`, v2 `runtime.map.locale`), in place on a freshly
 * materialized document.
 */
export function normalizeDocument(value: unknown, pos?: Positions): Normalized {
  const found: Normalized = { errors: [], warnings: [], segments: [] };
  if (!isObject(value)) return found;
  delete value["$schema"];
  for (const path of [["config"], ["runtime", "map"]]) {
    let parent: unknown = value;
    for (const k of path) parent = isObject(parent) ? parent[k] : undefined;
    // A flat table (every table before 0.10) is left exactly as written.
    if (isObject(parent) && isObject(parent.locale) && Object.values(parent.locale).some(isObject)) {
      parent.locale = flattenLocale(parent.locale, [...path, "locale"], found, pos);
    }
  }
  return found;
}

/** A value that is already parsed, normalized the way core normalizes a document. */
export interface NormalizedValue {
  /** A copy: dates as text, no root `$schema`, nested `locale` tables flattened. */
  value: unknown;
  /** Problems that fail the document, each with its path as segments. */
  issues: { path: Path; message: string }[];
  warnings: ValidationWarning[];
}

/**
 * Normalize a parsed value (an Astro collection entry, a value a host built)
 * the way core normalizes every document before validation. The input is not
 * changed.
 */
export function normalizeDocumentValue(input: unknown): NormalizedValue {
  // normalizeDates keeps what it does not change, so copy what
  // normalizeDocument rewrites in place: the root and the tables on the way
  // to each `locale`.
  const value = shallow(normalizeDates(input));
  if (isObject(value)) {
    if (isObject(value.config)) value.config = shallow(value.config);
    if (isObject(value.runtime)) {
      const runtime = (value.runtime = shallow(value.runtime) as Rec);
      if (isObject(runtime.map)) runtime.map = shallow(runtime.map);
    }
  }
  const found = normalizeDocument(value);
  return {
    value,
    issues: found.errors.map((e, i) => ({ path: found.segments[i] ?? [], message: e.message })),
    warnings: found.warnings,
  };
}

/** Throwing entry points: normalize, and throw the first problem. */
export function normalizeOrThrow(value: unknown): void {
  const [error] = normalizeDocument(value).errors;
  if (error) throw new Error(`${error.path}: ${error.message}`);
}

/** `result` with the normalization findings folded in. */
export function withNormalized<T>(result: ParseResult<T>, found: Normalized): ParseResult<T> {
  if (!found.errors.length && !found.warnings.length) return result;
  const warnings = [...result.warnings, ...found.warnings];
  return found.errors.length
    ? { success: false, errors: [...found.errors, ...result.errors], warnings }
    : { ...result, warnings };
}

/** `"Popup.Close"` for one dotted key, `Popup.Close (nested)` for a nested table. */
const spell = (s: string[]) =>
  s.length > 1 ? `${s.map((k) => (k.includes(".") ? `"${k}"` : k)).join(".")} (nested)` : `"${s[0]}"`;

function flattenLocale(table: Rec, at: Path, found: Normalized, pos?: Positions): Rec {
  const flat = new Map<string, unknown>();
  const from = new Map<string, string[]>();
  // A key's position (or its value's), at the authored spelling.
  const where = (s: string[], value?: boolean) => {
    const p = pos && (value
      ? positionForPath(pos.doc, pos.lineCounter, [...at, ...s])
      : positionForKey(pos.doc, pos.lineCounter, [...at, ...s.slice(0, -1)], s[s.length - 1]!));
    return p ? { line: p.line, column: p.column } : {};
  };
  const path = (key: string) => `${at.join(".")}."${key}"`;
  const walk = (obj: Rec, segs: string[]) => {
    const keys = Object.keys(obj);
    if (segs.length && !keys.length) {
      const key = segs.join(".");
      found.warnings.push({ path: path(key), message: `The locale table "${key}" is empty, so it translates nothing.`, ...where(segs) });
    }
    for (const k of keys) {
      const v = obj[k];
      const s = [...segs, k];
      const key = s.join(".");
      if (isObject(v)) {
        walk(v, s);
        continue;
      }
      const first = from.get(key);
      if (first) {
        found.errors.push({
          path: path(key),
          code: "schema",
          message: `The locale key "${key}" is written twice, as ${spell(first)} and as ${spell(s)}. Keep one.`,
          ...where(s),
        });
        found.segments.push([...at, key]);
      } else if (segs.length && typeof v !== "string") {
        const got = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        found.errors.push({ path: path(key), code: "schema", message: `The locale entry "${key}" must be a string, got ${got}.`, ...where(s, true) });
        found.segments.push([...at, key]);
      } else {
        flat.set(key, v);
        from.set(key, s);
      }
    }
  };
  walk(table, []);
  const out = Object.fromEntries(flat);
  origins.set(out, from);
  return out;
}
