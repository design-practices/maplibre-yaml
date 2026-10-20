/**
 * @file `classify:` → plain MapLibre expressions, provenance record, legend entries
 * @module @maplibre-yaml/core/classify/compile
 *
 * @description
 * Three steps, all pure:
 *
 * 1. {@link resolveClassify} turns the authored block into a
 *    {@link ClassifyRecord}: palette names resolved to hex colours, defaults
 *    filled in, the target paint property chosen. The record is what the
 *    emitted style carries in `layer.metadata["maplibre-yaml:classify"]` —
 *    provenance a third-party legend (or a future importer) can read.
 * 2. {@link withData} reads a GeoJSON dataset once: computes the breaks of a
 *    `method:` block, and notes the value range and how many features have no
 *    data (so the legend can show real edges and drop an empty "No data").
 * 3. {@link compileClassify} writes the expressions: `step` for numeric
 *    classes, `match` for categories, each behind a type guard.
 *
 * **Why the guard.** A `step` whose input is null, missing, or a string —
 * including a numeric string like `"15"` from a CSV-derived GeoJSON — does
 * not fall into the first class: MapLibre logs an evaluation error and paints
 * the property's default, which is black. The guard reads the value once
 * (`let`), accepts a number (not NaN) or a non-empty string that `to-number`
 * converts — `to-number(v, 0) == to-number(v, 1)` holds exactly when the
 * string is numeric, with no sentinel value — and sends everything else to
 * the no-data colour, or filters it out for `noData: hide`.
 */

import type { ClassifyConfig } from "../schemas/classify.schema";
import { DEFAULT_CLASS_COUNT, normalizeMethod } from "../schemas/classify.schema";
import {
  DEFAULT_QUALITATIVE_PALETTE,
  DEFAULT_SEQUENTIAL_PALETTE,
  findPalette,
  paletteColors,
  sampleEvenly,
} from "./palettes";
import { computeBreaks, fieldStats, type ClassifyMethod } from "./breaks";
import { formatNumber, type NumberFormatOptions } from "../i18n/number-format";
import { defaultStrings, type Strings } from "../i18n/strings";

/** The layer `metadata` key the compiled classify block is recorded under. */
export const CLASSIFY_METADATA_KEY = "maplibre-yaml:classify";

/** No-data colour when none is written: light grey, distinct from every palette. */
export const DEFAULT_NO_DATA_COLOR = "#cccccc";
/** Colour for categories that are not listed, when none is written. */
export const DEFAULT_OTHER_COLOR = "#969696";

/**
 * The colour paint properties `classify:` can drive, per layer type — the
 * style spec's data-driven colour properties. The first is the default.
 */
export const CLASSIFY_COLOR_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  fill: ["fill-color", "fill-outline-color"],
  line: ["line-color"],
  circle: ["circle-color", "circle-stroke-color"],
  "fill-extrusion": ["fill-extrusion-color"],
  symbol: ["text-color", "icon-color", "text-halo-color", "icon-halo-color"],
};

/** One category of a categorical record. */
export interface ClassifyCategory {
  /** The value as `to-string` reads it (`1`, `true`, `residential`). */
  value: string;
  color: string;
}

/** Facts one pass over the data established (absent for tiled sources). */
export interface ClassifyStats {
  /** Features read. */
  count: number;
  /** Features with no data (null, missing, empty, non-numeric). */
  noData: number;
  /** Smallest and largest numeric value (numeric classify). */
  min?: number;
  max?: number;
  /** Features whose category is not listed (categorical classify). */
  other?: number;
}

/**
 * A resolved `classify:` block — what the compiled expression means.
 *
 * @remarks
 * Recorded in the emitted style as `layer.metadata["maplibre-yaml:classify"]`.
 * Plain JSON: colours are hex, the palette name is canonical, `breaks` are
 * the thresholds actually drawn (computed ones included).
 */
