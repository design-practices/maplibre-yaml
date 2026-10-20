/**
 * The Protomaps basemap shorthand (0.9, ml-cnv.7): `mapStyle: { pmtiles,
 * flavor, lang }` validates unambiguously against a style URL or object,
 * and builds the full Protomaps style (layers from @protomaps/basemaps,
 * glyphs/sprite, attribution, the file as pmtiles://).
 */
import { describe, it, expect } from "vitest";
import { language_script_pairs, namedFlavor } from "@protomaps/basemaps";
import { YAMLParser } from "../../src/parser";
import {
  MapStyleSchema,
  PROTOMAPS_FLAVORS,
  PROTOMAPS_LANGUAGES,
  isProtomapsBasemap,
} from "../../src/schemas/basemap.schema";
import {
  basemapLanguage,
  notAProtomapsBasemap,
  PROTOMAPS_ATTRIBUTION,
  PROTOMAPS_GLYPHS,
  protomapsStyle,
} from "../../src/formats/protomaps-style";
import { getDecoder } from "../../src/formats/decoders";
import { applyDocumentBase } from "../../src/utils/document-base";
import { toModel } from "../../src/model/to-model";

const v1 = (mapStyle: string) => `
type: map
id: pm
config:
  center: [-73.99, 40.70]
  zoom: 14
  mapStyle:
${mapStyle
  .trim()
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
layers: []
`;

const messages = (yaml: string) => {
  const result = YAMLParser.safeParseMapBlock(yaml);
  return { ok: result.success, errors: result.errors.map((e) => `${e.path}: ${e.message}`) };
};

describe("validation: the shorthand vs a style URL or object", () => {
  it("accepts the shorthand (v1 mapStyle, v2 basemap, story config)", () => {
    expect(messages(v1("pmtiles: data/nyc.pmtiles\nflavor: dark\nlang: es")).ok).toBe(true);
    expect(messages(v1("pmtiles: https://example.org/x.pmtiles")).ok).toBe(true);
    expect(messages(v1("pmtiles: pmtiles://https://example.org/planet")).ok).toBe(true);
    const v2 = YAMLParser.safeParseMapBlock(`
version: 2
type: map
id: pm2
style:
  basemap: { pmtiles: data/nyc.pmtiles, flavor: white }
  center: [-73.99, 40.70]
  zoom: 14
  layers: []
`);
    expect(v2.errors).toEqual([]);
    const story = YAMLParser.safeParseScrollytellingBlock(`
type: scrollytelling
id: s
config:
  center: [-73.99, 40.70]
  zoom: 14
  mapStyle: { pmtiles: data/nyc.pmtiles, flavor: grayscale }
chapters:
  - id: one
    title: One
    center: [-73.99, 40.70]
    zoom: 14
`);
    expect(story.errors).toEqual([]);
  });

  it("still accepts a style URL and an inline style object", () => {
    expect(messages(v1('"https://example.org/style.json"').replace("mapStyle:\n    ", "mapStyle: ")).ok).toBe(true);
    expect(messages(v1("version: 8\nsources: {}\nlayers: []")).ok).toBe(true);
    expect(isProtomapsBasemap({ version: 8, sources: {}, layers: [] })).toBe(false);
    expect(isProtomapsBasemap({ pmtiles: "x.pmtiles" })).toBe(true);
    expect(isProtomapsBasemap("https://x/style.json")).toBe(false);
  });

  it("a flavor typo gets did-you-mean, listing the flavors", () => {
    const { ok, errors } = messages(v1("pmtiles: data/nyc.pmtiles\nflavor: drak"));
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/config\.mapStyle\.flavor: "drak" is not one of light, dark, white, grayscale, black\. Did you mean "dark"\?/);
  });

  it("pmtiles: must be a .pmtiles file or a pmtiles:// URL", () => {
    const { ok, errors } = messages(v1("pmtiles: https://example.org/style.json"));
    expect(ok).toBe(false);
    expect(errors.join("\n")).toContain('pmtiles: "https://example.org/style.json" is not a PMTiles file');
    expect(errors.join("\n")).toContain("A style URL is written in place of the whole block");
    expect(messages(v1("pmtiles: data/nyc.mbtiles")).errors.join("\n")).toContain("pmtiles convert");
  });

  it("missing pmtiles: says what to add; a misspelt one gets did-you-mean once", () => {
    const missing = messages(v1("flavor: dark"));
    expect(missing.ok).toBe(false);
    expect(missing.errors.join("\n")).toMatch(/missing pmtiles: — add pmtiles: data\/basemap\.pmtiles/);
    const typo = messages(v1("pmtile: data/nyc.pmtiles"));
    expect(typo.ok).toBe(false);
    expect(typo.errors).toHaveLength(1);
    expect(typo.errors[0]).toMatch(/pmtile.*did you mean "pmtiles"/);
  });

  it("an unknown key gets did-you-mean (flavour → flavor) and is not dropped silently", () => {
    const { ok, errors } = messages(v1("pmtiles: data/nyc.pmtiles\nflavour: dark"));
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/Unknown key "flavour" in the Protomaps basemap — did you mean "flavor"\?/);
  });

  it("a lang outside the basemap's languages gets did-you-mean", () => {
    const { ok, errors } = messages(v1("pmtiles: data/nyc.pmtiles\nlang: zh-hans"));
    expect(ok).toBe(false);
    expect(errors.join("\n")).toContain('did you mean "zh-Hans"?');
    // A language tag means its language.
    expect(messages(v1("pmtiles: data/nyc.pmtiles\nlang: es-MX")).errors.join("\n")).toContain('did you mean "es"?');
  });

  it("a code that is only a letter away from another isn't suggested: xx is not ar (ml-cnv.16)", () => {
    const { ok, errors } = messages(v1("pmtiles: data/nyc.pmtiles\nlang: xx"));
    expect(ok).toBe(false);
    const text = errors.join("\n");
    expect(text).toContain(`lang: "xx" isn't a label language of the Protomaps basemap. It has ar, cs,`);
    expect(text).not.toMatch(/did you mean/i);
    expect(messages(v1("pmtiles: data/nyc.pmtiles\nlang: AR")).errors.join("\n")).toContain('did you mean "ar"?');
  });

  it("style keys AND pmtiles: is refused rather than guessed at", () => {
    const r = MapStyleSchema.safeParse({ version: 8, sources: {}, layers: [], pmtiles: "x.pmtiles" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/both MapLibre style keys .* and pmtiles:/);
  });

  it("defaultMapStyle (pages documents, Astro) takes the shorthand too", async () => {
    const { GlobalConfigSchema } = await import("../../src/schemas/page.schema");
    expect(GlobalConfigSchema.safeParse({ defaultMapStyle: { pmtiles: "data/nyc.pmtiles" } }).success).toBe(true);
    expect(GlobalConfigSchema.safeParse({ defaultMapStyle: { pmtiles: "data/nyc.pmtiles", flavor: "x" } }).success).toBe(false);
  });
});

