/**
 * @file U1 (ml-4cn): the document-text front door.
 *
 * `parseDocumentText` decides a document's format (explicit format, then
 * script type, URL extension, response URL, content type, then the sniff),
 * reads it, and words every error for that format. YAML results must stay
 * exactly what `YAMLParser` returns; JSON gets JSON wording and hints; TOML
 * is read by its lazy chunk (U3, tests/parser/toml.test.ts).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// The root barrel eagerly loads maplibre-gl, which needs URL.createObjectURL
// (same shim as parse-options.test.ts).
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:document-text";
  w.URL.revokeObjectURL ??= () => {};
});

// The TOML reader is a lazy chunk. Nothing in these tests may ask for it.
vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return { ...actual, getDecoder: vi.fn(actual.getDecoder), prefetchDecoder: vi.fn(actual.prefetchDecoder) };
});

import * as core from "../../src";
import { parseDocumentText, YAMLParser } from "../../src";
import { getDecoder, prefetchDecoder } from "../../src/formats/decoders";
import { wordForJson } from "../../src/components/document-script";

const STYLE = "https://demotiles.maplibre.org/style.json";

const YAML_MAP = `type: map
id: city
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${STYLE}
layers: []
`;

const JSON_MAP = `{
  "type": "map",
  "id": "city",
  "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" },
  "layers": []
}
`;

/** JSON_MAP with the comma after `"id": "city"` deleted: line 4, column 3. */
const JSON_MISSING_COMMA = JSON_MAP.replace('"id": "city",', '"id": "city"');

const TOML_MAP = `type = "map"
id = "city"

[config]
center = [0, 0]
zoom = 2
mapStyle = "${STYLE}"
`;

const jsonLayers = (layers: string) => JSON_MAP.replace('"layers": []', `"layers": ${layers}`);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the public surface", () => {
  it("parseDocumentText is exported from the root barrel; the detector is not", () => {
    expect(typeof core.parseDocumentText).toBe("function");
    expect("detectDocumentFormat" in core).toBe(false);
  });

  it("returns a promise", () => {
    const pending = parseDocumentText(YAML_MAP);
    expect(pending).toBeInstanceOf(Promise);
    return pending;
  });

  it("kind any (the default) returns blockType, result and format", async () => {
    const out = await parseDocumentText(YAML_MAP);
    expect(out.blockType).toBe("map");
    expect(out.format).toBe("yaml");
    expect(out.result.success).toBe(true);
    expect(out.result.format).toBe("yaml");
  });

  it("kind map and kind story return the block result with format", async () => {
    const map = await parseDocumentText(JSON_MAP, { kind: "map" });
    expect(map.success).toBe(true);
    expect(map.format).toBe("json");
    expect(map.data?.type).toBe("map");

    const story = await parseDocumentText(
      `type: scrollytelling
id: s
config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }
chapters:
  - { id: a, title: A, center: [0, 0], zoom: 3 }
`,
      { kind: "story" }
    );
    expect(story.success).toBe(true);
    expect(story.format).toBe("yaml");
    expect(story.data?.type).toBe("scrollytelling");
  });

  it("every error carries the format", async () => {
    const out = await parseDocumentText(JSON_MISSING_COMMA, { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.errors.every((e) => e.format === "json")).toBe(true);
  });
});

