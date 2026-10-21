/**
 * Live-data source keys that validation and the runtime must agree on
 * (0.9.1). A GeoJSON source with only `stream:` is refused, and a stream
 * connects only beside a `refresh:` block (ml-aot.134) -- as the live-data
 * guide says. Checked in v1, v2 and story documents.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";

const v1 = (source: string) =>
  YAMLParser.safeParseMapBlock(
    `type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
  live:
${source}
layers:
  - id: dots
    type: circle
    source: live
`
  );

const v2 = (source: string) =>
  YAMLParser.safeParseMapBlock(
    `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [10.2, 42.15]
  zoom: 9
  sources:
    live:
${source}
  layers:
    - id: dots
      type: circle
      source: live
`
  );

const story = (source: string) =>
  YAMLParser.safeParseScrollytellingBlock(
    `type: scrollytelling
id: s
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
  live:
${source}
layers:
  - id: dots
    type: circle
    source: live
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
`
  );

const indent = (text: string, by: number) =>
  text
    .split("\n")
    .map((line) => " ".repeat(by) + line)
    .join("\n");

const STREAM = `type: geojson
stream: { type: sse, url: "https://stream.example.com/events" }`;
const EMPTY = `data: { type: FeatureCollection, features: [] }`;
const REFRESH = `refresh: { updateStrategy: replace }`;

describe("stream-only GeoJSON sources (ml-aot.134)", () => {
  it("v1: refused, and the error says how to start empty", () => {
    const result = v1(indent(STREAM, 4));
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path === "sources.live");
    expect(error?.message).toContain("requires at least one of: url, data, or prefetchedData");
    expect(error?.message).toContain("data: { type: FeatureCollection, features: [] }");
  });

  it("v2: refused with the same advice", () => {
    const result = v2(
      indent(`type: geojson\nruntime:\n  stream: { type: sse, url: "https://stream.example.com/events" }`, 6)
    );
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path === "style.sources.live");
    expect(error?.message).toContain("data: { type: FeatureCollection, features: [] }");
  });

  it("a source with neither data nor stream keeps the plain message", () => {
    const result = v1(indent("type: geojson", 4));
    const error = result.errors.find((e) => e.path === "sources.live");
    expect(error?.message).toContain("requires at least one of");
    expect(error?.message).not.toContain("stream:");
  });
});

describe("stream: without refresh: (ml-aot.134)", () => {
  const warned = (warnings: { path: string; message: string }[], path: string) =>
    warnings.find((w) => w.path === path && w.message.includes("stream: connects only when"));

  it("v1: warns at stream:, which never connects", () => {
    const result = v1(indent(`${STREAM}\n${EMPTY}`, 4));
    expect(result.success).toBe(true);
    const warning = warned(result.warnings, "sources.live.stream");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("refresh:");
    expect(warning!.line).toBe(10);
  });

  it("v2: warns at runtime.stream", () => {
    const result = v2(
      indent(
        `type: geojson\n${EMPTY}\nruntime:\n  stream: { type: sse, url: "https://stream.example.com/events" }`,
        6
      )
    );
    expect(result.success).toBe(true);
    expect(warned(result.warnings, "style.sources.live.runtime.stream")).toBeDefined();
  });

  it("a story warns too", () => {
    const result = story(indent(`${STREAM}\n${EMPTY}`, 4));
    expect(result.success).toBe(true);
    expect(warned(result.warnings, "sources.live.stream")).toBeDefined();
  });

  it("no warning with refresh: (or the legacy refreshInterval:) beside it", () => {
    const withRefresh = v1(indent(`${STREAM}\n${EMPTY}\n${REFRESH}`, 4));
    expect(withRefresh.success).toBe(true);
    expect(warned(withRefresh.warnings, "sources.live.stream")).toBeUndefined();

    const legacy = v1(indent(`${STREAM}\nurl: https://example.com/live.geojson\nrefreshInterval: 5000`, 4));
    expect(legacy.success).toBe(true);
    expect(warned(legacy.warnings, "sources.live.stream")).toBeUndefined();
  });
});

describe("loading: is deprecated: it has no effect (ml-aot.132)", () => {
  const LOADING = `loading:\n  enabled: true\n  message: "Loading vehicles..."`;
  const deprecation = (warnings: { path: string; message: string; kind?: string }[], path: string) =>
    warnings.find((w) => w.path === path && w.message.includes('"loading:" has no effect'));

  it("v1: still valid, with a deprecation warning at loading:", () => {
    const result = v1(indent(`type: geojson\nurl: https://example.com/v.geojson\n${LOADING}`, 4));
    expect(result.success).toBe(true);
    const warning = deprecation(result.warnings, "sources.live.loading");
    expect(warning).toBeDefined();
    expect(warning!.kind).toBe("deprecation");
    expect(warning!.line).toBe(11);
    expect(warning!.message).toContain("Loading map…");
  });

  it("v1: on a layer's inline source too", () => {
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
layers:
  - id: dots
    type: circle
    source:
      type: geojson
      url: https://example.com/v.geojson
      loading: { enabled: true }
`);
    expect(result.success).toBe(true);
    expect(deprecation(result.warnings, "layers.0.source.loading")).toBeDefined();
  });

  it("v2: at runtime.loading", () => {
    const result = v2(indent(`type: geojson\nurl: https://example.com/v.geojson\nruntime:\n${indent(LOADING, 2)}`, 6));
    expect(result.success).toBe(true);
    expect(deprecation(result.warnings, "style.sources.live.runtime.loading")).toBeDefined();
  });

  it("a story and a multi-page root document warn too", () => {
    const s = story(indent(`type: geojson\nurl: https://example.com/v.geojson\n${LOADING}`, 4));
    expect(s.success).toBe(true);
    expect(deprecation(s.warnings, "sources.live.loading")).toBeDefined();

    const root = YAMLParser.safeParse(`sources:
  live:
    type: geojson
    url: https://example.com/v.geojson
    loading: { enabled: true }
pages:
  - path: /
    title: Home
    blocks: []
`);
    expect(root.success).toBe(true);
    expect(deprecation(root.warnings, "sources.live.loading")).toBeDefined();
  });

  it("a source without loading: gets no such warning", () => {
    const result = v1(indent(`type: geojson\nurl: https://example.com/v.geojson`, 4));
    expect(result.warnings.some((w) => w.message.includes('"loading:"'))).toBe(false);
  });
});
