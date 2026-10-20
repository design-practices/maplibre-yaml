/**
 * @file The basemap value: a style URL, an inline style, or a Protomaps
 * basemap built from a `.pmtiles` file (0.9, ml-cnv.7)
 * @module @maplibre-yaml/core/schemas/basemap
 *
 * @description
 * `config.mapStyle` (v1) and `style.basemap` (v2) take one of three things,
 * told apart by shape alone:
 *
 * | Value | Meaning |
 * | --- | --- |
 * | a string | a style URL (`https://…/style.json`, or a path) |
 * | an object with `version`, `sources` or `layers` | an inline MapLibre style |
 * | any other object | the Protomaps basemap shorthand: `{ pmtiles, flavor?, lang?, glyphs?, sprite? }` |
 *
 * Every MapLibre style has `version`, `sources` and `layers`; the shorthand
 * has none of them, so the two can never be confused. An object with style
 * keys AND `pmtiles:` is refused rather than guessed at.
 *
 * The shorthand is a full basemap with no API key: the style is generated in
 * the page from `@protomaps/basemaps` (loaded on demand) and reads the
 * `.pmtiles` file directly, from the site itself or from any server that
 * supports HTTP range requests.
 *
 * ```yaml
 * mapStyle:
 *   pmtiles: data/nyc.pmtiles   # or https://…/x.pmtiles, or pmtiles://…
 *   flavor: dark                # light (default), dark, white, grayscale, black
 *   lang: es                    # label language (default: the page's, else en)
 * ```
 */

import { z } from "zod";
import { suggest } from "../utils/suggest";

/** The named Protomaps flavors (`@protomaps/basemaps` `namedFlavor`). */
export const PROTOMAPS_FLAVORS = ["light", "dark", "white", "grayscale", "black"] as const;

/** A named Protomaps flavor. */
export type ProtomapsFlavor = (typeof PROTOMAPS_FLAVORS)[number];

/**
 * The label languages a Protomaps basemap has (`@protomaps/basemaps`
 * `language_script_pairs`; a unit test keeps the two in step).
 */
export const PROTOMAPS_LANGUAGES = [
  "ar", "cs", "bg", "da", "de", "el", "en", "es", "et", "fa", "fi", "fr", "ga", "he", "hi",
  "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "ne", "nl", "no", "mr", "mt", "pl", "pt",
  "ro", "ru", "sk", "sl", "sv", "tr", "uk", "ur", "vi", "zh-Hans", "zh-Hant",
] as const;

/** The shorthand's keys, in the order messages list them. */
export const PROTOMAPS_BASEMAP_KEYS = ["pmtiles", "flavor", "lang", "glyphs", "sprite"] as const;

/** The Protomaps basemap shorthand, as written. */
export interface ProtomapsBasemap {
  /** The `.pmtiles` file: a path (relative to the page, `base` applied), a URL, or `pmtiles://…`. */
  pmtiles: string;
  /** Color scheme. Default `light`. */
  flavor?: ProtomapsFlavor;
  /** Label language. Default: the page's language when the basemap has it, else `en`. */
  lang?: string;
  /** Glyph URL template (`…/{fontstack}/{range}.pbf`). Default: Protomaps' hosted fonts. */
  glyphs?: string;
  /** Sprite URL (no extension). Default: Protomaps' hosted sprite for the flavor. */
  sprite?: string;
}