describe("detection precedence", () => {
  const formatOf = async (text: string, options: Parameters<typeof parseDocumentText>[1]) =>
    (await parseDocumentText(text, options)).format;

  it("an explicit format beats the script type", async () => {
    expect(
      await formatOf(JSON_MAP, { format: "json", signals: { scriptType: "application/toml", url: "a.toml" } })
    ).toBe("json");
  });

  it("an explicit format beats the sniff, so JSON-looking text read as YAML keeps YAML wording", async () => {
    const out = await parseDocumentText(JSON_MISSING_COMMA, { format: "yaml" });
    expect(out.format).toBe("yaml");
    expect(out.result.errors[0]!.message).toMatch(/^YAML syntax error:/);
  });

  it("the script type beats the URL extension", async () => {
    expect(await formatOf(YAML_MAP, { signals: { scriptType: "text/yaml", url: "a.json" } })).toBe("yaml");
  });

  it("the requested URL beats the response URL and the content type", async () => {
    expect(
      await formatOf(JSON_MAP, {
        signals: { url: "maps/a.json", responseUrl: "https://cdn.example/a.toml", contentType: "application/toml" },
      })
    ).toBe("json");
  });

  it("the response URL counts when the requested URL has no extension", async () => {
    expect(
      await formatOf(JSON_MAP, { signals: { url: "/api/map", responseUrl: "https://cdn.example/maps/a.json" } })
    ).toBe("json");
  });

  it("an extension beats the content type", async () => {
    expect(await formatOf(YAML_MAP, { signals: { url: "a.yaml", contentType: "application/json" } })).toBe("yaml");
  });

  it("the content type beats the sniff", async () => {
    expect(await formatOf(YAML_MAP, { signals: { contentType: "application/toml" } })).toBe("toml");
  });

  it("only the URL's pathname counts: map.toml?v=3 is TOML, a query naming .toml is not", async () => {
    expect(await formatOf(TOML_MAP, { signals: { url: "https://x.example/map.toml?v=3" } })).toBe("toml");
    expect(await formatOf(TOML_MAP, { signals: { url: "map.toml#top" } })).toBe("toml");
    expect(await formatOf(JSON_MAP, { signals: { url: "https://x.example/map.json?as=map.toml" } })).toBe("json");
  });

  it("a file name counts by extension, in any case", async () => {
    expect(await formatOf(YAML_MAP, { signals: { fileName: "maps/city.yml" } })).toBe("yaml");
    expect(await formatOf(TOML_MAP, { signals: { fileName: "C:\\maps\\city.TOML" } })).toBe("toml");
  });

  it("an extension that names no format is no signal", async () => {
    expect(await formatOf(JSON_MAP, { signals: { url: "map.txt" } })).toBe("json");
    expect(await formatOf(YAML_MAP, { signals: { fileName: "README" } })).toBe("yaml");
  });

  it("text/plain and application/octet-stream are no signal", async () => {
    expect(await formatOf(JSON_MAP, { signals: { contentType: "text/plain" } })).toBe("json");
    expect(await formatOf(YAML_MAP, { signals: { contentType: "text/plain; charset=utf-8" } })).toBe("yaml");
    expect(await formatOf(TOML_MAP, { signals: { contentType: "application/octet-stream" } })).toBe("toml");
  });

  it("+json media types count as JSON", async () => {
    expect(await formatOf(YAML_MAP, { signals: { contentType: "application/geo+json" } })).toBe("json");
    expect(await formatOf(YAML_MAP, { signals: { contentType: "application/vnd.example+json" } })).toBe("json");
  });

  it("media type parameters and case are ignored", async () => {
    expect(await formatOf(YAML_MAP, { signals: { contentType: "Application/JSON; charset=UTF-8" } })).toBe("json");
    expect(await formatOf(JSON_MAP, { signals: { contentType: "text/x-yaml; charset=utf-8" } })).toBe("yaml");
    expect(await formatOf(YAML_MAP, { signals: { contentType: "application/toml;charset=utf-8" } })).toBe("toml");
    expect(await formatOf(YAML_MAP, { signals: { scriptType: "TEXT/X-TOML" } })).toBe("toml");
  });

  it("a script type that names no document format is no signal", async () => {
    expect(await formatOf(JSON_MAP, { signals: { scriptType: "module" } })).toBe("json");
  });
});

