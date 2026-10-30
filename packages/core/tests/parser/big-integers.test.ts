/**
 * @file ml-4cn.12: an integer the document can't keep exactly warns at its key.
 *
 * A JavaScript number holds integers exactly only up to 2^53. Past that, the
 * value read has already lost digits: a feature id `12345678901234567890`
 * reads as `12345678901234567000`. The warning is at the key (an array
 * element: at the element). `mlym convert` refuses the same integers.
 *
 * TOML's reader knows the digits as written, so every TOML parse warns,
 * browser included. YAML's and JSON's come from `bigIntegerWarnings`, which
 * `mlym validate` calls and the elements don't (the CDN entry doesn't carry
 * it, tests/lazy-chunks.test.ts): the parser itself doesn't warn for them.
 */

import { describe, it, expect } from "vitest";
import { bigIntegerWarnings, parseDocumentText, YAMLParser } from "../../src/parser/index";
import { readToml } from "../../src/parser/toml/index";

const STYLE = "https://demotiles.maplibre.org/style.json";
const BIG = "12345678901234567890";
const message = (digits: string, lossy: string) =>
  `${digits} is beyond the integers a number keeps exactly (2^53), so it reads as ${lossy}. ` +
  `Write it as a string ("${digits}") if it's an id.`;
const ID_PATH = "layers.0.source.data.features.0.id";

/** The same map in each format, with feature id `id` and a filter comparing against `id`. */
const docs = (id: string) => ({
  yaml: [
    "type: map",
    "id: m",
    `config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }`,
    "layers:",
    "  - id: a",
    "    type: circle",
    `    filter: ["==", ["id"], ${id}]`,
    "    source:",
    "      type: geojson",
    "      data:",
    "        type: FeatureCollection",
    "        features:",
    "          - type: Feature",
    `            id: ${id}`,
    "            geometry: { type: Point, coordinates: [0, 0] }",
    "            properties: {}",
    "",
  ].join("\n"),
  json: [
    "{",
    '  "type": "map",',
    '  "id": "m",',
    `  "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" },`,
    '  "layers": [{',
    '    "id": "a",',
    '    "type": "circle",',
    `    "filter": ["==", ["id"], ${id}],`,
    '    "source": {',
    '      "type": "geojson",',
    '      "data": {',
    '        "type": "FeatureCollection",',
    '        "features": [{',
    '          "type": "Feature",',
    `          "id": ${id},`,
    '          "geometry": { "type": "Point", "coordinates": [0, 0] },',
    '          "properties": {}',
    "        }]",
    "      }",
    "    }",
    "  }]",
    "}",
    "",
  ].join("\n"),
  toml: [
    'type = "map"',
    'id = "m"',
    "",
    "[config]",
    "center = [0, 0]",
    "zoom = 2",
    `mapStyle = "${STYLE}"`,
    "",
    "[[layers]]",
    'id = "a"',
    'type = "circle"',
    `filter = ["==", ["id"], ${id}]`,
    "",
    "[layers.source]",
    'type = "geojson"',
    "",
    "[layers.source.data]",
    'type = "FeatureCollection"',
    "",
    "[[layers.source.data.features]]",
    'type = "Feature"',
    `id = ${id}`,
    'geometry = { type = "Point", coordinates = [0, 0] }',
    "properties = {}",
    "",
  ].join("\n"),
});

/** 1-based line and column of the first line matching `re`, at `re`'s match (or the line's first character). */
function at(text: string, re: RegExp, offset: (line: string) => number = (l) => l.search(/\S/)) {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => re.test(l));
  return { line: line + 1, column: offset(lines[line]!) + 1 };
}

const bigWarnings = (warnings: { message: string }[]) =>
  warnings.filter((w) => w.message.includes("beyond the integers a number keeps exactly"));

/** The big-integer warnings for `text`: the parser's for TOML, `bigIntegerWarnings` for YAML and JSON. */
async function warningsFor(format: string, text: string) {
  if (format !== "toml") return bigWarnings(bigIntegerWarnings(text));
  const result = await parseDocumentText(text, { kind: "map", format: "toml" });
  expect(result.errors).toEqual([]);
  expect(result.success).toBe(true);
  return bigWarnings(result.warnings);
}

