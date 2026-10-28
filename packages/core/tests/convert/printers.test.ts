/**
 * @file U5 (ml-4cn.6): what each printer writes
 *
 * JSON keeps expressions inline (the research's §6 trap: `JSON.stringify`
 * spreads `["get", "mag"]` over four lines). TOML is TOML 1.0, with a
 * table's values before its sub-tables. YAML quotes what a YAML 1.1 reader
 * would read as something else.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:convert";
  w.URL.revokeObjectURL ??= () => {};
});

import { parse as parseYAML } from "yaml";
import { convertDocument, type ConvertResult, type DocumentFormat } from "../../src";
import { authored, fixture, multiLineInlineTables, parseToml10 } from "./helpers";

const STYLE = "https://demotiles.maplibre.org/style.json";

async function text(doc: string, to: DocumentFormat, from?: DocumentFormat): Promise<string> {
  const result: ConvertResult = await convertDocument(doc, { to, ...(from ? { from } : {}) });
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.text;
}

describe("JSON", () => {
  it("prints the quick-start map in about 40 lines, expressions inline", async () => {
    const json = await text(fixture("quick-start.yaml"), "json");
    const lines = json.trimEnd().split("\n");
    // The research's hand-formatted JSON is 40 lines; JSON.stringify's is 75.
    expect(lines.length).toBeLessThanOrEqual(45);
    expect(JSON.stringify(JSON.parse(json), null, 2).split("\n").length).toBeGreaterThan(70);
    expect(json).toContain('"center": [-160, 20],');
    expect(json).toContain('"interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20');
    expect(json).toContain('"hover": { "cursor": "pointer" },');
    expect(json).toContain('{ "h3": [{ "property": "place" }] },');
    expect(json).toContain('"controls": { "navigation": true, "scale": true }');
    expect(lines.every((line) => line.length <= 80 || /"url": "/.test(line))).toBe(true);
  });

  it("wraps a long expression a line at a time, never a token at a time", async () => {
    const colours = Array.from({ length: 12 }, (_, i) => `"c${i}", "#${String(i).padStart(6, "0")}"`).join(", ");
    const doc = `type: map\nid: m\nlayers:\n  - id: a\n    paint:\n      fill-color: ["match", ["get", "kind"], ${colours}, "#000000"]\n`;
    const json = await text(doc, "json");
    expect(json).toContain('"match", ["get", "kind"], "c0", "#000000", "c1", "#000001",');
    expect(json.split("\n").every((line) => line.length <= 80)).toBe(true);
    expect(authored(json, "json")).toEqual(authored(doc, "yaml"));
  });
});

describe("TOML", () => {
  it("quotes dotted locale keys, so they stay flat", async () => {
    const toml = await text(fixture("locale.yaml"), "toml");
    expect(toml).toContain('[config.locale]\n"NavigationControl.ZoomIn" = "Acercar"');
    expect(toml).toContain('"Popup.Close" = "Cerrar"');
    expect((authored(toml, "toml") as any).config.locale["Popup.Close"]).toBe("Cerrar");
  });

  it("writes a table's values before its sub-tables, whatever the authored order", async () => {
    const doc = `type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }
layers:
  - paint:
      circle-color: "#e74c3c"
      circle-opacity: 0.7
      circle-stroke-width: 1
      circle-stroke-color: "#ffffff"
    id: quakes
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
`;
    const toml = await text(doc, "toml");
    const at = (s: string) => toml.indexOf(s);
    expect(at("[[layers]]")).toBeLessThan(at('id = "quakes"'));
    expect(at('id = "quakes"')).toBeLessThan(at("[layers.paint]"));
    expect(at('type = "circle"')).toBeLessThan(at("[layers.paint]"));
    expect(at("[layers.paint]")).toBeLessThan(at('circle-color = "#e74c3c"'));
    expect(authored(toml, "toml")).toEqual(authored(doc, "yaml"));
  });

  it("writes TOML 1.0: single-line inline tables, quoted $ref, $html and spaced keys", async () => {
    const doc = `type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }
sources:
  shared: { $ref: "./sources.yaml#/parcels" }
layers:
  - id: a
    type: fill
    source: shared
    metadata: { "with space": 1, "$html": "<b>x</b>", "a long key that goes on": "and a long value too, so the table cannot fit" }
`;
    const toml = await text(doc, "toml");
    expect(toml).toContain('shared = { "$ref" = "./sources.yaml#/parcels" }');
    expect(toml).toContain('"with space" = 1');
    expect(toml).toContain('"$html" = "<b>x</b>"');
    expect(() => parseToml10(toml)).not.toThrow();
    expect(multiLineInlineTables(toml)).toEqual([]);
    expect(authored(toml, "toml")).toEqual(authored(doc, "yaml"));
  });

  it("writes every research document as TOML 1.0", async () => {
    for (const name of ["quick-start", "choropleth", "story", "locale"]) {
      const toml = await text(fixture(`${name}.yaml`), "toml");
      expect(() => parseToml10(toml), name).not.toThrow();
      expect(multiLineInlineTables(toml), name).toEqual([]);
    }
  });

  it("refuses a document whose top level is not a table", async () => {
    const result = await convertDocument("- a\n- b\n", { to: "toml" });
    expect(result.success).toBe(false);
    expect(!result.success && result.errors[0]).toMatchObject({ code: "convert-shape", path: "" });
  });
});

describe("YAML", () => {
  const tricky = ["2024-01-02", "on", "no", "yes", "off", "y", "N", "0755", "1e3", "12:30", "~", "null", "true", ".inf", "<<", "-x", "a: b", "a #b", "#fff", ""];

  it("quotes every string a YAML 1.1 reader would read as something else", async () => {
    const doc = JSON.stringify({ type: "map", id: "m", labels: tricky, keyed: Object.fromEntries(tricky.map((t, i) => [t || "empty", i])) });
    const yaml = await text(doc, "yaml", "json");
    expect(yaml).toContain('"2024-01-02"');
    expect(yaml).toMatch(/^ {2}"on": 1$/m);
    expect(yaml).toContain('"no"');
    // Read back as YAML 1.2 (this library) and as YAML 1.1 (PyYAML's reading): the same strings.
    const value = JSON.parse(doc);
    expect(parseYAML(yaml)).toEqual(value);
    expect(parseYAML(yaml, { version: "1.1" })).toEqual(value);
  });

  it("leaves plain the strings every reader reads the same", async () => {
    const yaml = await text(fixture("story.toml"), "yaml", "toml");
    expect(yaml).toContain("theme: dark\n");
    expect(yaml).toContain("action: setFilter\n");
    expect(yaml).toContain('title: "Japan: the tall ones"\n');
    expect(yaml).toContain('filter: [">=", ["get", "elevation"], 2500]\n');
    expect(yaml).toContain("center: [160, 10]\n");
  });

  it("writes a TOML date as a quoted string", async () => {
    const yaml = await text('type = "map"\nid = "m"\nfrom = 2024-01-02\nat = 2024-01-02T10:00:00Z\n', "yaml", "toml");
    expect(yaml).toContain('from: "2024-01-02"');
    expect(yaml).toContain('at: "2024-01-02T10:00:00Z"');
    expect(parseYAML(yaml, { version: "1.1" })).toMatchObject({ from: "2024-01-02", at: "2024-01-02T10:00:00Z" });
  });

  it("wraps a long expression in a flow sequence, a line at a time", async () => {
    const steps = Array.from({ length: 16 }, (_, i) => i * 10).join(", ");
    const doc = `type = "map"\nid = "m"\n[paint]\nfill-color = ["step", ["get", "n"], "#000", ${steps}]\n`;
    const yaml = await text(doc, "yaml", "toml");
    expect(yaml).toContain('  fill-color: [\n    "step", ["get", "n"], "#000",');
    expect(yaml.split("\n").every((line) => line.length <= 80)).toBe(true);
    expect(parseYAML(yaml)).toEqual(authored(doc, "toml"));
  });
});

describe("YAML flow mappings", () => {
  it("quotes a key with a comma inside a flow sequence", async () => {
    const doc = '{"type": "map", "id": "m", "expr": ["literal", [{"a,b": 1, "c": "x, y"}]]}';
    const yaml = await text(doc, "yaml", "json");
    expect(parseYAML(yaml)).toEqual(JSON.parse(doc));
  });
});

describe("the schema hint comment", () => {
  it("is left out when the hint is not one token (a line break would start lines of document)", async () => {
    const { printYaml } = await import("../../src/convert/print-yaml");
    const { printToml } = await import("../../src/convert/print-toml");
    const root = { kind: "map" as const, entries: [{ key: "id", value: { kind: "string" as const, value: "original" } }] };
    for (const bad of ['x\nid = "attacker"', "x\rid: attacker", "a b", "a\tb", "a\u0001b", "a b"]) {
      expect(printYaml(root, bad), JSON.stringify(bad)).toBe("id: original\n");
      expect(printToml(root, bad), JSON.stringify(bad)).toBe('id = "original"\n');
    }
    expect(printToml(root, "https://x.test/s.json")).toBe('#:schema https://x.test/s.json\nid = "original"\n');
  });

  it("JSON writes one $schema when the document has both a modeline and a $schema that stays data", async () => {
    const doc = `# yaml-language-server: $schema=https://x.test/s.json\n$schema: "a b"\ntype: map\nid: m\n`;
    const json = await text(doc, "json", "yaml");
    expect(JSON.parse(json)).toEqual({ $schema: "a b", type: "map", id: "m" });
    expect(json.match(/"\$schema"/g)).toHaveLength(1);
  });
});