/** Keys only a MapLibre style object has. */
const STYLE_KEYS = ["version", "sources", "layers"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is an inline MapLibre style object (by its own keys). */
export function isInlineStyle(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && STYLE_KEYS.some((key) => key in value);
}

/**
 * Whether a basemap value is the Protomaps shorthand (an object that is not
 * a style object). Says nothing about validity; the schema does that.
 */
export function isProtomapsBasemap(value: unknown): value is ProtomapsBasemap {
  return isPlainObject(value) && !isInlineStyle(value);
}

/** A `.pmtiles` path or URL (query/fragment ignored), or a `pmtiles://` URL. */
export function isPmtilesReference(value: string): boolean {
  if (/^pmtiles:\/\/./i.test(value)) return true;
  return /\.pmtiles$/i.test(value.replace(/[?#].*$/, ""));
}

/**
 * The checks the shorthand gets, as zod issues relative to the value. Shared
 * by the schema refinement below and by anything that validates a value
 * outside a document.
 */
function checkShorthand(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const allowed: readonly string[] = PROTOMAPS_BASEMAP_KEYS;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key) && !key.startsWith("x-"));
  const pmtilesTypo = !("pmtiles" in value) && unknown.some((key) => suggest(key, ["pmtiles"]) === "pmtiles");

  if (!("pmtiles" in value) || value["pmtiles"] === undefined) {
    // A misspelled `pmtiles:` is reported once, as the unknown key below.
    if (!pmtilesTypo) {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_type,
        expected: "string",
        received: "undefined",
        path: ["pmtiles"],
        message: "Required",
      });
    }
  } else if (typeof value["pmtiles"] !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.invalid_type,
      expected: "string",
      received: Array.isArray(value["pmtiles"]) ? "array" : (typeof value["pmtiles"] as z.ZodParsedType),
      path: ["pmtiles"],
    });
  } else if (!isPmtilesReference(value["pmtiles"])) {
    const file = value["pmtiles"];
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pmtiles"],
      message:
        `pmtiles: "${file}" is not a PMTiles file. Give the path or URL of a .pmtiles ` +
        "file (for example data/basemap.pmtiles), or a pmtiles:// URL." +
        (/\.mbtiles$/i.test(file.replace(/[?#].*$/, ""))
          ? " An .mbtiles file converts with `pmtiles convert in.mbtiles out.pmtiles`."
          : " A style URL is written in place of the whole block instead (mapStyle: https://…/style.json)."),
    });
  }

  for (const key of unknown) {
    const hint = suggest(key, PROTOMAPS_BASEMAP_KEYS);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message:
        `Unknown key "${key}" in the Protomaps basemap` +
        (hint ? ` — did you mean "${hint}"?` : ".") +
        ` It takes ${PROTOMAPS_BASEMAP_KEYS.map((k) => `${k}:`).join(", ")}` +
        " (a MapLibre style object needs version:, sources: and layers:).",
    });
  }

  const flavor = value["flavor"];
  if (flavor !== undefined && !(PROTOMAPS_FLAVORS as readonly unknown[]).includes(flavor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.invalid_enum_value,
      options: [...PROTOMAPS_FLAVORS],
      received: flavor as string,
      path: ["flavor"],
    });
  }
  const lang = value["lang"];
  if (lang !== undefined && !(PROTOMAPS_LANGUAGES as readonly unknown[]).includes(lang)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lang"], message: unknownLanguageMessage(lang) });
  }
  for (const key of ["glyphs", "sprite"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key}: expected a URL string.`,
      });
    }
  }
}

/**
 * The label language a `lang:` value most likely meant: the same code in
 * another case (`AR`, `zh-hans`), or a language tag's language (`es-MX` →
 * `es`, `zh-TW` → `zh-Hant`, `nb` → `no`) — never a code that is merely a
 * letter away: between two-letter codes that is noise ("xx" is not "ar").
 */
export function closestBasemapLanguage(value: string): string | undefined {
  const known: readonly string[] = PROTOMAPS_LANGUAGES;
  const tag = value.trim().replace(/_/g, "-").toLowerCase();
  const same = known.find((code) => code.toLowerCase() === tag);
  if (same) return same;
  if (tag === "zh" || tag.startsWith("zh-")) return /^zh-(hant|tw|hk|mo)\b/.test(tag) ? "zh-Hant" : "zh-Hans";
  const primary = tag.split("-")[0]!;
  const mapped = primary === "nb" || primary === "nn" ? "no" : primary;
  return known.includes(mapped) ? mapped : undefined;
}

/** The message for a `lang:` the basemap has no labels in. */
function unknownLanguageMessage(value: unknown): string {
  const close = typeof value === "string" ? closestBasemapLanguage(value) : undefined;
  return (
    `lang: ${JSON.stringify(value)} isn't a label language of the Protomaps basemap` +
    (close ? ` — did you mean "${close}"?` : ".") +
    ` It has ${PROTOMAPS_LANGUAGES.join(", ")}. Without lang:, labels follow the page's language when the basemap has it.`
  );
}

/**
 * The shorthand alone, for editors (JSON Schema) and documentation. Runtime
 * validation goes through {@link MapStyleSchema}, whose refinement gives the
 * plain-language messages.
 */
export const ProtomapsBasemapSchema = z
  .object({
    pmtiles: z
      .string()
      .describe("The .pmtiles file: a path (relative to the page), a URL, or pmtiles://…"),
    flavor: z.enum(PROTOMAPS_FLAVORS).optional().describe("Color scheme (default light)"),
    lang: z
      .enum(PROTOMAPS_LANGUAGES)
      .optional()
      .describe("Label language (default: the page's language when the basemap has it, else en)"),
    glyphs: z
      .string()
      .optional()
      .describe("Glyph URL template ({fontstack}/{range}.pbf). Default: Protomaps' hosted fonts"),
    sprite: z.string().optional().describe("Sprite URL. Default: Protomaps' hosted sprite for the flavor"),
  })
  // Unknown keys are kept, so the refinement below can name them (a
  // stripping object would drop `flavour:` silently).
  .passthrough()
  .describe("A Protomaps basemap built from a .pmtiles file (no API key)");

/**
 * `config.mapStyle` / `style.basemap`: a style URL, an inline style object,
 * or the Protomaps basemap shorthand (see the file header for how they are
 * told apart).
 */
export const MapStyleSchema = z
  .union([z.string().url(), ProtomapsBasemapSchema, z.any()])
  .superRefine((value, ctx) => {
    if (isInlineStyle(value)) {
      if ("pmtiles" in value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "This basemap has both MapLibre style keys (version:, sources:, layers:) and pmtiles:. " +
            "Use a style object, or the Protomaps basemap shorthand (pmtiles:, flavor:, lang:), not both.",
        });
      }
      return;
    }
    if (isProtomapsBasemap(value)) checkShorthand(value as unknown as Record<string, unknown>, ctx);
  });
