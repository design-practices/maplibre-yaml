/**
 * @file Class breaks computed from a GeoJSON dataset (quantile, equal, jenks)
 * @module @maplibre-yaml/core/classify/breaks
 *
 * @description
 * `classify: { method, classes }` computes its breaks from the data — which is
 * only honest when the whole dataset is in hand. That holds for GeoJSON
 * sources (inline `data:`, a fetched `url:`, a decoded FlatGeobuf file), and
 * never for vector tiles, where the browser sees only the tiles in view; the
 * validator refuses `method:` there and asks for explicit `breaks:`.
 *
 * Every method returns MapLibre `step` thresholds: strictly ascending, each
 * lower-inclusive (a value equal to a break takes the class above it), and
 * never at or below the minimum (a threshold there would leave the first
 * class empty). Ties can make a method return fewer thresholds than asked —
 * 40% of tracts with value 0 cannot be split into five equal-count classes —
 * and the caller then draws fewer classes and says so.
 *
 * Values are read exactly as the compiled expression reads them (see
 * {@link numericValue}), so the breaks describe the features the map colours.
 */

/** The break-computation methods. */
export const CLASSIFY_METHODS = ["quantile", "equal", "jenks"] as const;
export type ClassifyMethod = (typeof CLASSIFY_METHODS)[number];

/**
 * A feature property's numeric value, read the way the compiled guard reads
 * it: a finite-or-infinite number, or a non-empty string MapLibre's
 * `to-number` converts (CSV-derived GeoJSON carries `"15"`). Anything else —
 * null, missing, `""`, `"n/a"`, `NaN`, a boolean, an array — is no data.
 */
