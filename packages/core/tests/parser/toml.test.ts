/**
 * @file U3 (ml-4cn.8): TOML documents, read by the lazy `toml` chunk.
 *
 * A TOML document is read into a plain value plus a position index, then
 * validated by the same pipeline as YAML (the value entry points, with the
 * index registered for their synthetic YAML), so every finding is YAML's
 * finding at the TOML line and column (AE2). The four documents of the
 * research's side-by-side section (§10) are the fixtures: unplanted they
 * validate clean and equal their YAML originals; planted with §8's mistakes
 * they give YAML's findings at TOML positions.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYAML } from "yaml";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:toml";
  w.URL.revokeObjectURL ??= () => {};
});

vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return { ...actual, getDecoder: vi.fn(actual.getDecoder) };
});

import { parseDocumentText, YAMLParser, YAML_PARSE_OPTIONS } from "../../src";
import { getDecoder } from "../../src/formats/decoders";
import { FormatError } from "../../src/formats/errors";
import { readToml } from "../../src/parser/toml/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/toml");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const STYLE = "https://demotiles.maplibre.org/style.json";
const EMPTY_SOURCE = '{ type = "geojson", data = { type = "FeatureCollection", features = [] } }';

/** A minimal TOML map with `layer` as its one layer's extra lines. */
const tomlMap = (layer: string, head = "") => `type = "map"
id = "m"
${head}
[config]
center = [0, 0]
zoom = 2
mapStyle = "${STYLE}"

[[layers]]
id = "a"
type = "circle"
source = ${EMPTY_SOURCE}
${layer}`;

const asToml = (text: string, kind: "map" | "story" = "map") =>
  parseDocumentText(text, { kind, format: "toml" } as never) as Promise<
    Awaited<ReturnType<typeof YAMLParser.safeParseMapBlock>> & { format: string }
  >;

/** Path, message and suggestion: what must match between formats. */
const finding = ({ path, message, suggestion }: { path: string; message: string; suggestion?: string }) => ({
  path,
  message,
  ...(suggestion !== undefined ? { suggestion } : {}),
});

const all = (r: { errors: { message: string }[]; warnings: { message: string }[] }) =>
  [...r.errors, ...r.warnings].map((f) => f.message).join("\n");

afterEach(() => {
  vi.mocked(getDecoder).mockClear();
});

describe("AE2: planted mistakes give YAML's findings at TOML positions", () => {
  it("config.zoom at 7:8, paitn at 19:1 (its header), max-fraction-digit at its key inside the inline table", async () => {
    const toml = await asToml(fixture("quick-start-planted.toml"));
    const yaml = YAMLParser.safeParseMapBlock(fixture("quick-start-planted.yaml"));
    expect(toml.success).toBe(false);
    expect(toml.format).toBe("toml");
    expect(toml.errors.map(finding)).toEqual(yaml.errors.map(finding));
    expect(toml.warnings.map(finding)).toEqual(yaml.warnings.map(finding));

    expect(toml.errors).toHaveLength(1);
    expect(toml.errors[0]).toMatchObject({ path: "config.zoom", line: 7, column: 8, format: "toml" });
    const [paitn, fraction] = toml.warnings;
    expect(paitn).toMatchObject({ path: "layers.0.paitn", suggestion: "paint", line: 19, column: 1 });
    // Line 35: `  { property = "mag", format = { max-fraction-digit = 1 } },`.
    // The unknown-key helper asks for the key, as it does in YAML (the
    // research prototype re-attached by path, so it showed the value, 35:55).
    const line35 = fixture("quick-start-planted.toml").split("\n")[34]!;
    expect(fraction).toMatchObject({
      path: "layers.0.interactive.click.popup.1.p.1.format.max-fraction-digit",
      suggestion: "max-fraction-digits",
      line: 35,
      column: line35.indexOf("max-fraction-digit") + 1,
    });
    expect(fraction!.column).toBe(34);
  });

  it("circel: the unknown layer type at the [[layers]] header (14:1)", async () => {
    const toml = await asToml(fixture("quick-start.toml").replace('type = "circle"', 'type = "circel"'));
    const yaml = YAMLParser.safeParseMapBlock(fixture("quick-start.yaml").replace("type: circle", "type: circel"));
    expect(toml.errors.map(finding)).toEqual(yaml.errors.map(finding));
    expect(toml.errors).toHaveLength(1);
    expect(toml.errors[0]).toMatchObject({ path: "layers.0", line: 14, column: 1 });
    expect(toml.errors[0]!.message).toContain('Unknown layer type "circel"');
  });

  it("a missing key points at the nearest table that exists (its header)", async () => {
    const toml = await asToml(fixture("quick-start.toml").replace("zoom = 1\n", ""));
    expect(toml.success).toBe(false);
    expect(toml.errors[0]).toMatchObject({ path: "config.zoom", line: 5, column: 1 });
  });

  it("two layers with one id: the duplicate-id message quotes the TOML lines", async () => {
    const text = tomlMap(`\n[[layers]]\nid = "a"\ntype = "circle"\nsource = ${EMPTY_SOURCE}\n`);
    // Lines: the first layer's id is line 10, the second's line 15.
    expect(text.split("\n")[9]).toBe('id = "a"');
    expect(text.split("\n")[14]).toBe('id = "a"');
    const toml = await asToml(text);
    const dup = toml.warnings.find((w) => w.path === "layers.1.id");
    expect(dup?.message).toContain("(lines 10 and 15)");
    expect(dup).toMatchObject({ line: 15, column: 6 });
  });
});

