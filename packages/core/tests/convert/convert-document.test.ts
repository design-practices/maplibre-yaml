/**
 * @file U5 (ml-4cn.6): convertDocument — losses, refusals and the authored tree
 *
 * R15/R16, AE5, KTD9. The converter writes what the author wrote and
 * reports what the target cannot keep: comments (with their lines), each
 * alias and merge key (where it is written), and, going to TOML, a null
 * whose key can be left out with the same meaning. Anything else the target
 * cannot hold fails, naming its path. Only a syntax error stops a
 * conversion; an invalid document converts, with its validation beside it.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:convert";
  w.URL.revokeObjectURL ??= () => {};
});

import { parse as parseYAML } from "yaml";
import { convertDocument, YAML_PARSE_OPTIONS, type ConvertResult } from "../../src";
import { yamlTree, tomlTree } from "../../src/convert/tree";
import { readToml } from "../../src/parser/toml/index";
import { authored, fixture } from "./helpers";

const STYLE = "https://demotiles.maplibre.org/style.json";
const SCHEMA = "https://docs.maplibre-yaml.org/schema/latest/map.schema.json";

const ok = (result: ConvertResult) => {
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result;
};
const failed = (result: ConvertResult) => {
  if (result.success) throw new Error(`expected a failure, got:\n${result.text}`);
  return result;
};

/** A map whose one layer has `layer` (YAML lines at 4 spaces) added. */
const yamlMap = (layer: string, top = "") => `${top}type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "${STYLE}"
layers:
  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
${layer}`;

describe("AE5: nulls going to TOML", () => {
  const story = (exit: string) => `type: scrollytelling
id: s
config:
  mapStyle: "${STYLE}"
  center: [0, 0]
  zoom: 1
layers:
  - id: dots
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 1
    onChapterExit:
      - action: setFilter
        layer: dots
${exit}`;

  it("leaves out a setFilter action's filter: null and reports it", async () => {
    const result = ok(await convertDocument(story("        filter: null\n"), { to: "toml" }));
    expect(result.text).not.toMatch(/filter/);
    expect(result.text).toContain('action = "setFilter"');
    expect(result.losses).toEqual([
      expect.objectContaining({ kind: "null", path: "chapters.0.onChapterExit.0.filter", line: 19, column: 9 }),
    ]);
    expect(result.losses[0]!.message).toMatch(/null dropped — TOML has no null/);
    // An empty value (`filter:`) is the same null.
    expect(ok(await convertDocument(story("        filter:\n"), { to: "toml" })).losses).toHaveLength(1);
  });

  it("keeps the null going to YAML or JSON, with no loss", async () => {
    for (const to of ["yaml", "json"] as const) {
      const result = ok(await convertDocument(story("        filter: null\n"), { to }));
      expect(result.text).toMatch(/"?filter"?: null/);
      expect(result.losses).toEqual([]);
    }
  });

  it("fails on a null inside an expression, naming its path", async () => {
    const doc = yamlMap('    filter: ["==", ["get", "kind"], null]\n');
    const result = failed(await convertDocument(doc, { to: "toml" }));
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "convert-null", path: "layers.0.filter.2", line: 11, column: 37 }),
    ]);
    expect(result.errors[0]!.message).toMatch(/TOML has no null/);
  });

  it("fails on any other null, naming every path", async () => {
    const doc = yamlMap("    minzoom: null\n    metadata: { note: null }\n");
    const result = failed(await convertDocument(doc, { to: "toml" }));
    expect(result.errors.map((e) => e.path)).toEqual(["layers.0.minzoom", "layers.0.metadata.note"]);
  });

  it("leaves out a GeoJSON feature's null properties and property values", async () => {
    const doc = `type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }
sources:
  pts:
    type: geojson
    data:
      type: FeatureCollection
      features:
        - type: Feature
          geometry: { type: Point, coordinates: [0, 0] }
          properties: { name: null, kind: a }
        - type: Feature
          geometry: { type: Point, coordinates: [1, 1] }
          properties: null
layers:
  - { id: a, type: circle, source: pts }
`;
    const result = ok(await convertDocument(doc, { to: "toml" }));
    expect(result.losses.map((l) => l.path)).toEqual([
      "sources.pts.data.features.0.properties.name",
      "sources.pts.data.features.1.properties",
    ]);
    const value = authored(result.text, "toml") as any;
    expect(value.sources.pts.data.features[0].properties).toEqual({ kind: "a" });
    expect("properties" in value.sources.pts.data.features[1]).toBe(false);
  });
});

