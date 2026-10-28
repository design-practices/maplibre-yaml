/**
 * @file Core's value normalizations for content-collection entries (0.10)
 * @module @maplibre-yaml/astro/utils/collection-normalize
 *
 * @description
 * Every document core reads -- a file, `<Map src>`, `loadMapConfig` -- goes
 * through core's value normalizations before validation: a root `$schema`
 * key is dropped, nested tables under a `locale` flatten to dotted keys, and
 * date objects become text. A content collection hands its schema the entry
 * Astro parsed instead, so {@link getMapSchema} and
 * {@link getScrollytellingSchema} would reject what `loadMapConfig` accepts:
 * a TOML entry's `[config.locale.NavigationControl]` table, a TOML date
 * (smol-toml's `TomlDate`) or a YAML date (a `Date`) in the entry.
 *
 * Core does not export its normalizer (`parser/normalize.ts`), so this
 * mirrors it, rule for rule and message for message; a test pins the two
 * to the same results. Once core exports it, call that instead.
 *
 * @internal
 */

import type { CoreSchemaLike } from "./zod-bridge";

type Rec = Record<string, unknown>;

/** A problem with the entry, at its path, as a schema issue. */
interface NormalizeIssue {
  path: (string | number)[];
  message: string;
}

const isObject = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A copy with every date object turned into text: a `Date` gives ISO 8601,
 * and a date-like value gives its own `toJSON()` string (a TOML local date
 * from smol-toml stays `2024-01-02`). Core's `normalizeDates`.
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

/** `"Popup.Close"` for one dotted key, `Popup.Close (nested)` for a nested table. */
const spell = (s: string[]) =>
  s.length > 1 ? `${s.map((k) => (k.includes(".") ? `"${k}"` : k)).join(".")} (nested)` : `"${s[0]}"`;

/** Flatten one `locale` table; core's `flattenLocale`, without positions or warnings. */
function flattenLocale(table: Rec, at: string[], issues: NormalizeIssue[]): Rec {
  const flat = new Map<string, unknown>();
  const from = new Map<string, string[]>();
  const walk = (obj: Rec, segs: string[]) => {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const s = [...segs, k];
      const key = s.join(".");
      if (isObject(v)) {
        walk(v, s);
        continue;
      }
      const first = from.get(key);
      if (first) {
        issues.push({
          path: [...at, key],
          message: `The locale key "${key}" is written twice, as ${spell(first)} and as ${spell(s)}. Keep one.`,
        });
      } else if (segs.length && typeof v !== "string") {
        const got = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        issues.push({ path: [...at, key], message: `The locale entry "${key}" must be a string, got ${got}.` });
      } else {
        flat.set(key, v);
        from.set(key, s);
      }
    }
  };
  walk(table, []);
  return Object.fromEntries(flat);
}

/**
 * A normalized copy of a map or story entry: dates as text, no root
 * `$schema`, nested `locale` tables (v1 `config.locale`, v2
 * `runtime.map.locale`) flattened. The entry itself is not changed.
 */
export function normalizeEntry(entry: unknown): { value: unknown } | { issues: NormalizeIssue[] } {
  const value = normalizeDates(entry);
  if (!isObject(value)) return { value };
  delete value["$schema"];
  const issues: NormalizeIssue[] = [];
  for (const path of [["config"], ["runtime", "map"]]) {
    let parent: unknown = value;
    for (const k of path) parent = isObject(parent) ? parent[k] : undefined;
    // A flat table (every table before 0.10) is left exactly as written.
    if (isObject(parent) && isObject(parent.locale) && Object.values(parent.locale).some(isObject)) {
      parent.locale = flattenLocale(parent.locale, [...path, "locale"], issues);
    }
  }
  return issues.length > 0 ? { issues } : { value };
}

/** A core schema that normalizes an entry the way core does a document, first. */
export function withEntryNormalized<T>(core: CoreSchemaLike<T>): CoreSchemaLike<T> {
  return {
    safeParse(value: unknown) {
      const normalized = normalizeEntry(value);
      if ("issues" in normalized) {
        return { success: false, error: { issues: normalized.issues } };
      }
      return core.safeParse(normalized.value);
    },
  };
}