describe("the research documents (§10)", () => {
  const docs = [
    ["quick-start", "map"],
    ["choropleth", "map"],
    ["story", "story"],
    ["locale", "map"],
  ] as const;

  for (const [name, kind] of docs) {
    it(`${name}: validates clean and equals its YAML original`, async () => {
      const toml = await asToml(fixture(`${name}.toml`), kind);
      const yamlText = fixture(`${name}.yaml`);
      const yaml =
        kind === "map" ? YAMLParser.safeParseMapBlock(yamlText) : YAMLParser.safeParseScrollytellingBlock(yamlText);
      expect(toml.errors).toEqual([]);
      expect(toml.success).toBe(true);
      expect(toml.warnings.map(finding)).toEqual(yaml.warnings.map(finding));

      const read = readToml(fixture(`${name}.toml`));
      if (!read.ok) throw new Error(read.error.message);
      const authored = parseYAML(yamlText, YAML_PARSE_OPTIONS);
      if (name === "story") {
        // §9: TOML has no null; the TOML document leaves `filter` out instead.
        expect(authored.chapters[1].onChapterExit[0].filter).toBeNull();
        delete authored.chapters[1].onChapterExit[0].filter;
        delete (yaml.data as any).chapters[1].onChapterExit[0].filter;
      }
      expect(read.value).toEqual(authored);
      expect(toml.data).toEqual(yaml.data);
    });
  }

  it("the reader answers positions for array elements and inline-table entries", () => {
    const read = readToml(fixture("quick-start.toml"));
    if (!read.ok) throw new Error(read.error.message);
    // `circle-radius = ["interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20]` (line 20)
    const lines = fixture("quick-start.toml").split("\n");
    expect(read.positions.valueAt(["layers", 0, "paint", "circle-radius", 2, 1])).toEqual({
      line: 20,
      column: lines[19]!.indexOf('"mag"') + 1,
    });
    expect(read.positions.keyAt(["layers", 0, "paint", "circle-radius"])).toEqual({ line: 20, column: 1 });
    // `source = { type = "geojson", url = … }` (line 17)
    expect(read.positions.keyAt(["layers", 0, "source", "url"])).toEqual({ line: 17, column: lines[16]!.indexOf("url") + 1 });
    expect(read.positions.valueAt(["layers", 0, "source", "type"])).toEqual({ line: 17, column: 19 });
    // Elements of a multi-line inline array keep their own lines.
    expect(read.positions.valueAt(["layers", 0, "interactive", "click", "popup", 1, "p", 1])).toEqual({
      line: 35,
      column: 3,
    });
    // Nothing there: the nearest ancestor that exists.
    expect(read.positions.valueAt(["config", "nope", 3])).toEqual({ line: 5, column: 1 });
    expect(read.positions.keyAt(["config", "nope"])).toBeUndefined();
    // String segments work for array indices, as dotted paths give them.
    expect(read.positions.valueAt(["layers", "0", "id"])).toEqual({ line: 15, column: 6 });
  });
});

