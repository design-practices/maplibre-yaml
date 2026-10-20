/**
 * @file Break computation (ml-340/0.9): quantile, equal interval and jenks on
 * known datasets, the value-reading rule shared with the compiled guard, and
 * jenks against an exhaustive optimum.
 */

import { describe, it, expect } from "vitest";
import {
  quantileBreaks,
  equalBreaks,
  jenksBreaks,
  computeBreaks,
  numericValue,
  categoryValue,
  fieldStats,
} from "../../src/classify/breaks";

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** Class index a value falls in under MapLibre step (lower-inclusive). */
function classOf(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]!) i++;
  return i;
}

describe("numericValue — the same rule as the compiled guard", () => {
  it("reads numbers and numeric strings; everything else is no data", () => {
    expect(numericValue(5)).toBe(5);
    expect(numericValue(-3.5)).toBe(-3.5);
    expect(numericValue("15")).toBe(15);
    expect(numericValue(" 7 ")).toBe(7);
    expect(numericValue("1e3")).toBe(1000);
    for (const v of [null, undefined, "", "abc", "n/a", NaN, true, false, [1], { a: 1 }]) {
      expect(numericValue(v)).toBeUndefined();
    }
  });

  it("reads category labels the way to-string does", () => {
    expect(categoryValue("res")).toBe("res");
    expect(categoryValue(1)).toBe("1");
    expect(categoryValue(true)).toBe("true");
    expect(categoryValue("")).toBeUndefined();
    expect(categoryValue(null)).toBeUndefined();
    expect(categoryValue(undefined)).toBeUndefined();
  });
});

describe("quantileBreaks", () => {
  it("puts an equal number of values in each class (no ties)", () => {
    const values = sorted(Array.from({ length: 100 }, (_, i) => i + 1)); // 1..100
    const breaks = quantileBreaks(values, 4);
    expect(breaks).toEqual([26, 51, 76]);
    const counts = [0, 0, 0, 0];
    for (const v of values) counts[classOf(v, breaks)]!++;
    expect(counts).toEqual([25, 25, 25, 25]);
  });

  it("collapses classes that ties make empty, and never breaks at the minimum", () => {
    // 60% zeros: five equal-count classes are impossible.
    const values = sorted([...Array(60).fill(0), ...Array.from({ length: 40 }, (_, i) => i + 1)]);
    const breaks = quantileBreaks(values, 5);
    expect(breaks[0]).toBeGreaterThan(0);
    expect(breaks.length).toBeLessThan(4);
    for (let i = 1; i < breaks.length; i++) expect(breaks[i]).toBeGreaterThan(breaks[i - 1]!);
  });

  it("returns no breaks for a single value or an empty dataset", () => {
    expect(quantileBreaks([], 5)).toEqual([]);
    expect(quantileBreaks([3, 3, 3], 5)).toEqual([]);
  });
});

describe("equalBreaks", () => {
  it("splits the range into equal widths", () => {
    expect(equalBreaks([0, 3, 7, 100], 4)).toEqual([25, 50, 75]);
    expect(equalBreaks([10, 20], 2)).toEqual([15]);
  });
  it("returns no breaks when every value is the same", () => {
    expect(equalBreaks([4, 4, 4], 3)).toEqual([]);
  });
});

describe("jenksBreaks (Ckmeans.1d.dp)", () => {
  it("finds the natural groups of a textbook dataset", () => {
    // simple-statistics' ckmeans fixture: clusters [-1×4], [2×3], [4,5,6].
    const values = sorted([-1, 2, -1, 2, 4, 5, 6, -1, 2, -1]);
    expect(jenksBreaks(values, 3)).toEqual([2, 4]);
  });

  it("separates three well-spaced clusters", () => {
    const values = sorted([1, 2, 3, 2, 1, 50, 51, 52, 100, 101, 99, 100]);
    expect(jenksBreaks(values, 3)).toEqual([50, 99]);
  });

  it("matches the exhaustive optimum on random data", () => {
    // Deterministic pseudo-random data; brute force over every split.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ssq = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - m) ** 2, 0);
    };
    for (let trial = 0; trial < 20; trial++) {
      const n = 8 + Math.floor(rand() * 8);
      const values = sorted(Array.from({ length: n }, () => Math.round(rand() * 1000) / 10));
      const k = 3;
      let best = Infinity;
      for (let a = 1; a < n - 1; a++) {
        for (let b = a + 1; b < n; b++) {
          const cost = ssq(values.slice(0, a)) + ssq(values.slice(a, b)) + ssq(values.slice(b));
          if (cost < best) best = cost;
        }
      }
      const breaks = jenksBreaks(values, k);
      const groups: number[][] = [[], [], []];
      for (const v of values) groups[classOf(v, breaks)]!.push(v);
      const got = groups.filter((g) => g.length > 0).reduce((acc, g) => acc + ssq(g), 0);
      expect(got).toBeCloseTo(best, 6);
    }
  });

  it("asks for no more classes than distinct values", () => {
    expect(jenksBreaks([1, 1, 5, 5], 4)).toEqual([5]);
    expect(jenksBreaks([2, 2, 2], 3)).toEqual([]);
  });

  it("handles a large layer quickly", () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const values = sorted(Array.from({ length: 100_000 }, () => rand() * 1000));
    const started = Date.now();
    const breaks = jenksBreaks(values, 7);
    expect(breaks).toHaveLength(6);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("computeBreaks / fieldStats", () => {
  it("dispatches by method name", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(computeBreaks("equal", values, 2)).toEqual([5.5]);
    expect(computeBreaks("quantile", values, 2)).toEqual([6]);
    expect(computeBreaks("jenks", values, 2)).toHaveLength(1);
  });

  it("reads a field across a FeatureCollection, counting no data", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { v: 3 }, geometry: null },
        { type: "Feature", properties: { v: "1" }, geometry: null },
        { type: "Feature", properties: { v: null }, geometry: null },
        { type: "Feature", properties: {}, geometry: null },
        { type: "Feature", properties: null, geometry: null },
        { type: "Feature", properties: { v: "n/a" }, geometry: null },
      ],
    };
    const stats = fieldStats(fc, "v", "numeric");
    expect(stats.values).toEqual([1, 3]);
    expect(stats.noData).toBe(4);
    expect(stats.count).toBe(6);
    const cats = fieldStats(
      { type: "FeatureCollection", features: [{ properties: { z: "a" } }, { properties: { z: "a" } }, { properties: { z: 2 } }] },
      "z",
      "categorical"
    );
    expect([...cats.categories!.entries()]).toEqual([
      ["a", 2],
      ["2", 1],
    ]);
  });
});