export interface ClassifyRecord {
  field: string;
  /** Numeric: the field is divided by this property (a rate). */
  normalize?: string;
  /** Numeric: the rate is multiplied by this (per 100,000 …). */
  multiply?: number;
  kind: "numeric" | "categorical";
  /** The colour property the classes drive; absent when only `radius` is classified. */
  property?: string;
  /** Numeric: computed-break method, and the class count it was asked for. */
  method?: ClassifyMethod;
  classes?: number;
  /** Numeric: `step` thresholds. Absent while a `method:` waits for its data. */
  breaks?: number[];
  /** Numeric: one colour per class. */
  colors?: string[];
  /** The palette the colours came from (named, or the default). */
  palette?: string;
  reverse?: boolean;
  /** Numeric, circle layers: one `circle-radius` per class. */
  radius?: number[];
  /** Categorical: the listed values and their colours. */
  categories?: ClassifyCategory[];
  /** Categorical: colour for unlisted values, or `"hide"`. */
  other?: string;
  /** Colour for no-data features, or `"hide"`. */
  noData: string;
  /** Legend number format. */
  format?: NumberFormatOptions;
  /** What the data showed, when it was read (GeoJSON sources). */
  stats?: ClassifyStats;
}

/** Whether a record still waits for its data to compute breaks. */
export function isPending(record: ClassifyRecord): boolean {
  return record.kind === "numeric" && record.breaks === undefined;
}

function isHide(value: string | undefined): boolean {
  return value !== undefined && value.trim().toLowerCase() === "hide";
}

/** The default colour property a layer type classifies. */
export function defaultClassifyProperty(layerType: string): string | undefined {
  return CLASSIFY_COLOR_PROPERTIES[layerType]?.[0];
}

/** Colours for `n` numeric classes from a palette name (or the default for `n`). */
function numericPaletteColors(
  name: string | undefined,
  n: number,
  reverse: boolean
): { colors: string[]; palette: string } {
  const fallback = n <= 9 ? DEFAULT_SEQUENTIAL_PALETTE : "viridis";
  const palette = findPalette(name ?? fallback) ?? findPalette(fallback)!;
  const colors =
    paletteColors(palette, n, reverse) ??
    // Validation keeps a named palette within its sizes; this only guards a
    // record built by hand.
    sampleEvenly(paletteColors(findPalette("viridis")!, 12, reverse)!, n);
  return { colors, palette: palette.name };
}

/**
 * Resolve an authored (validated) `classify:` block for a layer type.
 *
 * @remarks
 * A `method:` block comes back pending — no `breaks` — until
 * {@link withData} sees its dataset. Its `colors` are those for the class
 * count asked for; if ties collapse classes, {@link withData} re-derives
 * them for the count actually drawn.
 */
export function resolveClassify(config: ClassifyConfig, layerType: string): ClassifyRecord {
  const noData =
    config.noData !== undefined
      ? isHide(config.noData)
        ? "hide"
        : config.noData
      : config.radius !== undefined && config.palette === undefined && config.colors === undefined
        ? "hide"
        : DEFAULT_NO_DATA_COLOR;
  const property = config.property ?? defaultClassifyProperty(layerType);
  const base = {
    field: config.field,
    noData,
    ...(config.format ? { format: config.format } : {}),
  };

  if (config.categories !== undefined) {
    let categories: ClassifyCategory[];
    let palette: string | undefined;
    if (Array.isArray(config.categories)) {
      const values = config.categories.map((v) => String(v));
      let colors: string[];
      if (config.colors) {
        colors = config.colors;
      } else {
        const found = findPalette(config.palette ?? DEFAULT_QUALITATIVE_PALETTE)!;
        palette = found.name;
        colors =
          paletteColors(found, values.length, config.reverse ?? false) ??
          sampleEvenly(paletteColors(found, 8) ?? [], values.length);
      }
      categories = values.map((value, i) => ({ value, color: colors[i % colors.length]! }));
    } else {
      categories = Object.entries(config.categories).map(([value, color]) => ({ value, color }));
    }
    return {
      ...base,
      kind: "categorical",
      ...(property ? { property } : {}),
      categories,
      other: config.other !== undefined ? (isHide(config.other) ? "hide" : config.other) : DEFAULT_OTHER_COLOR,
      ...(palette ? { palette } : {}),
      ...(config.reverse ? { reverse: true } : {}),
    };
  }

  const method = config.method !== undefined ? normalizeMethod(config.method) : undefined;
  const count = config.breaks ? config.breaks.length + 1 : (config.classes ?? DEFAULT_CLASS_COUNT);
  const classifiesColor =
    config.palette !== undefined || config.colors !== undefined || config.radius === undefined;

  const record: ClassifyRecord = {
    ...base,
    kind: "numeric",
    ...(config.normalize !== undefined ? { normalize: config.normalize } : {}),
    ...(config.normalize !== undefined && config.multiply !== undefined ? { multiply: config.multiply } : {}),
    ...(method ? { method, classes: count } : {}),
    ...(config.breaks ? { breaks: [...config.breaks] } : {}),
  };
  if (classifiesColor) {
    if (property) record.property = property;
    if (config.colors) {
      record.colors = [...config.colors];
    } else {
      const { colors, palette } = numericPaletteColors(config.palette, count, config.reverse ?? false);
      record.colors = colors;
      record.palette = palette;
      if (config.reverse) record.reverse = true;
    }
  }
  if (config.radius) record.radius = [...config.radius];
  return record;
}