describe("AE7: dates become their source text", () => {
  const dates = `type = "map"
id = "dates"
title = 2024-01-02

[config]
center = [0, 0]
zoom = 2
mapStyle = "${STYLE}"

[[layers]]
id = "d"
type = "circle"
metadata = { when = 2024-01-02, at = [1979-05-27T07:32:00-08:00, 1979-05-27T07:32:00, 07:32:00.5, 1979-05-27 07:32:00Z] }
source = { type = "geojson", data = { type = "FeatureCollection", features = [
  { type = "Feature", geometry = { type = "Point", coordinates = [0, 0] }, properties = { day = 2024-01-02, times = [{ t = 07:32:00 }] } },
] } }
`;

  it("bare dates, offset and local datetimes and local times, in arrays and inline tables", async () => {
    const read = readToml(dates);
    if (!read.ok) throw new Error(read.error.message);
    const layer = (read.value as any).layers[0];
    expect((read.value as any).title).toBe("2024-01-02");
    expect(layer.metadata).toEqual({
      when: "2024-01-02",
      at: ["1979-05-27T07:32:00-08:00", "1979-05-27T07:32:00", "07:32:00.5", "1979-05-27 07:32:00Z"],
    });
    expect(layer.source.data.features[0].properties).toEqual({ day: "2024-01-02", times: [{ t: "07:32:00" }] });

    const result = await asToml(dates);
    expect(result.errors).toEqual([]);
    expect((result.data as any).title).toBe("2024-01-02");
  });
});

describe("R9: integer-like categories keep their authored order", () => {
  it("10, 2, 1 stays 10, 2, 1, as in YAML", async () => {
    const toml = await asToml(
      tomlMap(`
[layers.classify]
field = "kind"

[layers.classify.categories]
10 = "#ff0000"
2 = "#00ff00"
1 = "#0000ff"
`)
    );
    expect(toml.errors).toEqual([]);
    const classify = (toml.data as any).layers[0].classify;
    expect(classify.categories).toEqual(["10", "2", "1"]);
    expect(classify.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);

    const yaml = YAMLParser.safeParseMapBlock(`type: map
id: m
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }
layers:
  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    classify:
      field: kind
      categories: { 10: "#ff0000", 2: "#00ff00", 1: "#0000ff" }
`);
    expect(classify).toEqual((yaml.data as any).layers[0].classify);
  });
});