export function numericValue(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isNaN(raw) ? undefined : raw;
  if (typeof raw === "string") {
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * A feature property's category label, read the way the compiled `match`
 * reads it (`to-string`): null, missing and `""` are no data.
 */
export function categoryValue(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string") return raw === "" ? undefined : raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  // to-string of an array/object is its JSON — never a listed category.
  return JSON.stringify(raw);
}

/** What one pass over a dataset learned about a field. */
export interface FieldStats {
  /** Numeric values, ascending (numeric classify only). */
  values: number[];
  /** Features whose value is no data. */
  noData: number;
  /** Features read. */
  count: number;
  /** Feature count per category label (categorical classify only). */
  categories?: Map<string, number>;
}

function featuresOf(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (d["type"] === "FeatureCollection" && Array.isArray(d["features"])) return d["features"];
  if (d["type"] === "Feature") return [d];
  return [];
}

function propertyOf(feature: unknown, field: string): unknown {
  if (!feature || typeof feature !== "object") return undefined;
  const props = (feature as Record<string, unknown>)["properties"];
  if (!props || typeof props !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(props, field)
    ? (props as Record<string, unknown>)[field]
    : undefined;
}

/** Whether a value is a GeoJSON Feature or FeatureCollection. */
export function isFeatureData(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const t = (data as Record<string, unknown>)["type"];
  return t === "FeatureCollection" || t === "Feature";
}

/** A rate instead of a raw value: `field ÷ normalize × multiply`. */
export interface RateOptions {
  normalize?: string;
  multiply?: number;
}

/**
 * A feature's rate, read the way the compiled guard reads it: both values
 * numeric and the divisor non-zero, else no data. Divide, then multiply —
 * the expression's order, so both see the same float.
 */
export function rateValue(value: unknown, divisor: unknown, multiply?: number): number | undefined {
  const v = numericValue(value);
  const d = numericValue(divisor);
  if (v === undefined || d === undefined || d === 0) return undefined;
  return multiply !== undefined ? (v / d) * multiply : v / d;
}

/** Read one field (or a rate, with `normalize`) across a dataset. */
export function fieldStats(
  data: unknown,
  field: string,
  kind: "numeric" | "categorical",
  rate: RateOptions = {}
): FieldStats {
  const features = featuresOf(data);
  const values: number[] = [];
  const categories = kind === "categorical" ? new Map<string, number>() : undefined;
  let noData = 0;
  for (const feature of features) {
    const raw = propertyOf(feature, field);
    if (kind === "numeric") {
      const v =
        rate.normalize !== undefined
          ? rateValue(raw, propertyOf(feature, rate.normalize), rate.multiply)
          : numericValue(raw);
      if (v === undefined) noData++;
      else values.push(v);
    } else {
      const c = categoryValue(raw);
      if (c === undefined) noData++;
      else categories!.set(c, (categories!.get(c) ?? 0) + 1);
    }
  }
  values.sort((a, b) => a - b);
  return { values, noData, count: features.length, ...(categories ? { categories } : {}) };
}

/** Keep thresholds strictly ascending and strictly above the minimum. */
function cleanBreaks(breaks: number[], min: number): number[] {
  const out: number[] = [];
  for (const b of breaks) {
    if (!Number.isFinite(b) || b <= min) continue;
    if (out.length > 0 && b <= out[out.length - 1]!) continue;
    out.push(b);
  }
  return out;
}

/**
 * Quantile thresholds: each class holds (as near as ties allow) the same
 * number of features. The threshold for class i is the value at sorted
 * position ⌊i·n/k⌋, so — with `step`'s lower-inclusive edges — class 0 holds
 * exactly the first ⌊n/k⌋ values when there are no ties.
 */
export function quantileBreaks(sorted: readonly number[], classes: number): number[] {
  const n = sorted.length;
  if (n === 0 || classes < 2) return [];
  const raw: number[] = [];
  for (let i = 1; i < classes; i++) raw.push(sorted[Math.floor((i * n) / classes)]!);
  return cleanBreaks(raw, sorted[0]!);
}

/** Equal-interval thresholds: the range split into `classes` equal widths. */
export function equalBreaks(sorted: readonly number[], classes: number): number[] {
  const n = sorted.length;
  if (n === 0 || classes < 2) return [];
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  if (!(max > min)) return [];
  const raw: number[] = [];
  for (let i = 1; i < classes; i++) raw.push(min + (i * (max - min)) / classes);
  return cleanBreaks(raw, min);
}

/**
 * Jenks natural-breaks thresholds — the classes that minimise the summed
 * squared deviation from each class mean (Fisher's exact optimisation, which
 * Jenks' iterative procedure approximates).
 *
 * @remarks
 * Computed with Wang & Song's Ckmeans.1d.dp dynamic programme (2011), whose
 * divide-and-conquer fill is O(k·n·log n): a 100 000-feature layer takes
 * milliseconds, where the textbook Jenks matrices are O(k·n²). The fill
 * follows simple-statistics' `ckmeans` (ISC licence, Tom MacWright and
 * contributors). Each threshold is the smallest value of its class.
 */
export function jenksBreaks(sorted: readonly number[], classes: number): number[] {
  const n = sorted.length;
  if (n === 0 || classes < 2) return [];
  let unique = 1;
  for (let i = 1; i < n; i++) if (sorted[i] !== sorted[i - 1]) unique++;
  const k = Math.min(classes, unique);
  if (k < 2) return [];

  const matrix: Float64Array[] = [];
  const backtrack: Int32Array[] = [];
  for (let c = 0; c < k; c++) {
    matrix.push(new Float64Array(n));
    backtrack.push(new Int32Array(n));
  }

  // Prefix sums of values shifted by the median, for numerical stability.
  const shift = sorted[Math.floor(n / 2)]!;
  const sumX = new Float64Array(n);
  const sumXsq = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = sorted[i]! - shift;
    sumX[i] = (i > 0 ? sumX[i - 1]! : 0) + v;
    sumXsq[i] = (i > 0 ? sumXsq[i - 1]! : 0) + v * v;
  }
  // Within-class sum of squares of sorted[j..i].
  const ssq = (j: number, i: number): number => {
    let s: number;
    if (j > 0) {
      const mu = (sumX[i]! - sumX[j - 1]!) / (i - j + 1);
      s = sumXsq[i]! - sumXsq[j - 1]! - (i - j + 1) * mu * mu;
    } else {
      s = sumXsq[i]! - (sumX[i]! * sumX[i]!) / (i + 1);
    }
    return s < 0 ? 0 : s;
  };

  for (let i = 0; i < n; i++) {
    matrix[0]![i] = ssq(0, i);
    backtrack[0]![i] = 0;
  }

  const fill = (iMin: number, iMax: number, c: number): void => {
    if (iMin > iMax) return;
    const i = Math.floor((iMin + iMax) / 2);
    const row = matrix[c]!;
    const prev = matrix[c - 1]!;
    const back = backtrack[c]!;
    row[i] = prev[i - 1]!;
    back[i] = i;

    let jLow = c;
    if (iMin > c) jLow = Math.max(jLow, back[iMin - 1]!);
    jLow = Math.max(jLow, backtrack[c - 1]![i]!);
    let jHigh = i - 1;
    if (iMax < n - 1) jHigh = Math.min(jHigh, back[iMax + 1]!);

    for (let j = jHigh; j >= jLow; --j) {
      const sji = ssq(j, i);
      if (sji + prev[jLow - 1]! >= row[i]!) break;
      const sjLow = ssq(jLow, i) + prev[jLow - 1]!;
      if (sjLow < row[i]!) {
        row[i] = sjLow;
        back[i] = jLow;
      }
      jLow++;
      const sj = sji + prev[j - 1]!;
      if (sj < row[i]!) {
        row[i] = sj;
        back[i] = j;
      }
    }
    fill(iMin, i - 1, c);
    fill(i + 1, iMax, c);
  };

  for (let c = 1; c < k; c++) {
    // The last row only needs its final cell.
    fill(c < k - 1 ? c : n - 1, n - 1, c);
  }

  // Backtrack: the first index of each class from the last one down.
  const starts: number[] = [];
  let right = n - 1;
  for (let c = k - 1; c >= 0; c--) {
    const left = backtrack[c]![right]!;
    starts[c] = left;
    if (c > 0) right = left - 1;
  }
  const raw = starts.slice(1).map((index) => sorted[index]!);
  return cleanBreaks(raw, sorted[0]!);
}

/** Thresholds by method name. */
export function computeBreaks(
  method: ClassifyMethod,
  sorted: readonly number[],
  classes: number
): number[] {
  switch (method) {
    case "quantile":
      return quantileBreaks(sorted, classes);
    case "equal":
      return equalBreaks(sorted, classes);
    case "jenks":
      return jenksBreaks(sorted, classes);
  }
}
