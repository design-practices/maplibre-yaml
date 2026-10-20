/**
 * @file The live half of classify (renderer/classify-runtime): computed
 * breaks follow the data the layer pipeline delivers — keyed by layer OR
 * source id, early (before the layer is added) or late, and on refresh.
 */

import { describe, it, expect, vi } from "vitest";
import { ClassifyRuntime } from "../../src/renderer/classify-runtime";
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
      // The no-data colour stays.
      expect(before).toContain(DEFAULT_NO_DATA_COLOR);
      expect(JSON.stringify(l.paint["fill-color"])).toBe(before);
      expect(onRefused).toHaveBeenCalledTimes(1);
      const [layerId, sourceId, error] = onRefused.mock.calls[0]!;
      expect([layerId, sourceId]).toEqual(["income", "parcels"]);
      expect((error as Error).message).toContain("breaks:");
      expect((error as Error).message).toContain("whole file");
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
});