/**
 * Read a dataset into a record: compute a `method:`'s breaks, and note the
 * value range and no-data count.
 *
 * @param template - The record as {@link resolveClassify} made it (pending,
 *   for a `method:`). Always derive from the template, not from a previous
 *   result: a refresh with fewer ties must be able to draw more classes again.
 * @returns a new record; the template is not modified.
 */
export function withData(template: ClassifyRecord, data: unknown): ClassifyRecord {
  const stats = fieldStats(data, template.field, template.kind, {
    ...(template.normalize !== undefined ? { normalize: template.normalize } : {}),
    ...(template.multiply !== undefined ? { multiply: template.multiply } : {}),
  });
  if (template.kind === "categorical") {
    const listed = new Set((template.categories ?? []).map((c) => c.value));
    let other = 0;
    for (const [value, n] of stats.categories ?? []) if (!listed.has(value)) other += n;
    return {
      ...template,
      stats: { count: stats.count, noData: stats.noData, other },
    };
  }

  const values = stats.values;
  const out: ClassifyRecord = {
    ...template,
    stats: {
      count: stats.count,
      noData: stats.noData,
      ...(values.length > 0 ? { min: values[0]!, max: values[values.length - 1]! } : {}),
    },
  };
  if (template.method) {
    const breaks = computeBreaks(template.method, values, template.classes ?? DEFAULT_CLASS_COUNT);
    out.breaks = breaks;
    const drawn = breaks.length + 1;
    const asked = template.colors?.length ?? template.radius?.length ?? drawn;
    if (template.colors && drawn !== asked) {
      out.colors =
        template.palette !== undefined
          ? (paletteColors(findPalette(template.palette)!, drawn, template.reverse ?? false) ??
            sampleEvenly(template.colors, drawn))
          : sampleEvenly(template.colors, drawn);
    }
    if (template.radius && drawn !== template.radius.length) {
      out.radius = sampleEvenly(template.radius, drawn);
    }
  }
  return out;
}

/** The value, read once into an expression variable. */
const VALUE = ["var", "value"];
/** The `normalize:` divisor, read once. */
const DIVISOR = ["var", "divisor"];

/**
 * True when a variable holds a usable number: a number that is not NaN, or
 * a non-empty string `to-number` converts. Kept sentinel-free:
 * `to-number(v, 0) == to-number(v, 1)` exactly when `v` itself converts.
 */
function isNumeric(v: unknown[]): unknown[] {
  return [
    "any",
    ["all", ["==", ["typeof", v], "number"], ["==", v, v]],
    ["all", ["==", ["typeof", v], "string"], ["!=", v, ""], ["==", ["to-number", v, 0], ["to-number", v, 1]]],
  ];
}

const NUMERIC_VALUE = isNumeric(VALUE);

/**
 * How a numeric record reads its input: the `let` bindings, the validity
 * test, and the number to classify. With `normalize:` the input is a rate —
 * `value ÷ divisor (× multiply)` — valid only when both are numbers and the
 * divisor is not 0, so a missing or zero population is no data rather than
 * Infinity or NaN.
 */
function numericInput(record: ClassifyRecord): { bindings: unknown[]; valid: unknown; input: unknown } {
  if (record.normalize === undefined) {
    return { bindings: ["value", ["get", record.field]], valid: NUMERIC_VALUE, input: ["to-number", VALUE] };
  }
  const ratio = ["/", ["to-number", VALUE], ["to-number", DIVISOR]];
  return {
    bindings: ["value", ["get", record.field], "divisor", ["get", record.normalize]],
    valid: ["all", NUMERIC_VALUE, isNumeric(DIVISOR), ["!=", ["to-number", DIVISOR], 0]],
    input: record.multiply !== undefined ? ["*", ratio, record.multiply] : ratio,
  };
}