describe("losses: comments, anchors and merge keys", () => {
  const doc = `# Two layers that share their source and paint
type: map
id: shared
config:
  center: [0, 0] # the middle
  zoom: 2
  mapStyle: "${STYLE}"
layers:
  - id: a
    type: circle
    source: &src { type: geojson, data: { type: FeatureCollection, features: [] } }
    paint: &dots
      circle-color: "#ff0000"
      circle-radius: 3
  - id: b
    type: circle
    source: *src
    paint:
      <<: *dots
      circle-radius: 6
    description: |
      # not a comment: block scalar text
`;

  it("reports each comment with its line, and each alias and merge key where it is written", async () => {
    const result = ok(await convertDocument(doc, { to: "json" }));
    expect(result.losses.map(({ kind, line, column }) => ({ kind, line, column }))).toEqual([
      { kind: "comment", line: 1, column: 1 },
      { kind: "comment", line: 5, column: 18 },
      { kind: "anchor", line: 17, column: 13 },
      { kind: "merge", line: 19, column: 7 },
    ]);
    expect(result.losses[0]!.message).toBe(
      "the comment on line 1 is dropped: # Two layers that share their source and paint"
    );
    expect(result.losses[2]!.message).toBe("the alias `*src` on line 17 is written out in full");
    expect(result.losses[3]!.message).toBe("the merge key `<<: *dots` on line 19 is written out in full");
  });

  it("writes the expansions out as toJS() reads them: explicit keys win over merged ones", async () => {
    const result = ok(await convertDocument(doc, { to: "json" }));
    const value = JSON.parse(result.text);
    expect(value).toEqual(parseYAML(doc, YAML_PARSE_OPTIONS));
    expect(value.layers[1].paint).toEqual({ "circle-color": "#ff0000", "circle-radius": 6 });
    expect(value.layers[1].source).toEqual(value.layers[0].source);
  });

  it("loses comments in a reprint to the same format, and in TOML", async () => {
    expect(ok(await convertDocument(doc, { to: "yaml" })).losses.filter((l) => l.kind === "comment")).toHaveLength(2);
    const toml = '# a TOML comment\ntype = "map" # trailing\nid = "m"\n';
    const result = ok(await convertDocument(toml, { from: "toml", to: "yaml" }));
    expect(result.losses.map((l) => [l.kind, l.line])).toEqual([
      ["comment", 1],
      ["comment", 2],
    ]);
  });
});

describe("!html is not a loss", () => {
  const doc = yamlMap('    interactive:\n      click:\n        popup: !html "<b>Hi</b> there"\n');

  it("becomes {\"$html\": …} in JSON and TOML, and !html again in YAML", async () => {
    const json = ok(await convertDocument(doc, { to: "json" }));
    expect(json.losses).toEqual([]);
    expect(json.text).toContain('"popup": { "$html": "<b>Hi</b> there" }');
    const toml = ok(await convertDocument(json.text, { from: "json", to: "toml" }));
    expect(toml.text).toContain('popup = { "$html" = "<b>Hi</b> there" }');
    const yaml = ok(await convertDocument(toml.text, { from: "toml", to: "yaml" }));
    expect(yaml.text).toContain('popup: !html "<b>Hi</b> there"');
    expect(authored(yaml.text, "yaml")).toEqual(authored(doc, "yaml"));
  });
});

describe("schema hints are translated, not lost", () => {
  const modeline = `# yaml-language-server: $schema=${SCHEMA}\n`;
  const doc = yamlMap("", modeline);

  it("modeline → $schema → #:schema → modeline", async () => {
    const json = ok(await convertDocument(doc, { to: "json" }));
    expect(json.losses).toEqual([]);
    expect(json.text.split("\n")[1]).toBe(`  "$schema": "${SCHEMA}",`);
    const toml = ok(await convertDocument(json.text, { from: "json", to: "toml" }));
    expect(toml.text.split("\n")[0]).toBe(`#:schema ${SCHEMA}`);
    expect(toml.text).not.toContain("$schema =");
    const yaml = ok(await convertDocument(toml.text, { from: "toml", to: "yaml" }));
    expect(yaml.losses).toEqual([]);
    expect(yaml.text.split("\n")[0]).toBe(modeline.trimEnd());
    expect(yaml.text).not.toMatch(/^\$schema:/m);
  });

  it("a root $schema key in YAML or TOML becomes the target's spelling", async () => {
    const yaml = ok(await convertDocument(`$schema: ${SCHEMA}\n${yamlMap("")}`, { to: "toml" }));
    expect(yaml.text.split("\n")[0]).toBe(`#:schema ${SCHEMA}`);
    const toml = ok(await convertDocument(`"$schema" = "${SCHEMA}"\ntype = "map"\nid = "m"\n`, { from: "toml", to: "yaml" }));
    expect(toml.text.split("\n")[0]).toBe(modeline.trimEnd());
  });
});

