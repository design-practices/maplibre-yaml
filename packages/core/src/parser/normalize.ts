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
}

const isObject = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

/** Flattened locale table → each key's authored segments below the table. */
const origins = new WeakMap<object, Map<string, string[]>>();

/** The authored segments of a `locale` key: `["Popup", "Close"]` for a nested `Popup: {Close}`. */
export function localeOrigin(table: unknown, key: string): string[] {
  return (isObject(table) && origins.get(table)?.get(key)) || [key];
}

/**
 * A copy with every date object turned into text: a `Date` gives ISO 8601,
 * and a date-like value gives its own `toJSON()` string (a TOML local date
 * from an Astro collection stays `2024-01-02`).
 */
export function normalizeDates(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(normalizeDates);
  const toJSON = (v as { toJSON?: unknown }).toJSON;
  const text = typeof toJSON === "function" ? toJSON.call(v) : undefined;
  if (typeof text === "string") return text;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  // fromEntries defines own properties, so a `__proto__` key stays data.
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDates(x)]));
}

/**
 * Drop a root `$schema` key and flatten nested `locale` tables (v1
 * `config.locale`, v2 `runtime.map.locale`), in place on a freshly
 * materialized document.
 */
export function normalizeDocument(value: unknown, pos?: Positions): Normalized {
  const found: Normalized = { errors: [], warnings: [] };
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
      } else if (segs.length && typeof v !== "string") {
        const got = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        found.errors.push({ path: path(key), code: "schema", message: `The locale entry "${key}" must be a string, got ${got}.`, ...where(s, true) });
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