describe("the lists in the schema match @protomaps/basemaps", () => {
  it("every flavor is a named flavor; every language is one the package labels", () => {
    for (const flavor of PROTOMAPS_FLAVORS) expect(() => namedFlavor(flavor)).not.toThrow();
    expect([...PROTOMAPS_LANGUAGES].sort()).toEqual(language_script_pairs.map((p) => p.lang).sort());
  });
});

describe("protomapsStyle: the generated style", () => {
  it("one pmtiles:// vector source with attribution, hosted glyphs and the flavor's sprite, the flavor's layers", async () => {
    const style = await protomapsStyle({ pmtiles: "https://example.org/nyc.pmtiles", flavor: "dark", lang: "en" });
    expect(style["version"]).toBe(8);
    expect(style["glyphs"]).toBe(PROTOMAPS_GLYPHS);
    expect(style["sprite"]).toBe("https://protomaps.github.io/basemaps-assets/sprites/v4/dark");
    expect(style["sources"]).toEqual({
      protomaps: { type: "vector", url: "pmtiles://https://example.org/nyc.pmtiles", attribution: PROTOMAPS_ATTRIBUTION },
    });
    expect(PROTOMAPS_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(PROTOMAPS_ATTRIBUTION).toMatch(/Protomaps/);
    const layers = style["layers"] as Array<{ id: string; source?: string; paint?: Record<string, unknown> }>;
    expect(layers[0]!.id).toBe("background");
    expect(layers.map((l) => l.id)).toEqual(expect.arrayContaining(["earth", "water", "roads_minor", "places_locality"]));
    expect(layers.filter((l) => l.source).every((l) => l.source === "protomaps")).toBe(true);
    // Dark and light differ.
    const light = await protomapsStyle({ pmtiles: "https://example.org/nyc.pmtiles" });
    const bg = (s: Record<string, unknown>) =>
      (s["layers"] as Array<{ id: string; paint?: Record<string, unknown> }>)[0]!.paint!["background-color"];
    expect(bg(style)).not.toEqual(bg(light));
    expect(light["sprite"]).toMatch(/\/light$/);
  });

  it("relative pmtiles/glyphs/sprite resolve against the page; written as given without one (emit)", async () => {
    const spec = {
      pmtiles: "data/nyc.pmtiles",
      glyphs: "fonts/{fontstack}/{range}.pbf",
      sprite: "/my-repo/sprites/light",
    };
    const page = await protomapsStyle(spec, { pageUrl: "https://u.github.io/my-repo/maps/index.html" });
    expect((page["sources"] as any).protomaps.url).toBe("pmtiles://https://u.github.io/my-repo/maps/data/nyc.pmtiles");
    expect(page["glyphs"]).toBe("https://u.github.io/my-repo/maps/fonts/{fontstack}/{range}.pbf");
    expect(page["sprite"]).toBe("https://u.github.io/my-repo/sprites/light");
    const emitted = await protomapsStyle(spec);
    expect((emitted["sources"] as any).protomaps.url).toBe("pmtiles://data/nyc.pmtiles");
    expect(emitted["glyphs"]).toBe("fonts/{fontstack}/{range}.pbf");
    // pmtiles:// as written is not doubled.
    const scheme = await protomapsStyle({ pmtiles: "pmtiles://https://h/x.pmtiles" }, { pageUrl: "https://p/" });
    expect((scheme["sources"] as any).protomaps.url).toBe("pmtiles://https://h/x.pmtiles");
  });

  it("base is applied to the shorthand's file, glyphs and sprite with the rest of the document", () => {
    const model = toModel({
      type: "map",
      id: "b",
      config: {
        center: [0, 0],
        zoom: 1,
        mapStyle: { pmtiles: "data/nyc.pmtiles", flavor: "dark", glyphs: "/fonts/{fontstack}/{range}.pbf" },
      },
      layers: [],
    } as never);
    const rebased = applyDocumentBase(model, "/my-repo/");
    expect(rebased.style.basemap).toEqual({
      pmtiles: "/my-repo/data/nyc.pmtiles",
      flavor: "dark",
      glyphs: "/my-repo/fonts/{fontstack}/{range}.pbf",
    });
  });

  it("labels: lang:, else the page's language when the basemap has it, else English", () => {
    expect(basemapLanguage({ lang: "de" }, "fr")).toBe("de");
    expect(basemapLanguage({}, "es-MX")).toBe("es");
    expect(basemapLanguage({}, "zh-TW")).toBe("zh-Hant");
    expect(basemapLanguage({}, "zh")).toBe("zh-Hans");
    expect(basemapLanguage({}, "nb")).toBe("no");
    expect(basemapLanguage({}, "sw")).toBe("en");
    expect(basemapLanguage({})).toBe("en");
  });

  it("refuses an unknown flavor from a programmatic config plainly", async () => {
    await expect(protomapsStyle({ pmtiles: "x.pmtiles", flavor: "neon" as never })).rejects.toThrow(
      /no flavor "neon"; use one of light, dark/
    );
  });

  it("the generator is reached through the decoder seam, once", async () => {
    const a = getDecoder("protomaps-basemap");
    const b = getDecoder("protomaps-basemap");
    expect(a).toBe(b);
    expect(typeof (await a).layers).toBe("function");
  });
});

describe("a pmtiles: file that is not a Protomaps basemap", () => {
  it("is named, with its layers and what a basemap has", () => {
    const message = notAProtomapsBasemap(["districts"], "pmtiles://https://h/data/districts.pmtiles");
    expect(message).toContain("`https://h/data/districts.pmtiles` doesn't look like a Protomaps basemap");
    expect(message).toContain("its layers are districts");
    expect(message).toContain("earth, water, roads and places");
    expect(notAProtomapsBasemap(undefined, "pmtiles://x.pmtiles")).toContain("it has no vector layers");
    expect(
      notAProtomapsBasemap(
        ["boundaries", "buildings", "earth", "landcover", "landuse", "places", "pois", "roads", "water"],
        "pmtiles://x.pmtiles"
      )
    ).toBeUndefined();
  });
});
