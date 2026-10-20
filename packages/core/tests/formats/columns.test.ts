/**
 * Which GeoParquet columns a document reads (0.9, ml-cnv.4): every property
 * the document references for a source — expressions, tokens, popups,
 * classify, the source's own keys — or everything when a reference can't be
 * narrowed; an author's `columns:` wins.
 */
import { describe, it, expect } from "vitest";
import { geoParquetColumns, isGeoParquetSource } from "../../src/formats/columns";
import { declaredColumns } from "../../src/formats/detect";
import { storyMapDocument } from "../../src/scrollytelling/engine";

const wells = { type: "geojson", url: "data/wells.parquet" };

describe("geoParquetColumns", () => {
  it("collects references from paint, layout, filters, popups, legend and classify", () => {
    const columns = geoParquetColumns({ wells, other: { type: "geojson", url: "x.geojson" } }, [
      {
        id: "dots",
        type: "circle",
        source: "wells",
        filter: ["all", ["has", "active"], ["==", "kind", "artesian"]],
        paint: {
          "circle-color": ["match", ["get", "kind"], "a", "#000", "#fff"],
          "circle-radius": ["interpolate", ["linear"], ["get", "depth_m"], 0, 3, 500, 9],
        },
        interactive: {
          click: { popup: [{ h3: [{ property: "name" }] }, { p: [{ str: "Owner: " }, { property: "owner" }] }] },
        },
      },
      {
        id: "labels",
        type: "symbol",
        source: "wells",
        layout: { "text-field": "{label} ({code})" },
      },
      {
        id: "classed",
        type: "circle",
        source: "wells",
        classify: { field: "cases", normalize: "population", method: "quantile", classes: 5 },
      },
      // Another source's references don't count.
      { id: "x", type: "fill", source: "other", paint: { "fill-color": ["get", "unrelated"] } },
    ]);
    expect(columns.get("wells")).toEqual([
      "active",
      "cases",
      "code",
      "depth_m",
      "kind",
      "label",
      "name",
      "owner",
      "population",
    ]);
    expect(columns.has("other")).toBe(false);
  });

  it("the source's own promoteId, filter and clusterProperties", () => {
    const columns = geoParquetColumns(
      {
        wells: {
          ...wells,
          promoteId: "well_id",
          cluster: true,
          clusterProperties: { total: ["+", ["get", "yield"]] },
          filter: [">", ["get", "depth_m"], 10],
        },
      },
      [{ id: "w", type: "circle", source: "wells" }]
    );
    expect(columns.get("wells")).toEqual(["depth_m", "well_id", "yield"]);
  });

  it("an expression that can read any property turns projection off", () => {
    for (const expr of [["properties"], ["get", ["concat", "pop_", ["global-state", "year"]]]]) {
      const columns = geoParquetColumns({ wells }, [
        { id: "w", type: "circle", source: "wells", paint: { "circle-radius": ["to-number", expr] } },
      ]);
      expect(columns.get("wells"), JSON.stringify(expr)).toBe("all");
    }
  });

  it("an author's columns: wins (a list, or all)", () => {
    const layers = [{ id: "w", type: "circle", source: "wells", paint: { "circle-color": ["get", "kind"] } }];
    expect(geoParquetColumns({ wells: { ...wells, columns: ["a", "b"] } }, layers).get("wells")).toEqual(["a", "b"]);
    expect(geoParquetColumns({ wells: { ...wells, columns: "all" } }, layers).get("wells")).toBe("all");
    expect(
      geoParquetColumns({ wells: { ...wells, runtime: { columns: ["c"] } } }, layers).get("wells")
    ).toEqual(["c"]);
  });

  it("a source with no references reads only its geometry", () => {
    expect(geoParquetColumns({ wells }, [{ id: "w", type: "circle", source: "wells" }]).get("wells")).toEqual([]);
  });

  it("an inline source is keyed by the id the renderer gives it", () => {
    const columns = geoParquetColumns({}, [
      { id: "w", type: "circle", source: { ...wells }, paint: { "circle-color": ["get", "kind"] } },
    ]);
    expect(columns.get("w-source")).toEqual(["kind"]);
  });

  it("format: geoparquet names an extensionless URL; a type that can't draw it is skipped", () => {
    expect(isGeoParquetSource({ type: "geojson", url: "https://x.org/api", format: "geoparquet" })).toBe(true);
    expect(isGeoParquetSource({ type: "vector", url: "a.parquet" })).toBe(false);
    expect(isGeoParquetSource({ type: "geojson", url: "a.fgb" })).toBe(false);
  });
});