/** `["step", input, out0, b1, out1, …]`, or the single output for one class. */
function step(input: unknown, outputs: readonly unknown[], breaks: readonly number[]): unknown {
  if (breaks.length === 0) return outputs[0];
  const expr: unknown[] = ["step", input, outputs[0]];
  breaks.forEach((b, i) => expr.push(b, outputs[i + 1]));
  return expr;
}

/** Numeric property expression: guarded unless no-data features are filtered out. */
function numericExpression(
  record: ClassifyRecord,
  outputs: readonly unknown[],
  breaks: readonly number[],
  noDataOutput: unknown | undefined
): unknown {
  const { bindings, valid, input } = numericInput(record);
  if (noDataOutput === undefined) {
    // noData: hide — the filter guarantees a usable value.
    if (record.normalize === undefined) {
      return step(["to-number", ["get", record.field]], outputs, breaks);
    }
    return ["let", ...bindings, step(input, outputs, breaks)];
  }
  return ["let", ...bindings, ["case", valid, step(input, outputs, breaks), noDataOutput]];
}

/** The compiled form of a record. */
export interface CompiledClassify {
  /** Paint properties to set (the colour property, `circle-radius`). */
  paint: Record<string, unknown>;
  /**
   * A data-independent filter to AND with the layer's own (`noData: hide`,
   * `other: hide`), or undefined.
   */
  filter?: unknown[];
}

/**
 * Compile a record to MapLibre expressions.
 *
 * @remarks
 * A pending record (a `method:` before its data) compiles to a flat colour —
 * the source has no features yet, so nothing is drawn with it — and to its
 * final filter, which never depends on the breaks.
 */
export function compileClassify(record: ClassifyRecord): CompiledClassify {
  const paint: Record<string, unknown> = {};
  const field = record.field;
  const hideNoData = isHide(record.noData);

  if (record.kind === "categorical") {
    const categories = record.categories ?? [];
    const hideOther = isHide(record.other);
    const label = ["to-string", ["get", field]];
    const filters: unknown[] = [];
    if (hideOther) {
      filters.push(["match", label, categories.map((c) => c.value), true, false]);
    } else if (hideNoData) {
      filters.push(["!=", label, ""]);
    }
    if (record.property && categories.length > 0) {
      const match: unknown[] = ["match", label];
      for (const c of categories) match.push(c.value, c.color);
      match.push(hideOther ? categories[0]!.color : (record.other ?? DEFAULT_OTHER_COLOR));
      paint[record.property] = hideNoData || hideOther
        ? match
        : ["case", ["==", label, ""], record.noData, match];
    }
    return { paint, ...(filters.length > 0 ? { filter: filters[0] as unknown[] } : {}) };
  }

  const filter = hideNoData ? ["let", ...numericInput(record).bindings, numericInput(record).valid] : undefined;
  const breaks = record.breaks;
  if (record.property && record.colors && record.colors.length > 0) {
    if (breaks === undefined) {
      // An expression, not a bare literal: the layer is classified, and
      // hover.highlight wraps a classified colour (re-wrapped when the
      // breaks land, renderer/highlight-paint).
      paint[record.property] = [
        "to-color",
        hideNoData ? record.colors[Math.floor((record.colors.length - 1) / 2)] : record.noData,
      ];
    } else {
      paint[record.property] = numericExpression(
        record,
        record.colors,
        breaks,
        hideNoData ? undefined : record.noData
      );
    }
  }
  if (record.radius && record.radius.length > 0) {
    paint["circle-radius"] =
      breaks === undefined
        ? record.radius[0]
        : numericExpression(record, record.radius, breaks, hideNoData ? undefined : record.radius[0]);
  }
  return { paint, ...(filter ? { filter } : {}) };
}

/** AND a compiled guard onto an authored filter. */
export function combineFilters(authored: unknown, guard: unknown[] | undefined): unknown {
  if (!guard) return authored;
  if (authored === undefined || authored === null) return guard;
  return ["all", authored, guard];
}

/**
 * Write a record into a layer spec: compiled paint, combined filter, and the
 * record in `metadata`. Returns a new spec; `spec` and its `paint`/`metadata`
 * objects are not modified (they may be shared with the parsed document).
 */