describe("the sniff", () => {
  it("a byte-order mark then { is JSON, and the mark is stripped", async () => {
    const out = await parseDocumentText(`\ufeff${JSON_MAP}`);
    expect(out.format).toBe("json");
    expect(out.result.success).toBe(true);
  });

  it("a byte-order mark before YAML is stripped", async () => {
    const out = await parseDocumentText(`\ufeff${YAML_MAP}`, { kind: "map", signals: { fileName: "a.yaml" } });
    expect(out.success).toBe(true);
    expect(out.data?.id).toBe("city");
  });

  it("[config] with zoom = 3 under it is TOML", async () => {
    expect((await parseDocumentText("[config]\nzoom = 3\n")).format).toBe("toml");
  });

  it("a full TOML document, with comments and dotted or quoted keys, is TOML", async () => {
    expect((await parseDocumentText(TOML_MAP)).format).toBe("toml");
    expect((await parseDocumentText('# a map\n"type" = "map"\nconfig.zoom = 3\n')).format).toBe("toml");
  });

  it("[config] alone, a YAML flow sequence, stays YAML", async () => {
    expect((await parseDocumentText("[config]\n")).format).toBe("yaml");
  });

  it("YAML whose values contain ' = ' stays YAML", async () => {
    const yaml = YAML_MAP.replace("id: city", "id: city\ntitle: a = b\ndescription: |\n  x = 1\n  y = 2");
    const out = await parseDocumentText(yaml);
    expect(out.format).toBe("yaml");
    expect(out.result.success).toBe(true);
  });

  it("a YAML comment before a flow map stays YAML", async () => {
    const yaml = `# yaml-language-server: $schema=https://docs.maplibre-yaml.org/schema/map.schema.json
{ type: map, id: city, config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }, layers: [] }
`;
    const out = await parseDocumentText(yaml);
    expect(out.format).toBe("yaml");
    expect(out.result.success).toBe(true);
  });

  it("a leading // comment before { is JSON, so the comment hint can fire", async () => {
    const out = await parseDocumentText(`// my map\n${JSON_MAP}`);
    expect(out.format).toBe("json");
    expect(out.result.errors[0]!.message).toContain("comments are not allowed in JSON");
  });

  describe("empty text gives one message in every format", () => {
    const blanks = ["", "   ", "\n\t\n", "\ufeff", "\ufeff  \r\n"];
    const labels = [
      { format: "yaml", signals: {} },
      { format: "yaml", signals: { fileName: "a.yaml" } },
      { format: "json", signals: { url: "a.json" } },
      { format: "toml", signals: { scriptType: "application/toml" } },
    ] as const;

    for (const kind of ["any", "map", "story"] as const) {
      it(`kind ${kind}`, async () => {
        const messages = new Set<string>();
        for (const text of blanks) {
          for (const label of labels) {
            const out = await parseDocumentText(text, { kind, signals: label.signals } as never);
            const result = "result" in out ? out.result : out;
            expect(result.success).toBe(false);
            expect(result.format).toBe(label.format);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]!.format).toBe(label.format);
            messages.add(result.errors[0]!.message);
          }
        }
        expect([...messages]).toEqual(["The document is empty. Add a map or a story to it."]);
      });
    }
  });
});

