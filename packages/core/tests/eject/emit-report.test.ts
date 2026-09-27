/**
 * @file Emit reports declared absences via the registry (U3, R6)
 */

import { describe, it, expect } from "vitest";
import { projectStyle } from "../../src/emitter/project";
import { normalizeMapBlock } from "../../src/model/normalize";
import type { V1MapInput } from "../../src/model/types";

const kitchenSink = {
  id: "sink",
  config: {
    center: [0, 0],
    zoom: 2,
    mapStyle: "https://example.com/style.json",
    scrollZoom: false, // constructor-only → map.options
  },
  controls: { navigation: true },
  legend: { title: "Legend" },
  layers: [
    {
      id: "pts",
      type: "circle",
      source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      paint: { "circle-radius": 4 },
      interactive: { click: { popup: { title: "hi" } } },
      legend: { label: "Points" },
      toggleable: true,
    },
  ],
} as unknown as V1MapInput;

describe("declared-absence reporting", () => {
  it("reports every chrome construct with its registered wording and a path", () => {
    const { warnings } = projectStyle(normalizeMapBlock(kitchenSink));
    const byPath = new Map(warnings.map((w) => [w.path, w]));

    // Layer chrome: one warning per construct, path down to the key.
    expect(byPath.get("layers.pts.interactive")?.message).toMatch(/Interactions .* runtime/);
    expect(byPath.get("layers.pts.legend")?.message).toMatch(/chrome/);
    expect(byPath.get("layers.pts.toggleable")?.message).toMatch(/authored visibility/);

    // Root chrome: previously vanished with NO warning at all.
    expect(byPath.get("controls")?.message).toMatch(/DOM chrome/);
    expect(byPath.get("legend")?.message).toMatch(/legend surface/);

    // Constructor-only map options.
    expect(byPath.get("runtime.map")?.message).toMatch(/scrollZoom/);

    // All declared absences are contract-kind: expected drops, not lossy.
    for (const path of [
      "layers.pts.interactive",
      "layers.pts.legend",
      "layers.pts.toggleable",
      "controls",
      "legend",
      "runtime.map",
    ]) {
      expect(byPath.get(path)?.kind, `${path} should be contract`).toBe("contract");
    }
  });

  it("kitchen-sink declared-absence report is stable (snapshot)", () => {
    const { warnings } = projectStyle(normalizeMapBlock(kitchenSink));
    expect(warnings).toMatchSnapshot();
  });

  it("strict mode still passes on declared absences (contract, not lossy)", () => {
    expect(() => projectStyle(normalizeMapBlock(kitchenSink), "strict")).not.toThrow();
  });

  it("reports stripped x-* extension blocks instead of silently dropping them", () => {
    const withExtension = {
      ...kitchenSink,
      layers: [
        {
          ...(kitchenSink as any).layers[0],
          "x-map-party": { panel: true },
        },
      ],
    } as unknown as V1MapInput;

    const { warnings, style } = projectStyle(normalizeMapBlock(withExtension));
    expect(JSON.stringify(style)).not.toContain("x-map-party");
    const extensionWarning = warnings.find((w) => w.message.includes("x-map-party"));
    expect(extensionWarning?.kind).toBe("contract");
    expect(extensionWarning?.message).toMatch(/never part of the emitted style/);
  });

  it("an unregistered synthetic runtime construct makes emit throw, not drop", () => {
    const model = normalizeMapBlock(kitchenSink);
    // Simulate a future runtime key that skipped registration.
    model.style.layers[0]!.runtime["holograms"] = { on: true };
    expect(() => projectStyle(model)).toThrow(/layer\.holograms.*no registered eject class/s);
  });

  it("a document with no runtime constructs reports nothing", () => {
    const bare = {
      id: "bare",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://example.com/style.json" },
      layers: [
        {
          id: "line",
          type: "line",
          source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
      ],
    } as unknown as V1MapInput;
    const { warnings } = projectStyle(normalizeMapBlock(bare));
    expect(warnings).toEqual([]);
  });
});