export function applyClassifyToSpec(
  spec: Record<string, unknown>,
  record: ClassifyRecord
): Record<string, unknown> {
  const compiled = compileClassify(record);
  const out: Record<string, unknown> = { ...spec };
  delete out["classify"];
  const paint =
    spec["paint"] && typeof spec["paint"] === "object" ? (spec["paint"] as Record<string, unknown>) : {};
  out["paint"] = { ...paint, ...compiled.paint };
  const filter = combineFilters(spec["filter"], compiled.filter);
  if (filter !== undefined) out["filter"] = filter;
  const metadata =
    spec["metadata"] && typeof spec["metadata"] === "object"
      ? (spec["metadata"] as Record<string, unknown>)
      : {};
  out["metadata"] = { ...metadata, [CLASSIFY_METADATA_KEY]: record };
  return out;
}

/**
 * Whether any layer is classified — compiled (metadata record) or still a raw
 * `classify:` block (a story's own `layers:`).
 */
export function hasClassifiedLayer(layers: readonly unknown[] | undefined): boolean {
  return (layers ?? []).some(
    (layer) =>
      classifyRecordOf(layer) !== undefined ||
      (layer !== null && typeof layer === "object" && typeof (layer as Record<string, unknown>)["classify"] === "object")
  );
}

/**
 * The legend a map builds (0.9): the authored `legend:` block; else, when a
 * layer is classified, an automatic one with the schema's defaults (a
 * thematic map without its key is not readable); `legend: false` — none.
 */
export function effectiveLegend<T extends object>(
  legend: T | false | undefined,
  layers: readonly unknown[] | undefined,
  automatic: T
): T | undefined {
  if (legend === false) return undefined;
  if (legend !== undefined) return legend;
  return hasClassifiedLayer(layers) ? automatic : undefined;
}

/** The record a layer (spec or renderer layer) carries in its metadata, if any. */
export function classifyRecordOf(layer: unknown): ClassifyRecord | undefined {
  if (!layer || typeof layer !== "object") return undefined;
  const metadata = (layer as Record<string, unknown>)["metadata"];
  if (!metadata || typeof metadata !== "object") return undefined;
  const record = (metadata as Record<string, unknown>)[CLASSIFY_METADATA_KEY];
  if (!record || typeof record !== "object") return undefined;
  const r = record as ClassifyRecord;
  return typeof r.field === "string" && (r.kind === "numeric" || r.kind === "categorical")
    ? r
    : undefined;
}

// ---------------------------------------------------------------- legend --

/** One legend line generated from a record. */
export interface ClassifyLegendEntry {
  /** A group heading line (no swatch). */
  heading?: true;
  label: string;
  color: string;
  shape?: "circle" | "square" | "line";
  /** Swatch diameter in px (graduated circles). */
  size?: number;
}

/** Fraction digits that show `values` distinctly without noise. */
function autoFractionDigits(values: readonly number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.every((v) => Number.isInteger(v))) return 0;
  const smallest = Math.min(...finite.filter((v) => v !== 0).map((v) => Math.abs(v)));
  let digits = smallest >= 100 ? 1 : smallest >= 1 ? 2 : Math.min(6, Math.ceil(-Math.log10(smallest)) + 1);
  // More digits until neighbouring edges read differently.
  const sorted = [...new Set(finite)].sort((a, b) => a - b);
  while (digits < 6) {
    const shown = sorted.map((v) => v.toFixed(digits));
    if (new Set(shown).size === shown.length) break;
    digits++;
  }
  return digits;
}

/**
 * Class labels from step thresholds: `< 10`, `10–25`, `≥ 25`; with the data's
 * range known, `0–10` … `25–98`. Numbers go through {@link formatNumber}.
 */
