/**
 * The reserved leading `=` is enforced (ml-3e9, v2 plan R15): a style value
 * that starts with `=` warns at its line — v1 and v2, maps, stories and
 * `pages:` documents — and is an on-page author hint. MapLibre's own `==`
 * operator and the `["literal", "=…"]` escape never warn.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { expressionExample, reservedPrefixWarnings } from "../../src/parser/reserved-prefix";

const STYLE = '"https://demotiles.maplibre.org/style.json"';
const reserved = (warnings: Array<{ message: string }>) =>
  warnings.filter((w) => w.message.startsWith('Strings starting with "=" are reserved'));

const v1 = (layer: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${STYLE}
layers:
${layer}
`;

describe('the reserved "=" prefix (ml-3e9)', () => {
  it('warns on "=upper({name})" in a v1 layout, positioned, on the page, with a MapLibre example', () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  - id: labels
    type: symbol
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    layout:
      text-field: "=upper({name})"`)
    );
    expect(result.success).toBe(true);
    const [warning, ...rest] = reserved(result.warnings);
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ path: "layers.0.layout.text-field", line: 12, onPage: true });
    expect(warning!.message).toContain('"=upper({name})" is not a formula today');
    expect(warning!.message).toContain('e.g. ["upcase", ["get", "name"]]');
    expect(warning!.message).toContain('write ["literal", "=upper({name})"]');
  });

  it("warns in a v2 document's style layers", () => {
    const result = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  basemap: ${STYLE}
  sources: {}
  layers:
    - id: bg
      type: background
      paint:
        background-opacity: "=0.5"
`);
    expect(reserved(result.warnings).map((w) => [w.path, w.line])).toEqual([
      ["style.layers.0.paint.background-opacity", 13],
    ]);
  });

  it("warns inside expressions and filters, but never on the == operator or a legacy filter", () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    filter: ["all", ["==", ["get", "kind"], "park"], ["==", "kind", "park"], ["==", ["get", "x"], "=y"]]
    paint:
      circle-color: ["case", ["==", ["get", "k"], "=x"], "red", "blue"]`)
    );
    expect(reserved(result.warnings).map((w) => w.path)).toEqual([
      "layers.0.filter.3.2",
      "layers.0.paint.circle-color.1.2",
    ]);
  });

  it('["literal", "=…"] is the escape: no warning', () => {
    const result = YAMLParser.safeParseMapBlock(
      v1(`  - id: labels
    type: symbol
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    layout:
      text-field: ["literal", "=5"]`)
    );
    expect(reserved(result.warnings)).toEqual([]);
  });

  it("checks a story's chapter actions, never its prose", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${STYLE}
chapters:
  - id: one
    title: "=Results"
    description: "= totals below"
    center: [0, 0]
    zoom: 2
    onChapterEnter:
      - action: setPaintProperty
        layer: pts
        property: circle-color
        value: "=red"
`);
    expect(reserved(result.warnings).map((w) => w.path)).toEqual(["chapters.0.onChapterEnter.0.value"]);
  });

  it("checks maps inside a pages: document", () => {
    const result = YAMLParser.safeParse(`pages:
  - path: /
    title: Home
    blocks:
      - type: map
        id: m
        config: { center: [0, 0], zoom: 2, mapStyle: ${STYLE} }
        layers:
          - id: l
            type: symbol
            source: { type: geojson, data: { type: FeatureCollection, features: [] } }
            layout: { text-field: "=name" }
`);
    expect(reserved(result.warnings).map((w) => w.path)).toEqual([
      "pages.0.blocks.0.layers.0.layout.text-field",
    ]);
  });

  it("the value entry point (a JSON config) warns too, without line numbers", () => {
    const result = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://demotiles.maplibre.org/style.json" },
      layers: [
        {
          id: "l",
          type: "symbol",
          source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          layout: { "text-field": "=name" },
        },
      ],
    });
    const [warning] = reserved(result.warnings);
    expect(warning).toMatchObject({ path: "layers.0.layout.text-field", onPage: true });
    expect(warning!.line).toBeUndefined();
  });

  it("suggests an expression built from what was written", () => {
    expect(expressionExample("=upper({name})")).toBe('["upcase", ["get", "name"]]');
    expect(expressionExample("=lower({city})")).toBe('["downcase", ["get", "city"]]');
    // MapLibre's token pattern: spaces inside the braces are part of the name.
    expect(expressionExample("=upper({Site Name})")).toBe('["upcase", ["get", "Site Name"]]');
    expect(expressionExample("=population * 2")).toBe('["get", "name"]');
    expect(reservedPrefixWarnings({ layers: [{ paint: { "circle-radius": "==3" } }] })).toHaveLength(1);
  });
});
