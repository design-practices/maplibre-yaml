/**
 * The document side of 0.9's accessibility + languages work: `title:` and
 * `description:` at the root (v1, v2, stories), into the model and the
 * emitted style; `locale:` keys checked against the string table; popup
 * `format:` taking MapLibre's number-format options.
 */
import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { denormalizeOptions } from "../../src/model";
import { projectStyle } from "../../src/emitter";
import { storyMapDocument } from "../../src/scrollytelling";
import type { MapModel } from "../../src/model/types";

const BASEMAP = "https://demotiles.maplibre.org/style.json";

function parse(yaml: string) {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) {
    throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  }
  return result;
}
const model = (yaml: string): MapModel => toModel(parse(yaml).data as never);

const V1 = `
type: map
id: heat
title: Heat vulnerability in the Bronx
description: Census tracts shaded from pale yellow (low) to dark red (high).
config:
  center: [-73.9, 40.85]
  zoom: 11
  mapStyle: ${BASEMAP}
`;
const V2 = `
version: 2
type: map
id: heat
title: Heat vulnerability in the Bronx
description: Census tracts shaded from pale yellow (low) to dark red (high).
style:
  basemap: ${BASEMAP}
  center: [-73.9, 40.85]
  zoom: 11
`;

describe("title and description", () => {
  it("validate at the root of v1 and v2 documents with no warnings", () => {
    expect(parse(V1).warnings).toEqual([]);
    expect(parse(V2).warnings).toEqual([]);
  });

  it("land in the model's style half, the same for v1 and v2 (AE2)", () => {
    const v1 = model(V1);
    const v2 = model(V2);
    expect(v2).toEqual(v1);
    expect(v1.style.title).toBe("Heat vulnerability in the Bronx");
    expect(v1.style.description).toContain("Census tracts");
    // The renderer gets them as options.
    expect(denormalizeOptions(v1)).toMatchObject({
      title: "Heat vulnerability in the Bronx",
      description: expect.stringContaining("Census tracts"),
    });
  });

  it("export: title is the style's `name`, description rides prefixed metadata", () => {
    const { style } = projectStyle(model(V1.replace(`  mapStyle: ${BASEMAP}\n`, "")));
    expect(style["name"]).toBe("Heat vulnerability in the Bronx");
    expect(style["metadata"]).toEqual({
      "maplibre-yaml:description": "Census tracts shaded from pale yellow (low) to dark red (high).",
    });
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it("an authored v2 metadata key wins over the generated one", () => {
    const v2 = model(
      V2.replace("style:\n", 'style:\n  metadata:\n    "maplibre-yaml:description": mine\n    other: 1\n').replace(
        `  basemap: ${BASEMAP}\n`,
        ""
      )
    );
    const { style } = projectStyle(v2);
    expect(style["metadata"]).toEqual({ "maplibre-yaml:description": "mine", other: 1 });
  });

  it("written under config: it is reported as belonging at the top level", () => {
    const result = parse(`
type: map
id: m
config:
  title: Oops
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
`);
    const warning = result.warnings.find((w) => w.path === "config.title");
    expect(warning?.message).toMatch(/belongs at the top level/);
  });

  it("a story's title and description reach its map document", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(`
type: scrollytelling
id: s
title: The bridge
description: A walk across the bridge in three chapters.
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
`);
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    const doc = storyMapDocument(result.data as never);
    expect(doc["title"]).toBe("The bridge");
    expect(doc["description"]).toBe("A walk across the bridge in three chapters.");
  });
});

describe("locale: keys", () => {
  it("MapLibre's keys and ours share one table without warnings", () => {
    const result = parse(`
type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
  locale:
    NavigationControl.ZoomIn: Acercar
    maplibre-yaml.Legend.Title: Leyenda
`);
    expect(result.warnings).toEqual([]);
  });

  it("a misspelt maplibre-yaml key warns with a did-you-mean (v1, v2, stories)", () => {
    const v1 = parse(`
type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
  locale:
    maplibre-yaml.Legend.Titel: Leyenda
`);
    const w1 = v1.warnings.find((w) => w.path === "config.locale.maplibre-yaml.Legend.Titel");
    expect(w1?.message).toContain('Did you mean "maplibre-yaml.Legend.Title"?');
    expect(w1?.line).toBe(9);

    const v2 = parse(`
version: 2
type: map
id: m
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 2
runtime:
  map:
    locale:
      maplibre-yaml.Notice.Dismis: Cerrar
`);
    const w2 = v2.warnings.find((w) => w.path === "runtime.map.locale.maplibre-yaml.Notice.Dismis");
    expect(w2?.message).toContain('Did you mean "maplibre-yaml.Notice.Dismiss"?');

    const story = YAMLParser.safeParseScrollytellingBlock(`
type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
  locale:
    maplibre-yaml.Story.Chapter: Capítulos
chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
`);
    expect(story.warnings.some((w) => w.path === "config.locale.maplibre-yaml.Story.Chapter")).toBe(true);
  });
});

describe("popup format:", () => {
  const withFormat = (format: string) => `
type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    interactive:
      click:
        popup:
          - p:
              - property: population
                format: ${format}
`;

  it("accepts MapLibre number-format options and the older string", () => {
    expect(parse(withFormat("{ locale: de-DE, currency: EUR, min-fraction-digits: 0, max-fraction-digits: 2 }")).warnings).toEqual([]);
    expect(parse(withFormat("{ unit: kilometer }")).warnings).toEqual([]);
    expect(parse(withFormat('",.0f"')).warnings).toEqual([]);
  });

  it("a misspelt option warns; a bad value fails with the option named", () => {
    const typo = parse(withFormat("{ max-fractions-digits: 1 }"));
    expect(typo.warnings.some((w) => /Unknown key "max-fractions-digits"/.test(w.message))).toBe(true);
    const bad = YAMLParser.safeParseMapBlock(withFormat("{ currency: euro }"));
    expect(bad.success).toBe(false);
  });
});
