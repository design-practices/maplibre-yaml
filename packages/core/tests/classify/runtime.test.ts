/**
 * @file The live half of classify (renderer/classify-runtime): computed
 * breaks follow the data the layer pipeline delivers — keyed by layer OR
 * source id, early (before the layer is added) or late, and on refresh.
 */

import { describe, it, expect, vi } from "vitest";
import { ClassifyRuntime, classifyFieldMessage } from "../../src/renderer/classify-runtime";
import { classifyFieldProblems } from "../../src/classify/breaks";
import {
  resolveClassify,
  applyClassifyToSpec,
  classifyRecordOf,
  classifyLegendEntries,
  DEFAULT_NO_DATA_COLOR,
} from "../../src/classify/compile";

const fc = (values: unknown[]) => ({
  type: "FeatureCollection",
  features: values.map((v) => ({ type: "Feature", properties: { v }, geometry: null })),
});

function layer(id: string, source: unknown) {
  const record = resolveClassify(
    { field: "v", method: "equal", classes: 2, colors: ["#000000", "#ffffff"] },
    "fill"
  );
  return applyClassifyToSpec({ id, type: "fill", source }, record) as {
    id: string;
    type: string;
    source: unknown;
    paint: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
}

function fakeMap(added: Set<string>) {
  return {
    getLayer: (id: string) => (added.has(id) ? { id } : undefined),
    setPaintProperty: vi.fn(),
  };
}

describe("ClassifyRuntime", () => {
  it("computes when a named source's data is delivered under the source id", () => {
    const data = new Map<string, unknown>();
    const map = fakeMap(new Set(["income"]));
    const changed = vi.fn();
    const l = layer("income", "tracts");
    const runtime = new ClassifyRuntime(map as never, [l], {}, (id) => data.get(id), changed);
    data.set("tracts", fc([0, 10]));
    runtime.dataLoaded("tracts");
    expect(classifyRecordOf(l)!.breaks).toEqual([5]);
    expect(map.setPaintProperty).toHaveBeenCalledWith("income", "fill-color", expect.any(Array));
    expect(changed).toHaveBeenCalledWith("income", expect.objectContaining({ breaks: [5] }));
  });

  it("matches an inline source's delivery by layer id", () => {
    const data = new Map<string, unknown>([["a-source", fc([2, 4])]]);
    const l = layer("a", { type: "geojson", url: "/a.geojson" });
    const runtime = new ClassifyRuntime(
      fakeMap(new Set(["a"])) as never,
      [l],
      {},
      (id) => data.get(id),
      () => {}
    );
    runtime.dataLoaded("a");
    expect(classifyRecordOf(l)!.breaks).toEqual([3]);
  });

  it("writes the paint onto a layer not yet on the map, and catches up when layers are ready", async () => {
    const data = new Map<string, unknown>();
    const map = fakeMap(new Set());
    const early = layer("early", "src");
    const runtime = new ClassifyRuntime(map as never, [early], {}, (id) => data.get(id), () => {});
    data.set("src", fc([0, 100]));
    runtime.dataLoaded("src"); // lands before the layer is added
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(JSON.stringify(early.paint["fill-color"])).toContain('"step"');

    // Data that landed with no event reaching this layer is picked up once
    // every layer is in.
    const quiet = layer("quiet", "src2");
    const runtime2 = new ClassifyRuntime(map as never, [quiet], {}, (id) => data.get(id), () => {});
    data.set("src2", fc([1, 3]));
    await runtime2.layersReady({ fetch: vi.fn() } as never);
    expect(classifyRecordOf(quiet)!.breaks).toEqual([2]);
  });

  it("recomputes from the template on refresh (classes follow the data)", () => {
    const data = new Map<string, unknown>([["s", fc([0, 10])]]);
    const l = layer("r", "s");
    const runtime = new ClassifyRuntime(
      fakeMap(new Set(["r"])) as never,
      [l],
      {},
      (id) => data.get(id),
      () => {}
    );
    runtime.dataLoaded("s");
    expect(classifyRecordOf(l)!.breaks).toEqual([5]);
    data.set("s", fc([100, 300]));
    runtime.dataLoaded("s");
    expect(classifyRecordOf(l)!.breaks).toEqual([200]);
    // Ties collapse to one class, and the next refresh can split them again.
    data.set("s", fc([7, 7]));
    runtime.dataLoaded("s");
    expect(classifyRecordOf(l)!.breaks).toEqual([]);
    data.set("s", fc([0, 2]));
    runtime.dataLoaded("s");
    expect(classifyRecordOf(l)!.breaks).toEqual([1]);
    expect(classifyRecordOf(l)!.colors).toEqual(["#000000", "#ffffff"]);
  });

  it("keeps hover.highlight on a classified colour when computed breaks land", () => {
    const data = new Map<string, unknown>([["s", fc([0, 10])]]);
    const map = fakeMap(new Set(["h"]));
    const l = Object.assign(layer("h", "s"), { interactive: { hover: { highlight: true } } });
    const runtime = new ClassifyRuntime(map as never, [l], {}, (id) => data.get(id), () => {});
    runtime.dataLoaded("s");
    const [, property, value] = map.setPaintProperty.mock.calls[0]!;
    expect(property).toBe("fill-color");
    expect((value as unknown[]).slice(0, 2)).toEqual(["case", ["boolean", ["feature-state", "hover"], false]]);
    expect(JSON.stringify((value as unknown[])[3])).toContain('"step"');
    // The layer object stays unwrapped: it is what a (re-)add wraps.
    expect((l.paint["fill-color"] as unknown[])[0]).toBe("let");
  });

  it("fetches a data: URL string MapLibre loads by itself", async () => {
    const l = layer("u", "named");
    const fetcher = { fetch: vi.fn(async () => ({ data: fc([0, 4]) })) };
    const runtime = new ClassifyRuntime(
      fakeMap(new Set(["u"])) as never,
      [l],
      { named: { type: "geojson", data: "https://example.com/u.geojson" } },
      () => undefined,
      () => {}
    );
    await runtime.layersReady(fetcher as never);
    expect(fetcher.fetch).toHaveBeenCalledWith("https://example.com/u.geojson");
    expect(classifyRecordOf(l)!.breaks).toEqual([2]);
  });

  describe("a source read by view (FlatGeobuf over the whole-file limit, or load: viewport)", () => {
    it("never computes breaks from the features in view, and reports once", async () => {
      const data = new Map<string, unknown>([["parcels", fc([0, 10, 20, 30])]]);
      const map = fakeMap(new Set(["income"]));
      const changed = vi.fn();
      const onRefused = vi.fn();
      const l = layer("income", "parcels");
      const before = JSON.stringify(l.paint["fill-color"]);
      const runtime = new ClassifyRuntime(map as never, [l], {}, (id) => data.get(id), changed, {
        readsByView: (id) => id === "parcels",
        onRefused,
      });
      runtime.dataLoaded("parcels");
      runtime.dataLoaded("parcels"); // the next view's read
      await runtime.layersReady({ fetch: vi.fn() } as never);

      expect(classifyRecordOf(l)!.breaks).toBeUndefined();
      expect(map.setPaintProperty).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      // The no-data colour stays: exactly it, not a class colour.
      expect(l.paint["fill-color"]).toEqual(["to-color", DEFAULT_NO_DATA_COLOR]);
      expect(JSON.stringify(l.paint["fill-color"])).toBe(before);
      expect(onRefused).toHaveBeenCalledTimes(1);
      const [layerId, sourceId, error] = onRefused.mock.calls[0]!;
      expect([layerId, sourceId]).toEqual(["income", "parcels"]);
      expect((error as Error).message).toContain("breaks:");
      expect((error as Error).message).toContain("whole file");
      expect((error as Error).message).toContain("mlym breaks");
    });

    it("a FlatGeobuf that switches to by-view after its empty placeholder keeps the no-data colour (ml-aot.106)", async () => {
      // The source's placeholder is there when the layers are ready, before
      // the loader has opened the file and switched to reading by view.
      const data = new Map<string, unknown>([["big", fc([])]]);
      let byView = false;
      const map = fakeMap(new Set(["m"]));
      const l = layer("m", "big");
      const runtime = new ClassifyRuntime(map as never, [l], {}, (id) => data.get(id), () => {}, {
        readsByView: () => byView,
        onRefused: vi.fn(),
      });
      await runtime.layersReady({ fetch: vi.fn() } as never);
      expect(classifyRecordOf(l)!.breaks).toBeUndefined();
      byView = true;
      data.set("big", fc([1, 2, 3, 40]));
      runtime.dataLoaded("big");
      expect(l.paint["fill-color"]).toEqual(["to-color", DEFAULT_NO_DATA_COLOR]);
      expect(map.setPaintProperty).not.toHaveBeenCalled();
    });

    it("keeps explicit breaks, without edges taken from the part in view", () => {
      const data = new Map<string, unknown>([["parcels", fc([3, 12, 40])]]);
      const record = resolveClassify(
        { field: "v", breaks: [10, 20], colors: ["#000000", "#777777", "#ffffff"] },
        "fill"
      );
      const l = applyClassifyToSpec({ id: "e", type: "fill", source: "parcels" }, record) as never as {
        paint: Record<string, unknown>;
      };
      const map = fakeMap(new Set(["e"]));
      const onRefused = vi.fn();
      const runtime = new ClassifyRuntime(map as never, [l as never], {}, (id) => data.get(id), () => {}, {
        readsByView: () => true,
        onRefused,
      });
      runtime.dataLoaded("parcels");
      expect(onRefused).not.toHaveBeenCalled();
      expect(JSON.stringify(l.paint["fill-color"])).toContain('"step"');
      const current = classifyRecordOf(l)!;
      expect(current.breaks).toEqual([10, 20]);
      expect(current.stats).toBeUndefined();
      expect(classifyLegendEntries(current).map((e) => e.label)).toEqual([
        "v",
        "< 10",
        "10–20",
        "≥ 20",
        "No data",
      ]);
    });
  });

  describe("a field the loaded data has no value for (ml-aot.95)", () => {
    const rows = (props: Array<Record<string, unknown>>) => ({
      type: "FeatureCollection",
      features: props.map((p) => ({ type: "Feature", properties: p, geometry: null })),
    });
    const TRACTS = rows([
      { name: "a", median_income: 30000, population: 100, zone: "residential" },
      { name: "b", median_income: 60000, population: 200, zone: "commercial" },
    ]);

    it("names a wrong-case or misspelt field, with a did-you-mean and the data's properties", () => {
      const [p] = classifyFieldProblems(TRACTS, { field: "Median_Income", kind: "numeric" });
      expect(p).toMatchObject({ key: "field", reason: "missing", suggestion: "median_income" });
      const message = classifyFieldMessage("income", p!);
      expect(message).toContain('classify field: "Median_Income" is not a property of any feature');
      expect(message).toContain('Did you mean "median_income"?');
      expect(message).toContain('"population"');
    });

    it("names a text field under numeric classes", () => {
      const [p] = classifyFieldProblems(TRACTS, { field: "zone", kind: "numeric" });
      expect(p).toMatchObject({ reason: "not-numeric", sample: "residential" });
      expect(classifyFieldMessage("z", p!)).toContain("holds no numbers");
      // The same field is fine for categories.
      expect(classifyFieldProblems(TRACTS, { field: "zone", kind: "categorical" })).toEqual([]);
    });

    it("checks normalize: too, and says nothing when the fields have values", () => {
      const [p] = classifyFieldProblems(TRACTS, { field: "median_income", kind: "numeric", normalize: "populaton" });
      expect(p).toMatchObject({ key: "normalize", reason: "missing", suggestion: "population" });
      expect(
        classifyFieldProblems(TRACTS, { field: "median_income", kind: "numeric", normalize: "population" })
      ).toEqual([]);
      expect(classifyFieldProblems(rows([]), { field: "x", kind: "numeric" })).toEqual([]);
    });

    it("an empty placeholder before the fetch is not 'checked': the fetched data is (ml-aot.105)", async () => {
      const data = new Map<string, unknown>([["tracts", rows([])]]); // the named source's placeholder
      const onFieldProblem = vi.fn();
      const record = resolveClassify({ field: "Median_Income", breaks: [50000], colors: ["#000000", "#ffffff"] }, "fill");
      const l = applyClassifyToSpec({ id: "income", type: "fill", source: "tracts" }, record) as never;
      const runtime = new ClassifyRuntime(fakeMap(new Set(["income"])) as never, [l], {}, (id) => data.get(id), () => {}, {
        readsByView: () => false,
        onRefused: vi.fn(),
        onFieldProblem,
      });
      await runtime.layersReady({ fetch: vi.fn() } as never);
      expect(onFieldProblem).not.toHaveBeenCalled();
      data.set("tracts", TRACTS);
      runtime.dataLoaded("tracts");
      expect(onFieldProblem).toHaveBeenCalledTimes(1);
      expect(String(onFieldProblem.mock.calls[0]![1])).toContain('Did you mean "median_income"?');
    });

    it("inline data the pipeline never delivers is checked from the document (ml-aot.105)", async () => {
      const onFieldProblem = vi.fn();
      const record = resolveClassify({ field: "Value", breaks: [1], colors: ["#000000", "#ffffff"] }, "fill");
      const own = applyClassifyToSpec(
        { id: "own", type: "fill", source: { type: "geojson", data: rows([{ value: 1 }, { value: 2 }]) } },
        record
      ) as never;
      const named = applyClassifyToSpec({ id: "named", type: "fill", source: "pts" }, record) as never;
      const runtime = new ClassifyRuntime(
        fakeMap(new Set(["own", "named"])) as never,
        [own, named],
        { pts: { type: "geojson", data: rows([{ value: 3 }]) } },
        () => undefined,
        () => {},
        { readsByView: () => false, onRefused: vi.fn(), onFieldProblem }
      );
      await runtime.layersReady({ fetch: vi.fn() } as never);
      expect(onFieldProblem.mock.calls.map((c) => c[0]).sort()).toEqual(["named", "own"]);
      expect(String(onFieldProblem.mock.calls[0]![1])).toContain('Did you mean "value"?');
    });

    it("the runtime reports it once per layer, for fetched and inline data", async () => {
      const data = new Map<string, unknown>([["s", TRACTS]]);
      const onFieldProblem = vi.fn();
      const fetched = layer("f", "s"); // field "v": on no feature
      const record = resolveClassify({ field: "Median_Income", breaks: [50000], colors: ["#000000", "#ffffff"] }, "fill");
      const inline = applyClassifyToSpec({ id: "i", type: "fill", source: "s2" }, record) as never;
      data.set("s2", TRACTS);
      const runtime = new ClassifyRuntime(
        fakeMap(new Set(["f", "i"])) as never,
        [fetched, inline],
        {},
        (id) => data.get(id),
        () => {},
        { readsByView: () => false, onRefused: vi.fn(), onFieldProblem }
      );
      runtime.dataLoaded("s");
      runtime.dataLoaded("s");
      await runtime.layersReady({ fetch: vi.fn() } as never);
      expect(onFieldProblem).toHaveBeenCalledTimes(2);
      expect(onFieldProblem.mock.calls.map((c) => c[0]).sort()).toEqual(["f", "i"]);
      expect(String(onFieldProblem.mock.calls.find((c) => c[0] === "i")![1])).toContain('"median_income"');
    });
  });

  describe("a GeoParquet source read by view: breaks from one whole column (0.10 U3, KTD7)", () => {
    const SOURCES = {
      lots: { type: "geojson", url: "https://example.com/data/lots.parquet", load: "viewport" },
      parcels: { type: "geojson", url: "/data/parcels.fgb", load: "viewport" },
    };
    const rows = (props: Array<Record<string, unknown>>) => ({
      type: "FeatureCollection",
      features: props.map((p) => ({ type: "Feature", properties: p, geometry: null })),
    });

    function computed(id: string, source: string, config: Record<string, unknown> = {}) {
      const record = resolveClassify(
        { field: "v", method: "quantile", classes: 2, colors: ["#000000", "#ffffff"], ...config } as never,
        "fill"
      );
      return applyClassifyToSpec({ id, type: "fill", source }, record) as ReturnType<typeof layer>;
    }

    /** A scan the test settles by hand. */
    function deferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("computes once from the whole column, and the view's data never moves the breaks (R6, R7)", async () => {
      const data = new Map<string, unknown>([["lots", fc([1, 2])]]);
      const map = fakeMap(new Set(["lots"]));
      const changed = vi.fn();
      const onRefused = vi.fn();
      const wholeColumn = vi.fn(async () => fc([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]));
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(map as never, [l], SOURCES, (id) => data.get(id), changed, {
        readsByView: () => true,
        wholeColumn,
        onRefused,
      });
      runtime.dataLoaded("lots");
      runtime.dataLoaded("lots"); // a second view's read while the scan is in flight
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(wholeColumn).toHaveBeenCalledTimes(1);
      expect(wholeColumn).toHaveBeenCalledWith("lots", ["v"]);
      const first = classifyRecordOf(l)!;
      expect(first.breaks).toEqual([50]);
      expect(first.stats).toMatchObject({ count: 10, min: 0, max: 90 });
      expect(map.setPaintProperty).toHaveBeenCalledWith("lots", "fill-color", expect.any(Array));
      // Pans and zooms deliver other features: nothing is recomputed.
      for (const view of [fc([1000, 2000]), fc([-5]), fc([])]) {
        data.set("lots", view);
        runtime.dataLoaded("lots");
      }
      await runtime.layersReady({ fetch: vi.fn() } as never);
      await Promise.resolve();
      expect(classifyRecordOf(l)).toEqual(first);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(wholeColumn).toHaveBeenCalledTimes(1);
      expect(onRefused).not.toHaveBeenCalled();
    });

    it("scans the normalize: column too", async () => {
      const wholeColumn = vi.fn(async () => rows([{ v: 1, pop: 10 }, { v: 4, pop: 10 }, { v: 9, pop: 10 }]));
      const l = computed("r", "lots", { normalize: "pop" });
      const changed = vi.fn();
      const runtime = new ClassifyRuntime(fakeMap(new Set(["r"])) as never, [l], SOURCES, () => fc([]), changed, {
        readsByView: () => true,
        wholeColumn,
        onRefused: vi.fn(),
      });
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());
      expect(wholeColumn).toHaveBeenCalledWith("lots", ["v", "pop"]);
      expect(classifyRecordOf(l)!.stats).toMatchObject({ min: 0.1, max: 0.9 });
    });

    it("AE5: a source whose reader can't scan (FlatGeobuf, PMTiles) keeps the refusal, naming mlym breaks with the command", () => {
      const onRefused = vi.fn();
      const l = computed("p", "parcels", { method: "jenks", classes: 5, colors: undefined, palette: "Blues" });
      const runtime = new ClassifyRuntime(fakeMap(new Set(["p"])) as never, [l], SOURCES, () => fc([1, 2, 3]), () => {}, {
        readsByView: () => true,
        wholeColumn: () => undefined,
        onRefused,
      });
      runtime.dataLoaded("parcels");
      runtime.dataLoaded("parcels");
      expect(onRefused).toHaveBeenCalledTimes(1);
      const message = (onRefused.mock.calls[0]![2] as Error).message;
      expect(message).toContain("source `parcels` is read by view");
      expect(message).toContain("`mlym breaks parcels.fgb --field v --method jenks --classes 5`");
      expect(message).toContain("breaks: [10, 25, 50]");
      expect(l.paint["fill-color"]).toEqual(["to-color", DEFAULT_NO_DATA_COLOR]);
    });

    it("a column over the scan cap keeps the refusal, naming mlym breaks and why", async () => {
      const onRefused = vi.fn();
      const l = computed("lots", "lots");
      const before = JSON.stringify(l.paint["fill-color"]);
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [l], SOURCES, () => fc([1]), () => {}, {
        readsByView: () => true,
        wholeColumn: () => Promise.reject(new Error("`v` is 40 MB compressed, over the 32 MB read for breaks")),
        onRefused,
      });
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
      const message = (onRefused.mock.calls[0]![2] as Error).message;
      expect(message).toContain("`v` is 40 MB compressed, over the 32 MB read for breaks");
      expect(message).toContain("`mlym breaks lots.parquet --field v --method quantile --classes 2`");
      expect(JSON.stringify(l.paint["fill-color"])).toBe(before);
      runtime.dataLoaded("lots");
      await Promise.resolve();
      expect(onRefused).toHaveBeenCalledTimes(1);
    });

    it("a scan that fails keeps the refusal; the layer keeps drawing its no-data colour, nothing throws", async () => {
      const onRefused = vi.fn();
      const map = fakeMap(new Set(["lots"]));
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(map as never, [l], SOURCES, () => fc([1]), () => {}, {
        readsByView: () => true,
        wholeColumn: () => Promise.reject(new Error("HTTP 500: Internal Server Error for lots.parquet")),
        onRefused,
      });
      expect(() => runtime.dataLoaded("lots")).not.toThrow();
      await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
      expect((onRefused.mock.calls[0]![2] as Error).message).toContain("mlym breaks");
      expect(map.setPaintProperty).not.toHaveBeenCalled();
      expect(l.paint["fill-color"]).toEqual(["to-color", DEFAULT_NO_DATA_COLOR]);
    });

    it("a missing or text field keeps the refusal, with the field-specific message", async () => {
      const onRefused = vi.fn();
      const onFieldProblem = vi.fn();
      const missing = computed("m", "lots", { field: "Floors" });
      const text = computed("t", "lots", { field: "zone" });
      const runtime = new ClassifyRuntime(
        fakeMap(new Set(["m", "t"])) as never,
        [missing, text],
        SOURCES,
        () => fc([1]),
        () => {},
        {
          readsByView: () => true,
          wholeColumn: async () => rows([{ floors: 1, zone: "a" }, { floors: 2, zone: "b" }]),
          onRefused,
          onFieldProblem,
        }
      );
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(onFieldProblem).toHaveBeenCalledTimes(2));
      const byLayer = Object.fromEntries(onFieldProblem.mock.calls.map(([id, m]) => [id, String(m)]));
      expect(byLayer["m"]).toContain('classify field: "Floors" is not a property of any feature');
      expect(byLayer["m"]).toContain('Did you mean "floors"?');
      expect(byLayer["t"]).toContain("holds no numbers");
      expect(onRefused).not.toHaveBeenCalled();
      expect(classifyRecordOf(missing)!.breaks).toBeUndefined();
      expect(classifyRecordOf(text)!.breaks).toBeUndefined();
      runtime.dataLoaded("lots");
      await Promise.resolve();
      expect(onFieldProblem).toHaveBeenCalledTimes(2);
    });

    it("categorical classify on the same source is unaffected: no scan", () => {
      const wholeColumn = vi.fn();
      const onRefused = vi.fn();
      const record = resolveClassify({ field: "zone", categories: ["a", "b"] } as never, "fill");
      const l = applyClassifyToSpec({ id: "c", type: "fill", source: "lots" }, record) as never as {
        paint: Record<string, unknown>;
      };
      const before = JSON.stringify(l.paint["fill-color"]);
      const runtime = new ClassifyRuntime(fakeMap(new Set(["c"])) as never, [l as never], SOURCES, () => fc([1]), () => {}, {
        readsByView: () => true,
        wholeColumn,
        onRefused,
      });
      runtime.dataLoaded("lots");
      expect(wholeColumn).not.toHaveBeenCalled();
      expect(onRefused).not.toHaveBeenCalled();
      expect(JSON.stringify(l.paint["fill-color"])).toBe(before);
    });

    it("a reseed changing classify.field while a scan is in flight discards the stale result and scans the new field", async () => {
      const scans: Array<{ fields: string[]; d: ReturnType<typeof deferred<unknown>> }> = [];
      const wholeColumn = vi.fn((_id: string, fields: string[]) => {
        const d = deferred<unknown>();
        scans.push({ fields, d });
        return d.promise as never;
      });
      const changed = vi.fn();
      const old = computed("lots", "lots");
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [old], SOURCES, () => fc([1]), changed, {
        readsByView: () => true,
        wholeColumn,
        onRefused: vi.fn(),
      });
      runtime.dataLoaded("lots");
      expect(scans.map((s) => s.fields)).toEqual([["v"]]);
      const next = computed("lots", "lots", { field: "w" });
      runtime.reseed([next], SOURCES, ["lots"]);
      await runtime.layersReady({ fetch: vi.fn() } as never);
      expect(scans.map((s) => s.fields)).toEqual([["v"], ["w"]]);
      scans[0]!.d.resolve(rows([{ v: 0 }, { v: 100 }]));
      await Promise.resolve();
      await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
      expect(classifyRecordOf(old)!.breaks).toBeUndefined();
      scans[1]!.d.resolve(rows([{ w: 2 }, { w: 4 }, { w: 6 }]));
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(classifyRecordOf(next)!.breaks).toEqual([4]);
      expect(classifyRecordOf(next)!.field).toBe("w");
    });

    it("without onFieldProblem, a scan's missing or text field is reported through onRefused, once", async () => {
      const onRefused = vi.fn();
      const l = computed("m", "lots", { field: "Floors" });
      const runtime = new ClassifyRuntime(fakeMap(new Set(["m"])) as never, [l], SOURCES, () => fc([1]), () => {}, {
        readsByView: () => true,
        wholeColumn: async () => rows([{ floors: 1 }, { floors: 2 }]),
        onRefused,
      });
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
      const [layerId, sourceId, error] = onRefused.mock.calls[0]!;
      expect(layerId).toBe("m");
      expect(sourceId).toBe("lots");
      expect((error as Error).message).toContain('classify field: "Floors" is not a property of any feature');
      expect((error as Error).message).toContain('Did you mean "floors"?');
      runtime.dataLoaded("lots");
      await Promise.resolve();
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(classifyRecordOf(l)!.breaks).toBeUndefined();
    });

    it("a new reader for the source (a live url: change) scans again: breaks from the new file", async () => {
      let reader = { file: "a" };
      const files: Record<string, unknown> = { a: fc([0, 10, 20, 30]), b: fc([100, 200, 300, 400]) };
      const wholeColumn = vi.fn(async () => files[reader.file]);
      const changed = vi.fn();
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [l], SOURCES, () => fc([1]), changed, {
        readsByView: () => true,
        readerToken: () => reader,
        wholeColumn,
        onRefused: vi.fn(),
      });
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(classifyRecordOf(l)!.stats).toMatchObject({ min: 0, max: 30 });
      // The same reader's next view: no second scan.
      runtime.dataLoaded("lots");
      await Promise.resolve();
      expect(wholeColumn).toHaveBeenCalledTimes(1);
      // The url changes; the new reader's first view lands.
      reader = { file: "b" };
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
      expect(wholeColumn).toHaveBeenCalledTimes(2);
      expect(classifyRecordOf(l)!.stats).toMatchObject({ min: 100, max: 400 });
    });

    it("a new reader clears a refusal its old file's scan gave", async () => {
      let reader = { file: "a" };
      const onRefused = vi.fn();
      const changed = vi.fn();
      const scan = vi.fn(() =>
        reader.file === "a" ? Promise.reject(new Error("HTTP 500 for a.parquet")) : Promise.resolve(fc([1, 2, 3, 4]))
      );
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [l], SOURCES, () => fc([1]), changed, {
        readsByView: () => true,
        readerToken: () => reader,
        wholeColumn: scan,
        onRefused,
      });
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
      reader = { file: "b" };
      runtime.dataLoaded("lots");
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(classifyRecordOf(l)!.breaks).toBeDefined();
      expect(onRefused).toHaveBeenCalledTimes(1);
    });

    it("a scan in flight when the source's reader is replaced never applies", async () => {
      const d = deferred<unknown>();
      let reader: object = { file: "a" };
      const changed = vi.fn();
      const onRefused = vi.fn();
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [l], SOURCES, () => fc([1]), changed, {
        readsByView: () => true,
        readerToken: () => reader,
        wholeColumn: () => d.promise as never,
        onRefused,
      });
      runtime.dataLoaded("lots");
      // Re-targeted before the old file's column lands (no delivery from the new reader yet).
      reader = { file: "b" };
      d.resolve(fc([0, 10, 20]));
      await Promise.resolve();
      await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
      expect(classifyRecordOf(l)!.breaks).toBeUndefined();
      expect(onRefused).not.toHaveBeenCalled();
    });

    it("a scan landing after destroy is dropped", async () => {
      const d = deferred<unknown>();
      const changed = vi.fn();
      const l = computed("lots", "lots");
      const runtime = new ClassifyRuntime(fakeMap(new Set(["lots"])) as never, [l], SOURCES, () => fc([1]), changed, {
        readsByView: () => true,
        wholeColumn: () => d.promise as never,
        onRefused: vi.fn(),
      });
      runtime.dataLoaded("lots");
      runtime.destroy();
      d.resolve(fc([0, 10]));
      await Promise.resolve();
      await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
    });
  });
});
