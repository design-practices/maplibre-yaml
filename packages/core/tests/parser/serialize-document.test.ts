/**
 * @file `serializeDocument`: a parsed document as attribute text the element reads back whole (ml-vwz review P1)
 * @module @maplibre-yaml/core/tests/parser
 *
 * @description
 * The Astro components and `<ml-scrollytelling>` hand a server-parsed
 * document to `<ml-map>` through its `config` attribute. `JSON.stringify`
 * turns `Infinity` into `null`, so an open-longitude `maxBounds`
 * (`[-.inf, -60, .inf, 75]`) arrived as `[null, -60, null, 75]` and the
 * element refused it. `serializeDocument` writes JSON-shaped text that the
 * attribute parser (YAML; JSON is YAML) reads back with the infinities as
 * `.inf` / `-.inf` tokens, and is byte-identical to `JSON.stringify` for a
 * document without any.
 */
import { describe, it, expect } from "vitest";
import { serializeDocument } from "../../src/parser/serialize-document";
import { parseDocumentText } from "../../src/parser/document-text";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { boundsProblem } from "../../src/utils/bounds";

const DOC = {
  type: "map",
  id: "band",
  config: { center: [0, 30], zoom: 2, maxBounds: [-Infinity, -60, Infinity, 75], mapStyle: "https://example.com/style.json" },
  layers: [],
};

describe("serializeDocument", () => {
  it("is JSON.stringify for a document without infinities", () => {
    const plain = { type: "map", id: "m", config: { center: [0, 0], zoom: 2, mapStyle: "s" }, layers: [], note: 'has ".inf" in a string' };
    expect(serializeDocument(plain)).toBe(JSON.stringify(plain));
  });

  it("writes ±Infinity as the bare YAML tokens .inf / -.inf, nested anywhere", () => {
    const text = serializeDocument({ a: [-Infinity, { b: Infinity, c: [[Infinity]] }], d: "Infinity", e: "-.inf" });
    expect(text).toBe('{"a":[-.inf,{"b":.inf,"c":[[.inf]]}],"d":"Infinity","e":"-.inf"}');
  });

  it("has no NaN in it (JSON's null, as before)", () => {
    expect(serializeDocument({ n: NaN, m: [NaN] })).toBe('{"n":null,"m":[null]}');
  });

  it("round-trips an open-longitude maxBounds through the attribute parser (document text, any format)", async () => {
    const text = serializeDocument(DOC);
    expect(text).toContain('"maxBounds":[-.inf,-60,.inf,75]');
    const read = await parseDocumentText(text, { kind: "map" });
    expect(read.format).toBe("json");
    expect(read.success, JSON.stringify(read)).toBe(true);
    expect((read as any).data.config.maxBounds).toEqual([-Infinity, -60, Infinity, 75]);
    // And through the map-block parser directly, as the element's readText does.
    const block = YAMLParser.safeParseMapBlock(text);
    expect(block.success).toBe(true);
    expect((block.data as any).config.maxBounds).toEqual([-Infinity, -60, Infinity, 75]);
  });

  it("the corner form round-trips too", () => {
    const text = serializeDocument({ ...DOC, config: { ...DOC.config, maxBounds: [[-Infinity, -60], [Infinity, 75]] } });
    const block = YAMLParser.safeParseMapBlock(text);
    expect(block.success).toBe(true);
    expect((block.data as any).config.maxBounds).toEqual([[-Infinity, -60], [Infinity, 75]]);
  });
});

describe("boundsProblem: what JSON and a bare word do to an open longitude", () => {
  it("null in the longitude slots (JSON.stringify of Infinity) says to pass YAML text", () => {
    for (const value of [[null, -60, null, 75], [[null, -60], [null, 75]]]) {
      const problem = boundsProblem(value, "maxBounds");
      expect(problem).toContain("does not survive JSON");
      expect(problem).toContain("YAML");
      expect(problem).toContain("-.inf");
    }
  });

  it('the strings "Infinity" / "-Infinity" / "inf" in a longitude slot point at -.inf / .inf', () => {
    for (const value of [["-Infinity", -60, "Infinity", 75], ["-inf", -60, "inf", 75], [["-Infinity", -60], ["Infinity", 75]]]) {
      const problem = boundsProblem(value, "maxBounds");
      expect(problem, JSON.stringify(value)).toContain("-.inf");
      expect(problem).toContain(".inf");
    }
  });
});
