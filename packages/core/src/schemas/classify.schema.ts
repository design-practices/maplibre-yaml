/**
 * @file The `classify:` layer key — thematic maps without hand-written expressions
 * @module @maplibre-yaml/core/schemas/classify
 *
 * @description
 * `classify:` sits on a layer beside `paint:` (v1 `layers[]`, v2
 * `style.layers[]`) and compiles to plain MapLibre — a `step` expression for
 * numeric classes, a `match` for categories, guarded so a missing or
 * non-numeric value draws the no-data colour instead of MapLibre's black
 * fallback. The compiled expression lands in `paint.<type>-color` (or the
 * colour property named by `property:`), so an exported style carries it and
 * a raw `step`/`match` keeps working everywhere beside it.
 *
 * Three forms, chosen by which key is present:
 * - `breaks: [10, 25]` — explicit `step` thresholds: n breaks, n + 1 classes,
 *   each break lower-inclusive (a value equal to 10 takes the second class).
 * - `method: quantile | equal | jenks` + `classes: N` — breaks computed from
 *   the data; GeoJSON sources only (the whole dataset is in hand).
 * - `categories:` — a `match` on category values, with an `other:` colour.
 *
 * This schema checks the block on its own; the checks that need the layer
 * around it (layer type, the target paint property, the source kind) live in
 * `classify/checks.ts`, which the parser runs after the schema.
 */

import { z } from "zod";
import { ColorSchema } from "./base.schema";
import { colorProblem } from "./css-colors";
import {
  findPalette,
  paletteColors,
  paletteSizes,
  suggestPalette,
} from "../classify/palettes";
import { CLASSIFY_METHODS, type ClassifyMethod } from "../classify/breaks";
import { suggest } from "../utils/suggest";
import { toIntlNumberFormatOptions, type NumberFormatOptions } from "../i18n/number-format";

