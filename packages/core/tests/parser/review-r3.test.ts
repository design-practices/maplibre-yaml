/**
 * Final review round on 0.8.1 (PR #156): parser and validation wording.
 *
 * - F3: a duplicate LAYER id no longer fails the whole document (0.8.0
 *   rendered it, the first layer winning); it is a warning. Duplicate
 *   CHAPTER ids stay an error.
 * - ml-aot.62: beginner mistakes worded in plain language, not parser/zod
 *   terms; chapter errors name the chapter once (1-based), not twice.
 * - ml-aot.63: one mistake, one message.
 * - ml-aot.65: a center written [latitude, longitude] is flagged.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { displayPath } from "../../src/parser/validation-utils";

const STYLE = '"https://tiles.openfreemap.org/styles/liberty"';

const map = (body: string) => `type: map
id: m
config:
  center: [-73.98, 40.75]
  zoom: 11
  mapStyle: ${STYLE}
${body}`;

const story = (chapters: string, top = "") => `type: scrollytelling
id: s
${top}config:
  center: [-73.98, 40.75]
  zoom: 11
  mapStyle: ${STYLE}
chapters:
${chapters}`;

const chapter = (id: string, extra = "") => `  - id: ${id}
    title: ${id}
    center: [-73.98, 40.75]
    zoom: 12
${extra}`;

describe("F3: duplicate layer ids warn, they don't fail the document", () => {
  const layers = `layers:
  - id: walk
    type: line
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
  - id: walk
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
`;

  it("a map with two layers named the same still validates, with a warning naming both lines", () => {
    const r = YAMLParser.safeParseMapBlock(map(layers));
    expect(r.success).toBe(true);
    const w = r.warnings.find((x) => x.path === "layers.1.id");
    expect(w?.message).toMatch(/Two layers have id "walk" \(lines \d+ and \d+\)/);
    expect(w?.message).toContain("the first one is drawn and this one is skipped");
  });

  it("a story with duplicate layer ids still validates", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(story(chapter("a"), layers));
    expect(r.success).toBe(true);
    expect(r.warnings.some((x) => x.path === "layers.1.id")).toBe(true);
  });

  it("duplicate chapter ids stay an error", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(story(chapter("a") + chapter("a")));
    expect(r.success).toBe(false);
    expect(r.errors[0]!.message).toMatch(/Two chapters have id "a"/);
  });
});

describe("ml-aot.62: plain wording for common beginner mistakes", () => {
  it("center without brackets says to add square brackets, with the fixed line", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(
      story(chapter("a") + `  - id: b\n    title: b\n    center: -73.982, 40.743\n    zoom: 12\n`)
    );
    expect(r.success).toBe(false);
    const e = r.errors[0]!;
    expect(e.message).toContain("center needs square brackets: center: [-73.982, 40.743]");
    expect(e.message).not.toMatch(/Expected array, got string/);
  });

  it("config.center and a marker's at: without brackets get the same hint", () => {
    const c = YAMLParser.safeParseMapBlock(map("layers: []\n").replace("center: [-73.98, 40.75]", "center: -73.98, 40.75"));
    expect(c.errors[0]!.message).toContain("center needs square brackets: center: [-73.98, 40.75]");
    const m = YAMLParser.safeParseMapBlock(map("layers: []\nmarkers:\n  - at: -73.98, 40.75\n"));
    expect(m.errors[0]!.message).toContain("at needs square brackets: at: [-73.98, 40.75]");
  });

  it("alignment: middle lists the allowed values and suggests center", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(story(chapter("a", "    alignment: middle\n")));
    const e = r.errors[0]!;
    expect(e.message).toContain('alignment: "middle" is not one of left, right, center, full');
    expect(e.message).toContain('Did you mean "center"?');
    expect(e.message).not.toMatch(/Invalid enum value/);
  });

  it("a double quote inside a double-quoted value is explained, at its line", () => {
    const yaml = story(
      chapter("a").replace("    title: a\n", '    title: a\n    description: "<p>A "walk" from the Met.</p>"\n')
    );
    const r = YAMLParser.safeParseScrollytellingBlock(yaml);
    const e = r.errors[0]!;
    const line = yaml.split("\n").findIndex((l) => l.includes('"walk"')) + 1;
    expect(e.line).toBe(line);
    expect(e.message).toContain('a " inside a "…" value ends it early');
    expect(e.message).toContain("single quotes");
    expect(e.message).toContain('\\"');
    expect(e.message).not.toMatch(/Unexpected scalar at node end/);
  });

  it("a deleted type: line gets one message, the same from every entry point", () => {
    const yaml = story(chapter("a")).replace("type: scrollytelling\n", "");
    const any = YAMLParser.safeParseAny(yaml);
    const viaStory = YAMLParser.safeParseScrollytellingBlock(yaml);
    const expected = "The document is missing type: at the top — add type: scrollytelling";
    expect(any.result.errors[0]!.message).toContain(expected);
    expect(viaStory.errors[0]!.message).toContain(expected);
    expect(any.result.errors).toHaveLength(1);
    // A map-shaped document is told type: map.
    const m = YAMLParser.safeParseAny(map("layers: []\n").replace("type: map\n", ""));
    expect(m.result.errors[0]!.message).toContain("add type: map");
  });

  it("a chapter error shown to a reader names the chapter once (1-based), not chapters.3 as well", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(
      story(chapter("a") + chapter("b") + chapter("c") + `  - id: d\n    title: d\n    zoom: 12\n`)
    );
    const e = r.errors[0]!;
    expect(e.path).toBe("chapters.3.center"); // tools keep the 0-based path
    expect(e.message).toContain('Chapter 4 ("d")');
    // What a reader sees: no "chapters.3" in front of "Chapter 4".
    expect(displayPath(e)).toBe("");
    // Other paths are shown as before.
    expect(displayPath({ path: "config.centre", message: "Unknown key" })).toBe("config.centre");
  });

  it("a type error inside a chapter keeps the field name in the chapter-labelled message", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(story(chapter("a", "    zoom2: 3\n").replace("zoom: 12", "zoom: twelve")));
    const e = r.errors.find((x) => x.path === "chapters.0.zoom")!;
    expect(e.message).toMatch(/^Chapter 1 \("a"\), zoom: /);
    expect(displayPath(e)).toBe("");
  });
});

describe("ml-aot.63: one mistake, one message", () => {
  it("centre: under config is reported once (the error), not again as an unknown-key warning", () => {
    const r = YAMLParser.safeParseMapBlock(map("layers: []\n").replace("center:", "centre:"));
    expect(r.errors.filter((e) => e.path === "config.centre")).toHaveLength(1);
    expect(r.warnings.filter((w) => w.path === "config.centre")).toHaveLength(0);
  });

  it("theme under a story's config is one warning (belongs at the top level)", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(
      story(chapter("a")).replace("  zoom: 11\n", "  zoom: 11\n  theme: dark\n")
    );
    const theme = r.warnings.filter((w) => w.path === "config.theme");
    expect(theme).toHaveLength(1);
    expect(theme[0]!.message).toContain('"theme" belongs at the top level');
  });
});

describe("ml-aot.65: swapped coordinates", () => {
  const pins = `layers:
  - id: places
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - { type: Feature, properties: {}, geometry: { type: Point, coordinates: [-73.985, 40.748] } }
          - { type: Feature, properties: {}, geometry: { type: Point, coordinates: [-73.97, 40.76] } }
`;

  it("config.center written [lat, lng] next to data around [lng, lat] warns with the swap, on the page", () => {
    const r = YAMLParser.safeParseMapBlock(map(pins).replace("center: [-73.98, 40.75]", "center: [40.75, -73.98]"));
    expect(r.success).toBe(true);
    const w = r.warnings.find((x) => x.path === "config.center")!;
    expect(w.message).toContain("center is [40.75, -73.98]");
    expect(w.message).toContain("coordinates are [longitude, latitude]");
    expect(w.message).toContain("did you mean [-73.98, 40.75]?");
    expect(w.onPage).toBe(true);
  });

  it("a chapter center swapped while the other chapters are not warns too", () => {
    const r = YAMLParser.safeParseScrollytellingBlock(
      story(chapter("a") + chapter("b") + chapter("c").replace("center: [-73.98, 40.75]", "center: [40.75, -73.98]"))
    );
    const w = r.warnings.find((x) => x.path === "chapters.2.center");
    expect(w?.message).toContain("did you mean [-73.98, 40.75]?");
  });

  it("a latitude beyond ±85 (valid, but past what the map shows) warns even with nothing to compare against", () => {
    const r = YAMLParser.safeParseMapBlock(map("layers: []\n").replace("center: [-73.98, 40.75]", "center: [-12, 88]"));
    expect(r.success).toBe(true);
    const w = r.warnings.find((x) => x.path === "config.center");
    expect(w?.message).toContain("latitude");
    expect(w?.onPage).toBe(true);
  });

  it("a correct center next to its data stays quiet", () => {
    const r = YAMLParser.safeParseMapBlock(map(pins));
    expect(r.warnings.filter((w) => w.path === "config.center")).toEqual([]);
  });
});