export function classLabels(
  breaks: readonly number[],
  range?: { min?: number; max?: number },
  format?: NumberFormatOptions,
  defaultLocale?: string
): string[] {
  const min = range?.min;
  const max = range?.max;
  const useMin = min !== undefined && (breaks.length === 0 || min < breaks[0]!);
  const useMax = max !== undefined && (breaks.length === 0 || max >= breaks[breaks.length - 1]!);
  const edges = [...breaks, ...(useMin ? [min!] : []), ...(useMax ? [max!] : [])];
  const digits =
    format && (format["max-fraction-digits"] !== undefined || format["min-fraction-digits"] !== undefined)
      ? undefined
      : autoFractionDigits(edges);
  const options: NumberFormatOptions =
    digits === undefined ? (format ?? {}) : { ...(format ?? {}), "max-fraction-digits": digits };
  const fmt = (v: number) => formatNumber(v, options, defaultLocale);
  const span = (a: number, b: number) => (a < 0 || b < 0 ? `${fmt(a)} – ${fmt(b)}` : `${fmt(a)}–${fmt(b)}`);

  if (breaks.length === 0) {
    return [min !== undefined && max !== undefined ? (min === max ? fmt(min) : span(min, max)) : "All values"];
  }
  const labels: string[] = [];
  labels.push(useMin ? span(min!, breaks[0]!) : `< ${fmt(breaks[0]!)}`);
  for (let i = 0; i < breaks.length - 1; i++) labels.push(span(breaks[i]!, breaks[i + 1]!));
  const last = breaks[breaks.length - 1]!;
  // A top class holding only the break value itself reads as that value.
  labels.push(useMax ? (max === last ? fmt(last) : span(last, max!)) : `≥ ${fmt(last)}`);
  return labels;
}

/** A heading for an unlabelled layer: the field, or the rate it maps. */
function defaultTitle(record: ClassifyRecord, defaultLocale?: string): string {
  if (record.normalize === undefined) return record.field;
  const locale = record.format?.locale ? { locale: record.format.locale } : {};
  const per =
    record.multiply !== undefined && record.multiply !== 1
      ? `${formatNumber(record.multiply, locale, defaultLocale)} `
      : "";
  return `${record.field} per ${per}${record.normalize}`;
}

/** The swatch shape for a layer type. */
function shapeFor(layerType: string | undefined): "circle" | "square" | "line" {
  if (layerType === "circle") return "circle";
  if (layerType === "line") return "line";
  return "square";
}

/**
 * Legend lines for a record: a heading, one line per class (or category),
 * then "Other" and "No data" when they can occur.
 *
 * @param options.title - The heading (the layer's `label`, else the field).
 * @param options.color - Swatch colour when the record does not classify
 *   colour (radius only): the layer's own literal colour.
 * @param options.strings - The document's UI strings ("No data" and "Other"
 *   are `maplibre-yaml.Classify.NoData` / `.Other`).
 * @param options.locale - Number locale when `format:` names none (the
 *   page's language).
 * @returns no lines while a `method:` waits for its data.
 */
export function classifyLegendEntries(
  record: ClassifyRecord,
  options: { title?: string; layerType?: string; color?: string; strings?: Strings; locale?: string } = {}
): ClassifyLegendEntry[] {
  const strings = options.strings ?? defaultStrings;
  if (isPending(record)) return [];
  const shape = shapeFor(options.layerType);
  const fallback = options.color ?? "#888888";
  const entries: ClassifyLegendEntry[] = [
    { heading: true, label: options.title ?? defaultTitle(record, options.locale), color: "transparent" },
  ];
  const stats = record.stats;
  const radiusOf = (r: number | undefined) => (r !== undefined ? { size: Math.max(2, r * 2) } : {});

  if (record.kind === "categorical") {
    for (const c of record.categories ?? []) entries.push({ label: c.value, color: c.color, shape });
    if (!isHide(record.other) && (stats === undefined || (stats.other ?? 0) > 0)) {
      entries.push({
        label: strings("maplibre-yaml.Classify.Other"),
        color: record.other ?? DEFAULT_OTHER_COLOR,
        shape,
      });
    }
  } else if (stats !== undefined && stats.count - stats.noData <= 0) {
    // No feature has a value: no class line describes anything on the map
    // (an "All values" line would). Only "No data" below (ml-aot.81).
  } else {
    const breaks = record.breaks ?? [];
    const labels = classLabels(breaks, stats, record.format, options.locale);
    labels.forEach((label, i) => {
      entries.push({
        label,
        color: record.colors?.[i] ?? fallback,
        shape: record.radius ? "circle" : shape,
        ...radiusOf(record.radius?.[i]),
      });
    });
  }
  if (!isHide(record.noData) && (stats === undefined || stats.noData > 0)) {
    entries.push({
      label: strings("maplibre-yaml.Classify.NoData"),
      color: record.property ? record.noData : fallback,
      shape: record.radius ? "circle" : shape,
      ...radiusOf(record.radius?.[0]),
    });
  }
  return entries;
}
