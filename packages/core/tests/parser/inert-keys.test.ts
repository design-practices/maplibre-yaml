/**
 * Keys the schema accepts but nothing acts on warn that they have no effect
 * (ml-1q8, 0.9.1; revisit in 0.10 under ml-j2p). They stay valid, so
 * existing documents keep validating, and the warning is a deprecation, so
 * `mlym validate --strict` does not fail on it.
 *
 * - `fetchStrategy: build | hybrid` (ml-j2p.1): nothing fetches at build time.
 * - a root document's `config.dataFetching` (ml-j2p.2) and `config.theme`
 *   (ml-j2p.3): nothing reads them.
 * - multi-page documents, `pages:` with content / mixed / map-fullpage blocks
 *   (ml-j2p.4): no package renders them. One warning per document.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser";
import type { ValidationWarning } from "../../src/parser/validation-utils";

const find = (warnings: ValidationWarning[], path: string, text: string) =>
  warnings.find((w) => w.path === path && w.message.includes(text));

const map = (source: string) =>
  YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
  data:
    type: geojson
    url: https://example.com/d.geojson
${source}
layers:
  - id: dots
    type: circle
    source: data
`);

const ROOT = `config:
  title: Site
  theme: dark
  dataFetching:
    defaultStrategy: build
    timeout: 5000
pages:
  - path: /
    title: Home
    blocks:
      - type: content
        content:
          - h1: [{ str: Hello }]
      - type: mixed
        blocks:
          - type: content
            content:
              - p: [{ str: Side }]
      - type: map-fullpage
        id: full
        config:
          center: [0, 0]
          zoom: 2
          mapStyle: https://example.com/style.json
  - path: /two
    title: Two
    blocks:
      - type: content
        content:
          - p: [{ str: Again }]
`;

describe("fetchStrategy: build | hybrid has no effect (ml-j2p.1)", () => {
  for (const strategy of ["build", "hybrid"]) {
    it(`v1 ${strategy}: valid, with a deprecation warning at the key`, () => {
      const result = map(`    fetchStrategy: ${strategy}`);
      expect(result.success).toBe(true);
      const warning = find(result.warnings, "sources.data.fetchStrategy", "has no effect");
      expect(warning).toBeDefined();
      expect(warning!.kind).toBe("deprecation");
      expect(warning!.message).toContain(`fetchStrategy: ${strategy}`);
      expect(warning!.line).toBe(11);
    });
  }

  it("v2: at runtime.fetchStrategy", () => {
    const result = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
    data:
      type: geojson
      url: https://example.com/d.geojson
      runtime:
        fetchStrategy: build
  layers:
    - id: dots
      type: circle
      source: data
`);
    expect(result.success).toBe(true);
    expect(find(result.warnings, "style.sources.data.runtime.fetchStrategy", "has no effect")).toBeDefined();
  });

  it("runtime (what actually happens) does not warn", () => {
    const result = map(`    fetchStrategy: runtime`);
    expect(result.warnings.some((w) => w.message.includes("fetchStrategy"))).toBe(false);
  });
});

describe("multi-page root documents (ml-j2p.2, .3, .4)", () => {
  const result = YAMLParser.safeParse(ROOT);

  it("still validate", () => {
    expect(result.success).toBe(true);
  });

  it("config.dataFetching and config.theme warn at their keys", () => {
    const dataFetching = find(result.warnings, "config.dataFetching", "has no effect");
    expect(dataFetching?.kind).toBe("deprecation");
    expect(dataFetching?.line).toBe(4);
    const theme = find(result.warnings, "config.theme", "has no effect");
    expect(theme?.kind).toBe("deprecation");
    expect(theme?.line).toBe(3);
  });

  it("warn once per document that nothing renders them", () => {
    const pages = result.warnings.filter((w) => w.message.includes("aren't rendered by any maplibre-yaml package"));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe("pages");
    expect(pages[0]!.kind).toBe("deprecation");
    expect(pages[0]!.line).toBe(7);
  });

  it("safeParseAny (what mlym validate calls) reports the same", () => {
    const any = YAMLParser.safeParseAny(ROOT);
    expect(any.blockType).toBe("root");
    expect(any.result.warnings.filter((w) => w.kind === "deprecation").map((w) => w.path).sort()).toEqual([
      "config.dataFetching",
      "config.theme",
      "pages",
    ]);
  });

  it("a map block's config and a story's theme do not get these warnings", () => {
    const block = map("");
    expect(block.warnings.some((w) => w.message.includes("has no effect"))).toBe(false);
    const story = YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
theme: dark
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 3
`);
    expect(story.success).toBe(true);
    expect(story.warnings.some((w) => w.message.includes("has no effect") || w.message.includes("Multi-page"))).toBe(
      false
    );
  });
});
