/**
 * Keys that were accepted but inert (ml-1q8, 0.9.1: a "has no effect"
 * deprecation warning) are removed in 0.11 (ml-cxo), each with an error
 * that names the alternative:
 *
 * - `fetchStrategy: build | hybrid` (ml-j2p.1): nothing fetches at build time.
 *   An error naming `prefetchedData` (which the Astro loader fills). `runtime`
 *   stays accepted for one more release, deprecated: it names what always
 *   happens.
 * - multi-page `pages:` documents (ml-j2p.4), with their root `config.theme`
 *   and `config.dataFetching` (ml-j2p.2, .3): ONE error per document, saying
 *   to write one document per page.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";
import type { ValidationWarning } from "../../src/parser/validation-utils";
import { inertKeys as D, FETCH_STRATEGIES } from "../fixtures/parity";

const find = (warnings: ValidationWarning[], path: string, text: string) =>
  warnings.find((w) => w.path === path && w.message.includes(text));

const map = (doc: string) => YAMLParser.safeParseMapBlock(doc);

describe("fetchStrategy: build | hybrid is an error (ml-cxo)", () => {
  for (const strategy of FETCH_STRATEGIES) {
    it(`v1 ${strategy}: an error at the source, naming prefetchedData`, () => {
      const result = map(D.fetchStrategy(strategy));
      expect(result.success).toBe(false);
      // Reported at the source, as every failure inside a source union is
      // (the `encoding: "srtm"` case in validation-ergonomics).
      const error = result.errors.find((e) => e.path === "sources.data");
      expect(error).toBeDefined();
      expect(error!.message).toBe(
        `"fetchStrategy: ${strategy}" is not supported: maplibre-yaml fetches a source's data in the ` +
          "browser when the map loads. To inline data fetched elsewhere (at build time, by a script), " +
          "write it under prefetchedData: — the Astro loader fills it for you. Remove fetchStrategy:."
      );
      expect(error!.line).toBe(9);
      // Not also a "runtime is deprecated" warning: that one is for runtime.
      expect(result.warnings.some((w) => w.message.includes("fetchStrategy"))).toBe(false);
    });
  }

  it("v2: at runtime.fetchStrategy", () => {
    const result = YAMLParser.safeParseMapBlock(D.v2FetchStrategy);
    expect(result.success).toBe(false);
    const error = result.errors.find((e) => e.path === "style.sources.data");
    expect(error?.message).toContain('"fetchStrategy: build" is not supported');
    expect(error?.message).toContain("prefetchedData");
  });

  it("runtime (what actually happens) is valid, with a deprecation warning at the key", () => {
    const result = map(D.fetchStrategy("runtime"));
    expect(result.success).toBe(true);
    const warning = find(result.warnings, "sources.data.fetchStrategy", "is deprecated and has no effect");
    expect(warning).toBeDefined();
    expect(warning!.kind).toBe("deprecation");
    expect(warning!.line).toBe(11);
  });

  it("a source without fetchStrategy: gets neither", () => {
    const result = map(D.plainMap);
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.message.includes("fetchStrategy"))).toBe(false);
  });
});

describe("multi-page pages: documents are an error (ml-cxo)", () => {
  const MESSAGE =
    "Multi-page documents (pages:) are not supported: write one document per page " +
    "(type: map or type: scrollytelling); Astro and the web component compose pages.";

  it("safeParseAny (what mlym validate calls): one error, at the pages: key", () => {
    const { blockType, result } = YAMLParser.safeParseAny(D.root);
    expect(blockType).toBe("unknown");
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([{ path: "pages", code: "schema", message: MESSAGE, line: 7, column: 1 }]);
    expect(result.warnings).toEqual([]);
  });

  it("a present-but-null type: with pages: gets the same error, not Unknown block type", () => {
    const { blockType, result } = YAMLParser.safeParseAny("type:\npages: []\n");
    expect(blockType).toBe("unknown");
    expect(result.errors.map((e) => e.message)).toEqual([MESSAGE]);
  });

  it("a type: map block with a stray pages: key quotes the same message, not a did-you-mean", () => {
    const result = map(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
pages:
  - path: /
    title: Home
    blocks: []
`);
    expect(result.success).toBe(true);
    const warning = result.warnings.find((w) => w.path === "pages");
    expect(warning).toMatchObject({ message: `Unknown key "pages". ${MESSAGE}`, line: 7, column: 1 });
    expect(warning).not.toHaveProperty("suggestion");
    expect(result.warnings.filter((w) => w.message.includes("Did you mean"))).toEqual([]);
  });

  it("a story's own theme: is untouched", () => {
    const story = YAMLParser.safeParseScrollytellingBlock(D.storyTheme);
    expect(story.success).toBe(true);
    expect(story.data!.theme).toBe("dark");
    expect(story.warnings.some((w) => w.message.includes("has no effect") || w.message.includes("Multi-page"))).toBe(
      false
    );
  });
});