describe("number limits", () => {
  it("fails on inf or nan going to JSON, naming the path, and writes them in YAML and TOML", async () => {
    const doc = yamlMap("    paint: { circle-radius: .inf, circle-blur: .nan }\n");
    const json = failed(await convertDocument(doc, { to: "json" }));
    expect(json.errors).toEqual([
      expect.objectContaining({ code: "convert-number", path: "layers.0.paint.circle-radius", line: 11 }),
      expect.objectContaining({ code: "convert-number", path: "layers.0.paint.circle-blur", line: 11 }),
    ]);
    expect(json.errors[0]!.message).toMatch(/JSON has no inf/);
    expect(ok(await convertDocument(doc, { to: "toml" })).text).toContain("paint = { circle-radius = inf, circle-blur = nan }");
    expect(ok(await convertDocument(doc, { to: "yaml" })).text).toContain("circle-radius: .inf");
  });

  it("fails on an integer past 2^53, naming the path, from every format", async () => {
    const yaml = yamlMap("    metadata: { count: 9007199254740993 }\n");
    for (const to of ["yaml", "json", "toml"] as const) {
      const result = failed(await convertDocument(yaml, { to }));
      expect(result.errors).toEqual([expect.objectContaining({ code: "convert-number", path: "layers.0.metadata.count" })]);
      expect(result.errors[0]!.message).toContain("9007199254740993");
    }
    const toml = failed(await convertDocument('type = "map"\nid = "m"\nbig = 9_007_199_254_740_993\n', { from: "toml", to: "json" }));
    expect(toml.errors).toEqual([expect.objectContaining({ path: "big", line: 3, column: 7 })]);
    const json = failed(await convertDocument('{"type": "map", "big": -90071992547409930}', { from: "json", to: "yaml" }));
    expect(json.errors).toEqual([expect.objectContaining({ path: "big" })]);
    // 2^53 itself, and a large float, are fine.
    ok(await convertDocument(yamlMap("    metadata: { a: 9007199254740992, b: 1e300 }\n"), { to: "json" }));
  });

  it("keeps a whole number written as a float a float", async () => {
    const result = ok(await convertDocument(yamlMap("").replace("zoom: 2", "zoom: 2.0"), { to: "toml" }));
    expect(result.text).toContain("zoom = 2.0");
    const back = ok(await convertDocument(result.text, { from: "toml", to: "json" }));
    expect(back.text).toContain('"zoom": 2.0');
  });
});

