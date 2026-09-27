/**
 * @file Emit reports declared absences via the registry (U3, R6)
 */

import { describe, it, expect } from "vitest";
import { projectStyle } from "../../src/emitter/project";
import { normalizeMapBlock } from "../../src/model/normalize";
import { readV2Block } from "../../src/model/read-v2";
import { MapBlockSchema } from "../../src/schemas";
import { toModel } from "../../src/model/to-model";
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
  className: "map-frame", // → runtime.container
  parameters: { minPop: { label: "Minimum population" } },
  layers: [
    {
      id: "pts",
      type: "circle",
      source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      paint: { "circle-radius": 4 },
      interactive: { click: { popup: { title: "hi" } } },
      legend: { label: "Points" },
      label: "Points of interest",
      toggleable: false, // explicit non-default — must report
    },
  ],
} as unknown as V1MapInput;

describe("declared-absence reporting", () => {
  it("reports every chrome construct with its registered wording, class, and path", () => {
    const { warnings } = projectStyle(normalizeMapBlock(kitchenSink));
    const byPath = new Map(warnings.map((w) => [w.path, w]));

    // Layer chrome: one warning per construct, path down to the key.
    expect(byPath.get("layers.pts.interactive")?.message).toMatch(/Interactions .* runtime/);
    expect(byPath.get("layers.pts.legend")?.message).toMatch(/chrome/);
    expect(byPath.get("layers.pts.label")?.message).toMatch(/chrome metadata/);
    expect(byPath.get("layers.pts.toggleable")?.message).toMatch(/authored visibility/);

    // Root chrome: previously vanished with NO warning at all.
    expect(byPath.get("controls")?.message).toMatch(/DOM chrome/);
    expect(byPath.get("legend")?.message).toMatch(/legend surface/);
    expect(byPath.get("container")?.message).toMatch(/host page/);
    expect(byPath.get("parameters")?.message).toMatch(/state/);

    // Constructor-only map options.
    expect(byPath.get("runtime.map")?.message).toMatch(/scrollZoom/);

    // Machine-readable fields (R6): consumers key on construct/ejectClass,
    // never on message prose.
    expect(byPath.get("layers.pts.interactive")?.construct).toBe("layer.interactive");
    expect(byPath.get("layers.pts.interactive")?.ejectClass).toBe("declared-absence");
    expect(byPath.get("controls")?.construct).toBe("controls");
    expect(byPath.get("runtime.map")?.construct).toBe("map.options");

    for (const path of [
      "layers.pts.interactive",
      "layers.pts.legend",
      "layers.pts.label",
      "layers.pts.toggleable",
      "controls",
      "legend",
      "container",
      "parameters",
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

  it("reports each stripped x-* extension block at its own path", () => {
    const withExtensions = {
      ...kitchenSink,
      layers: [
        {
          ...(kitchenSink as any).layers[0],
          "x-map-party": { panel: true },
          "x-other": { flag: 1 },
        },
      ],
    } as unknown as V1MapInput;

    const { warnings, style } = projectStyle(normalizeMapBlock(withExtensions));
    expect(JSON.stringify(style)).not.toContain("x-map-party");
    const extensionWarnings = warnings.filter((w) => w.construct === "x-*");
    expect(extensionWarnings).toHaveLength(2);
    const paths = extensionWarnings.map((w) => w.path).join(" ");
    expect(paths).toContain("x-map-party");
    expect(paths).toContain("x-other");
    for (const w of extensionWarnings) expect(w.kind).toBe("contract");
  });

  it("an inline live source with no compile-time data is lossy, like its named twin", () => {
    const doc = {
      id: "inline-live",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://example.com/style.json" },
      layers: [
        {
          id: "quakes",
          type: "circle",
          source: { type: "geojson", url: "/live.geojson", refresh: { refreshInterval: 5000 } },
        },
      ],
    } as unknown as V1MapInput;

    const { warnings } = projectStyle(normalizeMapBlock(doc));
    const refreshWarning = warnings.find((w) => w.construct === "source.refresh");
    expect(refreshWarning?.path).toBe("layers.quakes.source.refresh");
    expect(refreshWarning?.kind).toBe("lossy");
    expect(refreshWarning?.message).toMatch(/renders it empty/);
    // And lossy means --strict refuses it, exactly as for a named source.
    expect(() => projectStyle(normalizeMapBlock(doc), "strict")).toThrow(/strict/);
  });

  it("a schema-valid v2 document with an unknown runtime key WARNS, never throws (the ml-blj law)", () => {
    // v2 runtime blocks are passthrough: a typo like `togglable` validates.
    // Pre-fix this crashed emit with a message telling the author to edit
    // core source; the closed-world throw is reserved for core's own keys.
    const model = readV2Block({
      id: "typo",
      style: {
        layers: [
          {
            id: "pts",
            type: "circle",
            source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            runtime: { togglable: true },
          },
        ],
      },
    } as never);

    const { warnings } = projectStyle(model);
    const typoWarning = warnings.find((w) => w.path === "layers.pts.togglable");
    expect(typoWarning?.kind).toBe("contract");
    expect(typoWarning?.message).toMatch(/not a recognized runtime construct/);
    expect(typoWarning?.construct).toBeUndefined();
  });

  it("a plain document through the REAL parse pipeline emits zero warnings", () => {
    // Schema defaults (toggleable: true, fetchStrategy: "runtime") are
    // materialized by zod onto every parsed document — they are not authored
    // and must not generate declared-absence noise.
    const parsed = MapBlockSchema.parse({
      type: "map",
      id: "plain",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://example.com/style.json" },
      layers: [
        {
          id: "line",
          type: "line",
          source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
      ],
    });

    const { warnings } = projectStyle(toModel(parsed as never));
    expect(warnings).toEqual([]);
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