/** Why `Intl` cannot format with these options (an unknown currency or unit, a bad locale), or null. */
function numberFormatProblem(options: NumberFormatOptions): string | null {
  try {
    new Intl.NumberFormat(options.locale, toIntlNumberFormatOptions(options));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Default class count for `method:` when `classes:` is omitted. */
export const DEFAULT_CLASS_COUNT = 5;
/** The most classes a computed method may ask for (ColorBrewer tops out at 9–12). */
export const MAX_CLASS_COUNT = 12;

/** The validated `classify:` block, as authored. */
export interface ClassifyConfig {
  /** The feature property to classify. */
  field: string;
  /** Divide `field` by this property: classify a rate, not a count. */
  normalize?: string;
  /** Multiply the rate (e.g. 100000 for "per 100,000"). Needs `normalize:`. */
  multiply?: number;
  /** Explicit `step` thresholds, strictly ascending. */
  breaks?: number[];
  /** Compute the breaks from the data (GeoJSON sources only). */
  method?: string;
  /** Class count for `method:` (default 5). */
  classes?: number;
  /** Categorical form: `{ value: colour }`, or a list of values coloured from the palette. */
  categories?: Record<string, string> | Array<string | number | boolean>;
  /** A palette name: ColorBrewer (`Blues`, `YlGnBu`, `RdBu`, `Set2` …), `viridis`, `cividis`, `okabe-ito`. */
  palette?: string;
  /** Explicit colours, one per class (or per category). */
  colors?: string[];
  /** Reverse the named palette (dark to light). */
  reverse?: boolean;
  /** The colour paint property to drive (default `<type>-color`). */
  property?: string;
  /** Graduated symbols: one `circle-radius` per class (circle layers). */
  radius?: number[];
  /** Missing / non-numeric values: a colour (default light grey) or `hide`. */
  noData?: string;
  /** Categories not listed: a colour (default grey) or `hide`. */
  other?: string;
  /** Legend number formatting, with MapLibre `number-format` option names. */
  format?: NumberFormatOptions;
}

/** A method name as written, normalised (`Quantile` → `quantile`), or undefined. */
export function normalizeMethod(method: string): ClassifyMethod | undefined {
  const m = method.trim().toLowerCase();
  return (CLASSIFY_METHODS as readonly string[]).includes(m) ? (m as ClassifyMethod) : undefined;
}

/** Names other tools use for the same methods, for the did-you-mean. */
const METHOD_ALIASES: Record<string, ClassifyMethod> = {
  "equal-interval": "equal",
  "equal_interval": "equal",
  "equal interval": "equal",
  "equalinterval": "equal",
  "quantiles": "quantile",
  "natural-breaks": "jenks",
  "natural breaks": "jenks",
  "natural_breaks": "jenks",
  "natural": "jenks",
  "ckmeans": "jenks",
};

function methodHint(method: string): string | undefined {
  const m = method.trim().toLowerCase();
  return METHOD_ALIASES[m] ?? suggest(m, CLASSIFY_METHODS, 3);
}

/** `noData:`/`other:` — the word `hide`, or a colour. */
const TreatmentSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (value.trim().toLowerCase() === "hide") return;
    const problem = colorProblem(value);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${problem} (Or write hide to leave these features off the map.)`,
      });
    }
  })
  .describe('A colour, or "hide" to leave these features off the map');

const NumberFormatSchema = z
  .object({
    locale: z.string().optional().describe("BCP 47 locale, e.g. en-US"),
    currency: z.string().optional().describe("ISO 4217 currency code, e.g. USD"),
    unit: z.string().optional().describe("A unit such as percent or kilometer"),
    "min-fraction-digits": z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Fewest digits after the decimal point"),
    "max-fraction-digits": z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Most digits after the decimal point (default: just enough to tell the breaks apart)"),
  })
  .superRefine((value, ctx) => {
    const problem = numberFormatProblem(value);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `This number format cannot be used: ${problem}`,
      });
    }
  })
  .describe("Legend number format (MapLibre number-format option names)");

/** Is `x` a plain object (not an array)? */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** How many classes a numeric block draws, when it is knowable from the block. */
export function declaredClassCount(config: ClassifyConfig): number | undefined {
  if (config.breaks) return config.breaks.length + 1;
  if (config.method !== undefined) return config.classes ?? DEFAULT_CLASS_COUNT;
  return undefined;
}

/** How many categories a categorical block lists. */
function categoryCount(config: ClassifyConfig): number {
  const c = config.categories;
  if (Array.isArray(c)) return c.length;
  if (isRecord(c)) return Object.keys(c).length;
  return 0;
}

/**
 * The `classify:` block.
 *
 * @remarks
 * Annotated (TS7056): the block rides on every layer type in the
 * `LayerSchema` union, and a stated type keeps the union's serialization a
 * reference rather than an expansion.
 */
export const ClassifySchema: z.ZodType<ClassifyConfig> = z
  .object({
    field: z
      .string()
      .min(1)
      .describe("The feature property to classify, e.g. median_income"),
    normalize: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Divide the field by this property to map a rate, not a count (cases ÷ population); a missing or zero divisor is no data"
      ),
    multiply: z
      .number()
      .optional()
      .describe('Multiply the rate, e.g. 100000 for "per 100,000" (with normalize:)'),
    breaks: z
      .array(z.number())
      .min(1)
      .optional()
      .describe(
        "Class thresholds, as MapLibre step: n breaks make n + 1 classes, and a value equal to a break takes the class above it"
      ),
    method: z
      .string()
      .optional()
      .describe("Compute breaks from the data: quantile, equal, or jenks (GeoJSON sources only)"),
    classes: z
      .number()
      .int()
      .min(2)
      .max(MAX_CLASS_COUNT)
      .optional()
      .describe("How many classes method: computes (default 5)"),
    categories: z
      .union([
        z.record(ColorSchema),
        z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
      ])
      .optional()
      .describe(
        "Categorical classes: a map of value → colour, or a list of values coloured from palette:"
      ),
    palette: z
      .string()
      .optional()
      .describe(
        "A named palette: ColorBrewer (Blues, YlGnBu, RdBu, Set2 …), viridis, cividis, okabe-ito"
      ),
    colors: z
      .array(ColorSchema)
      .min(1)
      .optional()
      .describe("Explicit colours, one per class (or per category)"),
    reverse: z.boolean().optional().describe("Reverse the named palette"),
    property: z
      .string()
      .optional()
      .describe("The colour paint property to drive (default: the layer type's main colour)"),
    radius: z
      .array(z.number().min(0))
      .min(1)
      .optional()
      .describe("Graduated symbols: circle-radius for each class (circle layers)"),
    noData: TreatmentSchema.optional().describe(
      'Features with a missing or non-numeric value: a colour (default light grey) or "hide"'
    ),
    other: TreatmentSchema.optional().describe(
      'Categories that are not listed: a colour (default grey) or "hide"'
    ),
    format: NumberFormatSchema.optional(),
  })
  .superRefine((raw, ctx) => {
    const config = raw as ClassifyConfig;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const hasBreaks = config.breaks !== undefined;
    const hasMethod = config.method !== undefined;
    const hasCategories = config.categories !== undefined;

    const forms = [hasBreaks && "breaks:", hasMethod && "method:", hasCategories && "categories:"].filter(
      Boolean
    ) as string[];
    if (forms.length === 0) {
      issue(
        [],
        "classify needs one of breaks: (your own class thresholds), method: (quantile, equal or " +
          "jenks, computed from the data) or categories: (one colour per value)."
      );
      return;
    }
    if (forms.length > 1) {
      issue(
        [hasMethod ? "method" : "categories"],
        `classify takes one of ${forms.join(" or ")}, not both: breaks: are your own thresholds, ` +
          "method: computes them from the data, categories: colours each value."
      );
      return;
    }

    // breaks: strictly ascending (MapLibre step requires it).
    if (config.breaks) {
      for (let i = 1; i < config.breaks.length; i++) {
        if (!(config.breaks[i]! > config.breaks[i - 1]!)) {
          issue(
            ["breaks", i],
            `breaks must go up: ${config.breaks[i]} comes after ${config.breaks[i - 1]}. ` +
              "Each break starts a new class, so list them from lowest to highest, each once."
          );
          break;
        }
      }
    }

    let method: ClassifyMethod | undefined;
    if (config.method !== undefined) {
      method = normalizeMethod(config.method);
      if (!method) {
        const hint = methodHint(config.method);
        issue(
          ["method"],
          `Unknown classification method "${config.method}".` +
            (hint ? ` Did you mean "${hint}"?` : "") +
            " Use quantile (equal counts per class), equal (equal-width ranges) or jenks (natural breaks)."
        );
      }
    }
    if (config.classes !== undefined && !hasMethod) {
      issue(
        ["classes"],
        hasBreaks
          ? `classes: goes with method:. With breaks: the class count is the number of breaks + 1 (${
              config.breaks!.length + 1
            } here).`
          : "classes: goes with method:. Categories make one class per listed value."
      );
    }

    if (config.normalize !== undefined) {
      if (hasCategories) {
        issue(
          ["normalize"],
          "normalize: divides one number by another to map a rate, and categories: colour " +
            "values as they are. Remove normalize:, or classify a numeric field with breaks: or method:."
        );
      } else if (config.normalize === config.field) {
        issue(
          ["normalize"],
          `normalize: divides ${config.field} by another property (cases ÷ population); dividing it ` +
            "by itself is always 1."
        );
      }
    }
    if (config.multiply !== undefined) {
      if (config.normalize === undefined) {
        issue(
          ["multiply"],
          "multiply: scales the rate normalize: makes (multiply: 100000 for “per 100,000”). Add " +
            "normalize: <the property to divide by>."
        );
      } else if (!(config.multiply > 0) || !Number.isFinite(config.multiply)) {
        issue(["multiply"], "multiply: must be a positive number, e.g. 100 (percent) or 100000 (per 100,000).");
      }
    }

    if (hasCategories) {
      for (const key of ["radius"] as const) {
        if (config[key] !== undefined) {
          issue([key], "radius: sizes numeric classes; categories: take colours only.");
        }
      }
      // Duplicates after to-string never reach their colour (match labels must be unique).
      if (Array.isArray(config.categories)) {
        const seen = new Map<string, number>();
        config.categories.forEach((value, index) => {
          const label = String(value);
          if (seen.has(label)) {
            issue(["categories", index], `"${label}" is listed twice in categories:.`);
          } else if (label === "") {
            issue(["categories", index], 'An empty category "" is no data: style it with noData:.');
          } else {
            seen.set(label, index);
          }
        });
      } else if (isRecord(config.categories) && "" in config.categories) {
        issue(["categories"], 'An empty category "" is no data: style it with noData:.');
      }
      if (isRecord(config.categories) && (config.palette !== undefined || config.colors !== undefined)) {
        issue(
          [config.palette !== undefined ? "palette" : "colors"],
          "categories: already gives each value its colour. Use a list of values (categories: [a, b]) " +
            "to colour them from a palette: or colors: instead."
        );
      }
    } else if (config.other !== undefined) {
      issue(["other"], "other: colours categories that are not listed; it goes with categories:.");
    }

    if (config.palette !== undefined && config.colors !== undefined) {
      issue(["colors"], "Use palette: or colors:, not both.");
    }
    if (config.reverse !== undefined && config.palette === undefined) {
      issue(
        ["reverse"],
        config.colors !== undefined
          ? "reverse: flips a named palette; with colors: just list them in the order you want."
          : "reverse: flips a named palette: add palette: (e.g. palette: Blues)."
      );
    }

    // Graduated symbols without colours: the layer keeps its own colour, so a
    // no-data *colour* has nothing to paint.
    if (
      config.radius !== undefined &&
      config.palette === undefined &&
      config.colors === undefined &&
      config.noData !== undefined &&
      config.noData.trim().toLowerCase() !== "hide"
    ) {
      issue(
        ["noData"],
        "This classify sizes circles (radius:) but does not colour them, so a noData colour has " +
          "nothing to paint. Add palette: or colors: to colour the classes, or use noData: hide."
      );
    }

    // Class count the colours / radii must match.
    const count = hasCategories ? categoryCount(config) : declaredClassCount(config);
    if (count === undefined) return;

    if (config.palette !== undefined) {
      const palette = findPalette(config.palette);
      if (!palette) {
        const hint = suggestPalette(config.palette);
        issue(
          ["palette"],
          `Unknown palette "${config.palette}".` +
            (hint ? ` Did you mean "${hint}"?` : "") +
            " Use a ColorBrewer name (Blues, YlGnBu, RdBu, Set2 …), viridis, cividis or okabe-ito, " +
            "or list colors: yourself."
        );
      } else if (!paletteColors(palette, count)) {
        const sizes = paletteSizes(palette);
        const what = hasCategories ? `${count} categories` : `${count} classes`;
        issue(
          ["palette"],
          `${palette.name} has colours for up to ${sizes[sizes.length - 1]} classes, and this ` +
            `classify makes ${what}. Use fewer classes, a palette with more colours ` +
            "(viridis and cividis go to 12), or list colors: yourself."
        );
      }
    }
    if (config.colors !== undefined && config.colors.length !== count) {
      const what = hasCategories
        ? `${count} categor${count === 1 ? "y" : "ies"}`
        : hasBreaks
          ? `${count} classes (${config.breaks!.length} breaks + 1)`
          : `${count} classes`;
      issue(
        ["colors"],
        `This classify makes ${what}, and colors: lists ${config.colors.length} ` +
          `colour${config.colors.length === 1 ? "" : "s"}: give one colour per ${hasCategories ? "category" : "class"}.`
      );
    }
    if (config.radius !== undefined && !hasCategories && config.radius.length !== count) {
      issue(
        ["radius"],
        `This classify makes ${count} classes, and radius: lists ${config.radius.length} ` +
          `size${config.radius.length === 1 ? "" : "s"}: give one radius per class.`
      );
    }
    // Numeric classes coloured from the default palette: the largest one
    // (viridis) has MAX_CLASS_COUNT colours, so more breaks would leave the
    // top classes without a colour (an invalid step, ml-aot.78).
    if (
      !hasCategories &&
      config.palette === undefined &&
      config.colors === undefined &&
      config.radius === undefined &&
      count > MAX_CLASS_COUNT
    ) {
      issue(
        [hasBreaks ? "breaks" : "classes"],
        `This classify makes ${count} classes` +
          (hasBreaks ? ` (${config.breaks!.length} breaks + 1)` : "") +
          `, and the default palettes colour at most ${MAX_CLASS_COUNT}. Use fewer breaks, ` +
          "or list colors: yourself (one per class)."
      );
    }
    // A categories list coloured from the default qualitative palette.
    if (
      Array.isArray(config.categories) &&
      config.palette === undefined &&
      config.colors === undefined &&
      count > 8
    ) {
      issue(
        ["categories"],
        `${count} categories is more than the default palette (okabe-ito, 8 colours) can tell ` +
          "apart. Give each value its colour (categories: { value: colour }), list colors:, " +
          "or pick a larger palette (Set3 and Paired have 12)."
      );
    }
  })
  .describe(
    "Thematic classes for this layer: compiles to a MapLibre step (numeric) or match (categories) expression"
  );