describe("TOML hints (R8)", () => {
  it("an unquoted colour is a toml-syntax error at its line, with the quoting hint", async () => {
    const text = tomlMap("[layers.paint]\ncircle-color = #fff\n");
    const out = await asToml(text);
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    const [err] = out.errors;
    expect(err).toMatchObject({ code: "toml-syntax", format: "toml", line: 14, column: 16 });
    expect(err!.message).toMatch(/^TOML syntax error: /);
    expect(err!.message).toContain('circle-color = "#fff"');
    expect(err!.message).toContain("# starts a comment");
  });

  it("filter = null gets the omit-the-key hint", async () => {
    const out = await asToml(tomlMap('filter = null\n'));
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ code: "toml-syntax", line: 13, column: 10 });
    expect(out.errors[0]!.message).toContain("TOML has no null");
    expect(out.errors[0]!.message).toContain("leave `filter` out");
  });

  it("an unquoted dotted locale key validates through flattening (no hint needed)", async () => {
    const out = await asToml(
      tomlMap("", "").replace(
        `mapStyle = "${STYLE}"\n`,
        `mapStyle = "${STYLE}"\n\n[config.locale]\nmaplibre-yaml.Legend.Title = "Leyenda"\n"Popup.Close" = "Cerrar"\n`
      )
    );
    expect(out.errors).toEqual([]);
    expect(out.success).toBe(true);
    expect((out.data as any).config.locale).toEqual({ "maplibre-yaml.Legend.Title": "Leyenda", "Popup.Close": "Cerrar" });
    expect(all(out)).not.toContain("Hint:");
  });

  it("a legitimate dotted key (paint.circle-color = …) gets no hint", async () => {
    const out = await asToml(tomlMap('paint.circle-color = "red"\npaint.circle-radius = 4\n'));
    expect(out.errors).toEqual([]);
    expect(out.success).toBe(true);
    expect((out.data as any).layers[0].paint).toEqual({ "circle-color": "red", "circle-radius": 4 });
    expect(all(out)).not.toContain("Hint:");
  });

  it("a dotted key that nested where one key was meant gets the quoting hint", async () => {
    const out = await asToml(
      tomlMap(`
[layers.classify]
field = "kind"

[layers.classify.categories]
1.5 = "#ff0000"
"2" = "#00ff00"
`)
    );
    expect(out.success).toBe(false);
    const err = out.errors.find((e) => e.path === "layers.0.classify.categories.1");
    expect(err?.message).toContain("Expected string, got object");
    expect(err?.message).toContain('Hint: TOML reads the dots in 1.5 as nesting');
    expect(err?.message).toContain('"1.5" = …');
    expect(err).toMatchObject({ line: 18, column: 1 });
  });

  it("a layer key written after [layers.paint] gets the move-above hint", async () => {
    const out = await asToml(tomlMap('[layers.paint]\ncircle-color = "red"\nminzoom = 3\n'));
    const minzoom = out.warnings.find((w) => w.path === "layers.0.paint.minzoom");
    expect(minzoom?.message).toContain('Unknown key "minzoom"');
    expect(minzoom?.message).toContain("Hint: in TOML every key after [layers.paint] belongs to it");
    expect(minzoom?.message).toContain("move it above [layers.paint]");
    expect(minzoom).toMatchObject({ line: 15, column: 1 });
  });

  it("a config key written after [config.locale] gets the move-above hint where config misses it", async () => {
    const out = await asToml(
      tomlMap("").replace(`mapStyle = "${STYLE}"\n`, `\n[config.locale]\n"Popup.Close" = "Cerrar"\nmapStyle = "${STYLE}"\n`)
    );
    const missing = out.warnings.find((w) => w.path === "config.mapStyle");
    expect(missing?.message).toContain("No mapStyle");
    expect(missing?.message).toContain(
      'Hint: in TOML every key after [config.locale] belongs to it, until the next header. "mapStyle" was written there: move it above [config.locale].'
    );
  });

  it("the same key written where it belongs gets no hint", async () => {
    const out = await asToml(tomlMap('minzoom = 3\n[layers.paint]\ncircle-color = "red"\n'));
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});

describe("syntax errors", () => {
  it("are toml-syntax results with 1-based positions", async () => {
    const out = await asToml('type = "map"\nid "m"\n');
    expect(out.success).toBe(false);
    expect(out.errors).toEqual([
      expect.objectContaining({ path: "", code: "toml-syntax", format: "toml", line: 2, column: 4 }),
    ]);
    expect(out.errors[0]!.message).toMatch(/^TOML syntax error: /);
  });

  it("a key defined twice", async () => {
    const out = await asToml('type = "map"\ntype = "map"\n');
    expect(out.errors[0]).toMatchObject({ code: "toml-syntax", line: 2 });
  });

  it("an array nested 10,000 levels deep resolves as one toml-syntax error", async () => {
    const deep = `type = "map"\nx = ${"[".repeat(10000)}${"]".repeat(10000)}\n`;
    const out = await asToml(deep);
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ code: "toml-syntax", line: 2 });
    expect(out.errors[0]!.message).toContain("512");
  });

  it("deep inline tables and long dotted keys hit the same cap", async () => {
    for (const text of [
      `x = ${"{ a = ".repeat(600)}1${" }".repeat(600)}\n`,
      `${Array.from({ length: 600 }, () => "a").join(".")} = 1\n`,
      `[${Array.from({ length: 600 }, () => "a").join(".")}]\n`,
    ]) {
      const out = await asToml(text);
      expect(out.errors).toHaveLength(1);
      expect(out.errors[0]).toMatchObject({ code: "toml-syntax" });
      expect(out.errors[0]!.message).toContain("512");
    }
  });

  it("YAML labelled TOML still says it reads as YAML", async () => {
    const out = await parseDocumentText(fixture("quick-start.yaml"), { kind: "map", signals: { url: "a.toml" } });
    expect(out.format).toBe("toml");
    expect(out.errors[0]).toMatchObject({ code: "toml-syntax" });
    expect(out.errors[0]!.message).toContain("Hint: this reads as YAML, not TOML.");
  });
});