describe("refusals and invalid input", () => {
  it("converts a schema-invalid document, returning its errors beside the output", async () => {
    const result = ok(await convertDocument(fixture("quick-start-planted.yaml"), { to: "toml" }));
    expect(result.validation.result.success).toBe(false);
    expect(result.validation.result.errors.map((e) => e.path)).toContain("config.zoom");
    expect(result.text).toContain('zoom = "1"');
    expect(result.text).toContain("[layers.paitn]");
  });

  it("refuses a syntax error, with the front door's error", async () => {
    const yaml = failed(await convertDocument("type: map\nid: [unclosed\n", { to: "json" }));
    expect(yaml.errors[0]).toMatchObject({ code: "yaml-syntax", format: "yaml" });
    const toml = failed(await convertDocument('type = "map"\nid = \n', { from: "toml", to: "yaml" }));
    expect(toml.errors[0]).toMatchObject({ code: "toml-syntax", format: "toml" });
    const json = failed(await convertDocument('{ "type": "map", // no\n }', { from: "json", to: "yaml" }));
    expect(json.errors[0]!.message).toMatch(/^JSON syntax error/);
  });

  it("refuses empty text and an unknown target", async () => {
    expect(failed(await convertDocument("  \n", { to: "json" })).errors[0]!.message).toMatch(/empty/);
    expect(failed(await convertDocument(yamlMap(""), { to: "xml" as never })).errors[0]!.message).toMatch(
      /choose yaml, json or toml/
    );
  });

  it("detects the input format from the signals or the text", async () => {
    expect(ok(await convertDocument('{"type": "map", "id": "m"}', { to: "yaml" })).from).toBe("json");
    expect(ok(await convertDocument('type = "map"\nid = "m"\n', { to: "yaml" })).from).toBe("toml");
    expect(ok(await convertDocument("type: map\nid: m\n", { to: "yaml", signals: { fileName: "m.yml" } })).from).toBe("yaml");
  });

  it("reprints a document in its own format", async () => {
    const result = ok(await convertDocument(fixture("quick-start.yaml"), { to: "yaml" }));
    expect(result.from).toBe("yaml");
    expect(authored(result.text, "yaml")).toEqual(authored(fixture("quick-start.yaml"), "yaml"));
  });
});

describe("the authored tree", () => {
  it("keeps __proto__ an ordinary key, in every format", async () => {
    const yaml = yamlTree('type: map\n__proto__: { polluted: true }\n"__proto__x": 1\n', "yaml")!;
    expect(yaml.root).toMatchObject({ kind: "map", entries: [{ key: "type" }, { key: "__proto__" }, { key: "__proto__x" }] });
    const toml = tomlTree('type = "map"\n[__proto__]\npolluted = true\n', readToml('type = "map"\n[__proto__]\npolluted = true\n') as never);
    expect(toml.root).toMatchObject({ kind: "map", entries: [{ key: "type" }, { key: "__proto__", value: { kind: "map" } }] });

    const json = ok(await convertDocument('{"type": "map", "__proto__": {"polluted": true}}', { to: "toml" }));
    expect(json.text).toContain("[__proto__]\npolluted = true");
    const back = ok(await convertDocument(json.text, { from: "toml", to: "json" }));
    expect(back.text).toContain('"__proto__": { "polluted": true }');
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("keeps integer-like keys in the order written (R9)", async () => {
    const doc = 'type: map\ncategories: { "10": "#ff0000", "2": "#00ff00", "1": "#0000ff" }\n';
    for (const to of ["json", "toml", "yaml"] as const) {
      const text = ok(await convertDocument(doc, { to })).text;
      expect(text.indexOf("10"), to).toBeLessThan(text.indexOf("#00ff00"));
      expect(text.indexOf("#00ff00"), to).toBeLessThan(text.indexOf("#0000ff"));
    }
    const toml = '[categories]\n"10" = "#ff0000"\n"2" = "#00ff00"\n"1" = "#0000ff"\n';
    const json = ok(await convertDocument(toml, { from: "toml", to: "json" })).text;
    expect(json).toContain('"categories": { "10": "#ff0000", "2": "#00ff00", "1": "#0000ff" }');
  });

  it("reads TOML dates as the text written, and writes them as strings", async () => {
    const result = ok(await convertDocument('type = "map"\nid = "m"\nupdated = 2024-01-02\n', { from: "toml", to: "yaml" }));
    expect(result.text).toContain('updated: "2024-01-02"');
  });

  it("keeps multi-line text exactly, in every format", async () => {
    const text = 'line one\n  "quoted" \\ back\n\nlast\n';
    const doc = `type: map\nid: m\nnote: ${JSON.stringify(text)}\nother: "no\\nend"\n`;
    for (const to of ["json", "toml", "yaml"] as const) {
      const out = ok(await convertDocument(doc, { to })).text;
      expect(authored(out, to), to).toMatchObject({ note: text, other: "no\nend" });
      for (const back of ["json", "toml", "yaml"] as const) {
        const again = ok(await convertDocument(out, { from: to, to: back })).text;
        expect(authored(again, back), `${to} → ${back}`).toMatchObject({ note: text, other: "no\nend" });
      }
    }
    expect(ok(await convertDocument(doc, { to: "yaml" })).text).toContain("note: |\n  line one\n");
    expect(ok(await convertDocument(doc, { to: "toml" })).text).toContain('note = """\nline one\n');
  });
});