describe("mislabel hints (R3)", () => {
  it("YAML failing on TOML text says it looks like TOML and how to label it, with no TOML chunk requested", async () => {
    for (const kind of ["any", "map", "story"] as const) {
      const out = await parseDocumentText(TOML_MAP, { kind, signals: { fileName: "map.yaml" } } as never);
      const result = "result" in out ? out.result : out;
      expect(result.success).toBe(false);
      expect(result.format).toBe("yaml");
      expect(result.errors[0]!.message).toContain(
        "Hint: this looks like TOML, not YAML. If it is TOML, name the file .toml or label it application/toml."
      );
    }
    expect(getDecoder).not.toHaveBeenCalled();
    expect(prefetchDecoder).not.toHaveBeenCalled();
  });

  it("the TOML hint keeps the YAML error in front of it, unchanged", async () => {
    const plain = YAMLParser.safeParseMapBlock(TOML_MAP).errors[0]!;
    const out = await parseDocumentText(TOML_MAP, { kind: "map", signals: { scriptType: "text/yaml" } });
    expect(out.errors[0]!.message.startsWith(`${plain.message}\nHint:`)).toBe(true);
    expect(out.errors[0]!.line).toBe(plain.line);
    expect(out.errors[0]!.column).toBe(plain.column);
  });

  it("YAML that fails for an ordinary reason gets no TOML hint", async () => {
    const broken = YAML_MAP.replace("zoom: 2", "zoom: 99");
    const out = await parseDocumentText(broken, { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.errors.map((e) => e.message).join("\n")).not.toContain("TOML");
  });

  it("a .toml label on YAML text says it reads as YAML", async () => {
    const out = await parseDocumentText(YAML_MAP, { signals: { url: "maps/city.toml?v=3" } });
    expect(out.format).toBe("toml");
    expect(out.result.success).toBe(false);
    expect(out.result.errors[0]!.message).toContain(
      "Hint: this reads as YAML, not TOML. If it is YAML, name the file .yaml or label it text/yaml."
    );
  });

  it("a TOML content type on JSON text says it reads as JSON", async () => {
    const out = await parseDocumentText(JSON_MAP, { kind: "map", signals: { contentType: "application/toml" } });
    expect(out.errors[0]!.message).toContain("Hint: this reads as JSON, not TOML.");
  });

  it("sniffed TOML gets no mislabel hint", async () => {
    const out = await parseDocumentText(TOML_MAP);
    expect(out.format).toBe("toml");
    for (const e of [...out.result.errors, ...out.result.warnings]) expect(e.message).not.toContain("Hint: this");
  });
});

describe("TOML goes through its reader chunk (U3)", () => {
  it("reads and validates, naming the format", async () => {
    const out = await parseDocumentText(TOML_MAP, { kind: "map" });
    expect(out.format).toBe("toml");
    expect(out.errors).toEqual([]);
    expect(out.success).toBe(true);
    expect(out.data).toMatchObject({ type: "map", id: "city", config: { zoom: 2 } });
    expect(getDecoder).toHaveBeenCalledWith("toml");
  });
});

describe("never rejects (KTD1)", () => {
  it("an exception inside the parse resolves as an error result", async () => {
    vi.spyOn(YAMLParser, "safeParseMapBlock").mockImplementation(() => {
      throw new Error("boom");
    });
    const out = await parseDocumentText(YAML_MAP, { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.format).toBe("yaml");
    expect(out.errors).toEqual([
      { path: "", message: "The document could not be read: boom", format: "yaml" },
    ]);
  });

  it("an exception in kind any keeps the detected format", async () => {
    vi.spyOn(YAMLParser, "safeParseAny").mockImplementation(() => {
      throw "not an Error";
    });
    const out = await parseDocumentText(JSON_MAP);
    expect(out.blockType).toBe("unknown");
    expect(out.format).toBe("json");
    expect(out.result.errors[0]!.message).toBe("The document could not be read: not an Error");
  });

  it("a value that is not text resolves as an error result", async () => {
    const out = await parseDocumentText(null as unknown as string, { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.errors[0]!.message).toMatch(/^The document could not be read/);
  });
});

describe("JSON wording (R7, R8)", () => {
  it("a missing comma says JSON syntax error at the same line and column from a file, src, a script or a sniff", async () => {
    const sources = [
      { fileName: "maps/city.json" },
      { url: "https://x.example/maps/city.json" },
      { scriptType: "application/json" },
      {},
    ];
    for (const signals of sources) {
      for (const kind of ["any", "map"] as const) {
        const out = await parseDocumentText(JSON_MISSING_COMMA, { kind, signals } as never);
        const err = ("result" in out ? out.result : out).errors[0]!;
        expect(err.message).toMatch(/^JSON syntax error: Missing , between flow map items/);
        expect(err.code).toBe("yaml-syntax");
        expect(err.format).toBe("json");
        expect([err.line, err.column]).toEqual([4, 3]);
      }
    }
  });

  it("uses the same wording as the inline-script path (one implementation)", async () => {
    const element = wordForJson(YAMLParser.safeParseMapBlock(JSON_MISSING_COMMA).errors)[0]!;
    const out = await parseDocumentText(JSON_MISSING_COMMA, { kind: "map", signals: { scriptType: "text/json" } });
    expect(out.errors[0]!.message).toBe(element.message);
  });

  it("a // comment line gets the comment hint at its position", async () => {
    const text = JSON_MAP.replace('"id": "city",', '// the id\n  "id": "city",');
    const out = await parseDocumentText(text, { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({
      code: "yaml-syntax",
      format: "json",
      line: 3,
      column: 3,
      message:
        "JSON syntax error: comments are not allowed in JSON. Remove the comment, " +
        "or write the document in YAML, where # starts a comment.",
    });
  });

  it("a /* block */ comment after a value gets the comment hint", async () => {
    const text = JSON_MAP.replace('"type": "map",', '"type": "map", /* single map */');
    const out = await parseDocumentText(text, { kind: "map" });
    expect(out.errors[0]).toMatchObject({ line: 2, column: 18 });
    expect(out.errors[0]!.message).toContain("comments are not allowed in JSON");
  });

  it("// and /* inside strings are not comments", async () => {
    const text = JSON_MAP.replace('"id": "city",', '"id": "city",\n  "title": "a // b /* c */ \\"d // e\\"",');
    const out = await parseDocumentText(text, { kind: "map" });
    expect(out.success).toBe(true);
  });

  it('"circle-color": #f00 gets a strings-must-be-quoted hint, not the YAML comment hint', async () => {
    const layer = `[{ "id": "a", "type": "circle", "source": { "type": "geojson", "data": "a.geojson" }, "paint": { "circle-color": #f00 } }]`;
    const out = await parseDocumentText(jsonLayers(layer), { kind: "map" });
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toBe('JSON syntax error: strings must be quoted in JSON. Write "#f00", not #f00.');
    expect(out.errors[0]!.line).toBe(5);
    // `  "layers": ` is 12 columns.
    expect(out.errors[0]!.column).toBe(12 + layer.indexOf("#f00") + 1);
    expect(out.errors[0]!.message).not.toContain("YAML");
  });

  it("an unquoted # value on its own line (which YAML reads as an empty value) gets the same hint", async () => {
    const layer = `[{ "id": "a", "type": "circle", "source": { "type": "geojson", "data": "a.geojson" },
    "paint": {
      "circle-color": #ef4444
    } }]`;
    const out = await parseDocumentText(jsonLayers(layer), { kind: "map" });
    expect(out.errors[0]).toMatchObject({
      message: 'JSON syntax error: strings must be quoted in JSON. Write "#ef4444", not #ef4444.',
      line: 7,
      column: 23,
    });
  });

  it("a quoted #hex colour is fine", async () => {
    const layer = `[{ "id": "a", "type": "circle", "source": { "type": "geojson", "data": "a.geojson" }, "paint": { "circle-color": "#f00" } }]`;
    expect((await parseDocumentText(jsonLayers(layer), { kind: "map" })).success).toBe(true);
  });

  it("an unquoted value that breaks the parse gets a strings-must-be-quoted hint", async () => {
    const text = JSON_MAP.replace('"id": "city",', '"id": "city",\n  "title": Rock: the sequel,');
    const out = await parseDocumentText(text, { kind: "map" });
    expect(out.errors[0]!.message).toMatch(/^JSON syntax error:/);
    expect(out.errors[0]!.message).toContain(
      'Hint: strings must be quoted in JSON. Write "Rock: the sequel", not Rock: the sequel (line 4).'
    );
  });

  it("keeps today's leniency: trailing commas and unquoted words the parser reads still pass", async () => {
    const trailing = JSON_MAP.replace('"layers": []', '"layers": [],').replace(`"${STYLE}" }`, `"${STYLE}", }`);
    expect((await parseDocumentText(trailing, { kind: "map" })).success).toBe(true);
    const bare = JSON_MAP.replace('"type": "map"', '"type": map');
    expect((await parseDocumentText(bare, { kind: "map" })).success).toBe(true);
  });

  it('a missing type suggests "type": "map", not type: map', async () => {
    const text = JSON_MAP.replace('"type": "map",\n', "");
    for (const kind of ["any", "map"] as const) {
      const out = await parseDocumentText(text, { kind } as never);
      const err = ("result" in out ? out.result : out).errors[0]!;
      expect(err.path).toBe("type");
      expect(err.message).toBe(
        'The document is missing "type" at the top — add "type": "map" as its first key ' +
          '(or "type": "scrollytelling", for a story).'
      );
      expect(err.message).not.toContain("type: map");
    }
  });

  it('a missing type on a story-shaped document suggests "type": "scrollytelling"', async () => {
    const out = await parseDocumentText(
      `{ "id": "s", "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" }, "chapters": [] }`
    );
    expect(out.result.errors[0]!.message).toBe(
      'The document is missing "type" at the top — add "type": "scrollytelling" as its first key ' +
        '(or "type": "map", for a single map).'
    );
  });

  it("missing keys are spelled as JSON", async () => {
    const noCenter = await parseDocumentText(JSON_MAP.replace('"center": [0, 0], ', ""), { kind: "map" });
    expect(noCenter.errors[0]).toMatchObject({
      path: "config.center",
      message: 'config is missing "center" — add "center": [longitude, latitude].',
      line: 4,
      column: 13,
    });

    const noConfig = await parseDocumentText('{ "type": "map", "id": "city" }', { kind: "map" });
    expect(noConfig.errors[0]!.message).toBe(
      'The document is missing "config" — add a "config" object with "center", "zoom" and "mapStyle".'
    );

    const noChapterId = await parseDocumentText(
      `{ "type": "scrollytelling", "id": "s", "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" },
  "chapters": [{ "title": "A", "center": [0, 0], "zoom": 3 }] }`,
      { kind: "story" }
    );
    expect(noChapterId.errors.map((e) => e.message)).toContain(
      'Chapter 1 is missing "id" — add "id": "a-short-name".'
    );
  });

  it("an undeterminable document is spelled as JSON", async () => {
    const out = await parseDocumentText('{ "id": "x" }');
    expect(out.result.errors[0]!.message).toBe(
      'Unable to determine document type. Expected an object with "type": "map" or ' +
        '"type": "scrollytelling", or a root document with a top-level "pages" array.'
    );
  });

  it("a duplicate key is an error with a position", async () => {
    const text = JSON_MAP.replace('"id": "city",', '"id": "city",\n  "id": "town",');
    const out = await parseDocumentText(text, { kind: "map", signals: { fileName: "a.json" } });
    expect(out.success).toBe(false);
    expect(out.errors[0]).toMatchObject({ code: "yaml-syntax", format: "json", line: 4, column: 3 });
    expect(out.errors[0]!.message).toMatch(/^JSON syntax error: Map keys must be unique/);
  });

  it("a JSON label on YAML text is not lexed as JSON (its # comments are not 'unquoted strings')", async () => {
    const out = await parseDocumentText(`# a comment\n${YAML_MAP}`, { kind: "map", signals: { fileName: "a.json" } });
    expect(out.format).toBe("json");
    expect(out.success).toBe(true);
  });

  it("the same document in JSON and YAML gives the same data (R4)", async () => {
    const fromJson = await parseDocumentText(JSON_MAP, { kind: "map" });
    const fromYaml = await parseDocumentText(YAML_MAP, { kind: "map" });
    expect(fromJson.data).toEqual(fromYaml.data);
    expect(fromJson.warnings).toEqual(fromYaml.warnings);
  });
});

describe("YAML results are exactly YAMLParser's, plus format", () => {
  const withFormat = (errors: { [k: string]: unknown }[]) => errors.map((e) => ({ ...e, format: "yaml" }));

  const docs = {
    valid: YAML_MAP,
    "bad zoom": YAML_MAP.replace("zoom: 2", "zoom: 99"),
    "syntax error": YAML_MAP.replace("id: city", 'id: "city'),
    "unquoted hash": YAML_MAP.replace("layers: []", 'layers:\n  - id: a\n    type: circle\n    source: { type: geojson, data: a.geojson }\n    paint:\n      circle-color: #f00'),
    "missing type": YAML_MAP.replace("type: map\n", ""),
    "unknown key": YAML_MAP.replace("zoom: 2", "zoom: 2\n  zom: 3"),
  };

  for (const [name, text] of Object.entries(docs)) {
    it(name, async () => {
      const any = await parseDocumentText(text, { signals: { fileName: "map.yaml" } });
      const expected = YAMLParser.safeParseAny(text);
      expect(any.blockType).toBe(expected.blockType);
      expect(any.result.errors).toEqual(withFormat(expected.result.errors as never));
      expect(any.result.warnings).toEqual(expected.result.warnings);
      expect(any.result.data).toEqual(expected.result.data);

      const map = await parseDocumentText(text, { kind: "map" });
      const expectedMap = YAMLParser.safeParseMapBlock(text);
      expect(map.errors).toEqual(withFormat(expectedMap.errors as never));
      expect(map.warnings).toEqual(expectedMap.warnings);
    });
  }
});