describe("prototype safety", () => {
  // Each TOML spelling, and the same document in YAML.
  const cases = [
    ["[__proto__]\nb = 1\n", "__proto__", "__proto__: { b: 1 }"],
    ["a.__proto__.b = 1\n", "a", "a: { __proto__: { b: 1 } }"],
    ["[[__proto__]]\nb = 1\n", "__proto__", "__proto__: [{ b: 1 }]"],
    ["[constructor.prototype]\nb = 1\n", "constructor", "constructor: { prototype: { b: 1 } }"],
  ] as const;

  for (const [extra, key, yamlLine] of cases) {
    it(`${JSON.stringify(extra)} leaves Object.prototype alone and reaches validation as the key "${key}"`, async () => {
      const before = Object.getOwnPropertyNames(Object.prototype).sort();
      const text = `type = "map"\nid = "m"\n${extra}\n[config]\ncenter = [0, 0]\nzoom = 2\nmapStyle = "${STYLE}"\n`;
      const read = readToml(text);
      if (!read.ok) throw new Error(read.error.message);
      // An own key holding plain data, on an ordinary object.
      expect(Object.getOwnPropertyNames(read.value)).toEqual(["type", "id", key, "config"]);
      expect(Object.getPrototypeOf(read.value)).toBe(Object.prototype);
      const held = Object.getOwnPropertyDescriptor(read.value, key)!.value;
      expect(JSON.parse(JSON.stringify(held))).toEqual(parseYAML(yamlLine)[key]);

      const out = await asToml(text);
      expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
      expect(({} as any).b).toBeUndefined();
      expect(({} as any).prototype).toBeUndefined();
      // Validation sees the key exactly as it sees the YAML spelling.
      const yaml = YAMLParser.safeParseMapBlock(
        `type: map\nid: m\n${yamlLine}\nconfig: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }\n`
      );
      expect(out.success).toBe(yaml.success);
      // (`a.__proto__.b` also gets the dotted-key hint: one dotted key made `a`.)
      const unhinted = out.warnings.map((w) => finding({ ...w, message: w.message.split("\nHint: ")[0]! }));
      expect(unhinted).toEqual(yaml.warnings.map(finding));
      expect(Object.getOwnPropertyNames(out.data)).toEqual(Object.getOwnPropertyNames(yaml.data));
    });
  }
});

describe("kinds and the chunk", () => {
  it("kind any dispatches on type, and reads the TOML chunk once", async () => {
    const map = await parseDocumentText(fixture("quick-start.toml"));
    const story = await parseDocumentText(fixture("story.toml"));
    expect(map).toMatchObject({ blockType: "map", format: "toml", result: { success: true, format: "toml" } });
    expect(story).toMatchObject({ blockType: "scrollytelling", format: "toml", result: { success: true } });
    expect(vi.mocked(getDecoder).mock.calls.every(([name]) => name === "toml")).toBe(true);
  });

  it("kind any: an unknown type names the choices", async () => {
    const out = await parseDocumentText('type = "mpa"\n', { format: "toml" });
    expect(out.blockType).toBe("unknown");
    expect(out.result.errors[0]!.message).toContain('Did you mean "map"?');
  });

  it("a chunk that can't be downloaded rejects with the chunk FormatError (the only rejection)", async () => {
    const failure = new FormatError({ code: "chunk", format: "toml" as never, url: "chunks/toml.js" });
    vi.mocked(getDecoder).mockRejectedValueOnce(failure);
    await expect(parseDocumentText(fixture("quick-start.toml"), { kind: "map", format: "toml" })).rejects.toBe(failure);
  });
});