describe("declaredColumns", () => {
  it("reads columns: flat or under runtime:", () => {
    expect(declaredColumns({ columns: ["a"] })).toEqual(["a"]);
    expect(declaredColumns({ columns: "ALL" })).toBe("all");
    expect(declaredColumns({ runtime: { columns: ["b"] } })).toEqual(["b"]);
    expect(declaredColumns({})).toBeUndefined();
  });
});

describe("the document the renderer receives (classify compiled into metadata)", () => {
  it("a classify field and divisor are read even when nothing else references them", async () => {
    const { YAMLParser } = await import("../../src/parser");
    const { toModel, denormalizeLayers, denormalizeSources } = await import("../../src/model");
    const parsed = YAMLParser.safeParseMapBlock(`type: map
id: m
config: { center: [10.2, 42.15], zoom: 9, mapStyle: "https://example.com/style.json" }
sources:
  districts: { type: geojson, url: data/districts.parquet }
layers:
  - id: rate
    type: fill
    source: districts
    classify: { field: cases, normalize: population, method: quantile, classes: 4, palette: Blues }
`);
    expect(parsed.success, JSON.stringify(parsed.errors)).toBe(true);
    const model = toModel(parsed.data as never);
    const layers = denormalizeLayers(model);
    // What the renderer gets: no `classify:` key, a compiled record instead.
    expect(layers[0]).not.toHaveProperty("classify");
    expect(geoParquetColumns(denormalizeSources(model), layers).get("districts")).toEqual(["cases", "population"]);
  });
});

describe("story chapter actions (0.9)", () => {
  const layers = [
    { id: "dots", type: "circle", source: "wells", paint: { "circle-color": ["get", "kind"] } },
    { id: "inline", type: "circle", source: { type: "geojson", url: "data/sites.parquet" } },
    { id: "other", type: "circle", source: "plain" },
  ];
  const sources = { wells, plain: { type: "geojson", url: "x.geojson" } };
  const actions = [
    { action: "setFilter", layer: "dots", filter: [">=", ["get", "magnitude"], 5] },
    // `property` names a paint property, not a column; the value's tokens and gets count.
    { action: "setPaintProperty", layer: "dots", property: "circle-radius", value: ["get", "depth_m"] },
    { action: "setLayoutProperty", layer: "inline", property: "text-field", value: "{site}" },
    { action: "setFilter", layer: "other", filter: ["==", ["get", "unrelated"], 1] },
    { action: "flyTo" },
  ];

  it("count for the source their layer draws from, named or inline", () => {
    const columns = geoParquetColumns(sources, layers, actions);
    expect(columns.get("wells")).toEqual(["depth_m", "kind", "magnitude"]);
    expect(columns.get("inline-source")).toEqual(["site"]);
    // Without the actions, only the layers' references.
    expect(geoParquetColumns(sources, layers).get("wells")).toEqual(["kind"]);
  });

  it("storyMapDocument hands the map the columns its chapters read", () => {
    const doc = storyMapDocument({
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 2, mapStyle: "x.json" },
      sources,
      layers,
      chapters: [
        { id: "a", title: "A", center: [0, 0], zoom: 2, onChapterEnter: actions.slice(0, 2), onChapterExit: [] },
        { id: "b", title: "B", center: [0, 0], zoom: 2, onChapterEnter: [], onChapterExit: actions.slice(2) },
      ],
    } as never);
    const docSources = doc["sources"] as Record<string, Record<string, unknown>>;
    expect(docSources["wells"]!["columns"]).toEqual(["depth_m", "kind", "magnitude"]);
    expect(docSources["plain"]).toEqual(sources.plain);
    const inline = (doc["layers"] as Array<{ id: string; source: Record<string, unknown> }>).find((l) => l.id === "inline")!;
    expect(inline.source["columns"]).toEqual(["site"]);
    // The map then reads exactly that list.
    expect(geoParquetColumns(doc["sources"], doc["layers"]).get("wells")).toEqual(["depth_m", "kind", "magnitude"]);
  });

  it("an author's columns: stays; a story without actions is untouched", () => {
    const story = {
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 2, mapStyle: "x.json" },
      sources: { wells: { ...wells, columns: ["kind"] } },
      layers: layers.slice(0, 1),
      chapters: [{ id: "a", title: "A", center: [0, 0], zoom: 2, onChapterEnter: actions.slice(0, 1), onChapterExit: [] }],
    };
    expect((storyMapDocument(story as never)["sources"] as any).wells.columns).toEqual(["kind"]);
    const plain = { ...story, sources: { wells }, chapters: [{ ...story.chapters[0], onChapterEnter: [] }] };
    expect((storyMapDocument(plain as never)["sources"] as any).wells).toBe(wells);
  });
});