describe("ml-4cn.12: integers past 2^53 warn where they are written", () => {
  for (const [format, text] of Object.entries(docs(BIG))) {
    it(`${format}: the feature id warns at its key, the filter's at the element`, async () => {
      const found = await warningsFor(format, text);
      expect(found).toHaveLength(2);
      expect(found).toContainEqual({
        path: ID_PATH,
        message: message(BIG, "12345678901234567000"),
        ...at(text, /^\s*"?id"?\s*[:=]\s*1/),
      });
      expect(found).toContainEqual({
        path: "layers.0.filter.2",
        message: message(BIG, "12345678901234567000"),
        ...at(text, /"?filter"?\s*[:=]/, (l) => l.indexOf(BIG)),
      });
    });
  }

  it("a negative integer and TOML's hex and underscores are named as written", async () => {
    for (const [format, id, lossy] of [
      ["yaml", `-${BIG}`, "-12345678901234567000"],
      ["json", `-${BIG}`, "-12345678901234567000"],
      ["toml", `-${BIG}`, "-12345678901234567000"],
      ["yaml", "0x20000000000001", "9007199254740992"],
      ["toml", "0x20000000000001", "9007199254740992"],
      ["toml", "9_007_199_254_740_993", "9007199254740992"],
    ] as const) {
      const found = await warningsFor(format, docs(id)[format]);
      expect(found.map((w) => [w.path, w.message]), `${format} ${id}`).toContainEqual([ID_PATH, message(id, lossy)]);
    }
  });

  it("integers a number keeps exactly, floats and strings give no warning", async () => {
    for (const id of ["9007199254740991", "-9007199254740991", "9007199254740992", "18014398509481984", "1.5e300", `"${BIG}"`]) {
      for (const [format, text] of Object.entries(docs(id))) {
        expect(await warningsFor(format, text), `${format} ${id}`).toEqual([]);
      }
    }
  });

  it("TOML warns once (its validation YAML holds the number as read, which is exact)", async () => {
    const result = await parseDocumentText(docs(BIG).toml, { kind: "map", format: "toml" });
    expect(bigWarnings(result.warnings).filter((w) => w.path === ID_PATH)).toHaveLength(1);
  });

  it("the parser doesn't warn for YAML or JSON (the browser doesn't carry the walk); TOML's warn with kind any too", async () => {
    for (const [format, text] of Object.entries(docs(BIG))) {
      for (const kind of ["map", undefined] as const) {
        const out = await parseDocumentText(text, { ...(kind ? { kind } : {}), format: format as never });
        const warnings = "result" in out ? out.result.warnings : out.warnings;
        expect(bigWarnings(warnings).map((w) => w.path).sort(), `${format} ${kind ?? "any"}`).toEqual(
          format === "toml" ? ["layers.0.filter.2", ID_PATH].sort() : []
        );
      }
    }
    expect(bigWarnings(YAMLParser.safeParseMapBlock(docs(BIG).yaml).warnings)).toEqual([]);
  });

  it("bigIntegerWarnings strips a byte-order mark and reads text that isn't valid YAML without throwing", () => {
    expect(bigIntegerWarnings(`\uFEFFid: ${BIG}\n`)).toEqual([
      { path: "id", message: message(BIG, "12345678901234567000"), line: 1, column: 1 },
    ]);
    expect(() => bigIntegerWarnings("a: [1, \n")).not.toThrow();
    expect(bigIntegerWarnings(String(BIG))).toEqual([
      { path: "", message: message(BIG, "12345678901234567000"), line: 1, column: 1 },
    ]);
  });

  it("the value entry points don't guess: a number handed in as a number is taken as it is", () => {
    const yaml = YAMLParser.safeParseMapBlock(docs(BIG).yaml);
    expect(yaml.success).toBe(true);
    const result = YAMLParser.safeParseMapBlockValue(yaml.data);
    expect(bigWarnings(result.warnings)).toEqual([]);
  });

  it("the TOML reader keeps the number JavaScript reads", () => {
    const read = readToml(`id = ${BIG}\n`);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value["id"]).toBe(Number(BIG));
  });
});
