/**
 * Authoring mistakes from the 0.8.1 pass-2 student-path check that validated
 * silently or produced parser jargon (ml-aot.46, .48, .51, .52). Each must
 * produce a message that names the mistake and the fix, with the line the
 * student has to change.
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

/** A story with four chapters; `chapters` replaces the chapter list. */
function story({
  config = "",
  layers = "",
  chapters,
}: { config?: string; layers?: string; chapters?: string } = {}): string {
  return `type: scrollytelling
id: tour
config:
  center: [-73.98, 40.75]
  zoom: 11
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
${config}sources:
  places:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - id: walk
    type: line
    source: places
  - id: places
    type: circle
    source: places
${layers}chapters:
${
  chapters ??
  `  - id: intro
    title: Intro
    center: [-73.98, 40.75]
    zoom: 11
  - id: the-met
    title: "The Met"
    center: [-73.96, 40.78]
    zoom: 16
  - id: bridge
    title: Bridge
    center: [-73.99, 40.70]
    zoom: 14
`
}`;
}

/** A map document with `extraConfig` inside config: and `rest` at the root. */
function map({ extraConfig = "", rest = "" }: { extraConfig?: string; rest?: string } = {}): string {
  return `type: map
id: m
config:
  center: [-73.98, 40.75]
  zoom: 11
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
${extraConfig}sources:
  places:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - id: places
    type: circle
    source: places
${rest}`;
}

const parseStory = (yaml: string) => YAMLParser.safeParseScrollytellingBlock(yaml);
const parseMap = (yaml: string) => YAMLParser.safeParseMapBlock(yaml);

describe("duplicate ids (ml-aot.46)", () => {
  it("two chapters with the same id are an error naming both lines", () => {
    const yaml = story({
      chapters: `  - id: intro
    title: Intro
    center: [-73.98, 40.75]
    zoom: 11
  - id: the-met
    title: "The Met"
    center: [-73.96, 40.78]
    zoom: 16
  - id: the-met
    title: "The Met again (copied)"
    center: [-74.0445, 40.6892]
    zoom: 15
`,
    });
    const result = parseStory(yaml);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: "chapters.2.id",
        message: 'Two chapters have id "the-met" (lines 23 and 27). Each chapter needs its own id: rename this one.',
        line: 23 + 4,
      })
    );
  });

  it("the same through the CLI's dispatcher and the value entry point (no lines there)", () => {
    const value = {
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 2 },
      chapters: [
        { id: "a", title: "A", center: [0, 0], zoom: 2 },
        { id: "a", title: "B", center: [1, 1], zoom: 2 },
      ],
    };
    const result = YAMLParser.safeParseScrollytellingBlockValue(value);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toBe(
      'Two chapters have id "a" (chapters 1 and 2). Each chapter needs its own id: rename this one.'
    );
  });

  it("two layers with the same id warn (map and story): the first is drawn (review F3)", () => {
    const m = parseMap(map({ rest: "  - id: places\n    type: circle\n    source: places\n" }));
    expect(m.success).toBe(true);
    expect(m.warnings.find((w) => w.path === "layers.1.id")).toMatchObject({
      message:
        'Two layers have id "places" (lines 12 and 15): the first one is drawn and this one is skipped. Give each layer its own id.',
    });
    const s = parseStory(story({ layers: "  - id: walk\n    type: line\n    source: places\n" }));
    expect(s.success).toBe(true);
    expect(s.warnings.some((w) => w.message.includes('Two layers have id "walk"'))).toBe(true);
  });

  it("distinct ids still validate", () => {
    expect(parseStory(story()).success).toBe(true);
  });
});

describe("keys nested under config: (ml-aot.48)", () => {
  it("markers/legend/state under a map's config: warn that they belong at the top level", () => {
    const result = parseMap(
      map({
        extraConfig:
          '  markers:\n    - at: [-73.985, 40.748]\n      color: "#e63946"\n  legend:\n    title: Places\n  state:\n    year: 2020\n',
      })
    );
    expect(result.success).toBe(true);
    for (const [key, line] of [["markers", 7], ["legend", 10], ["state", 12]] as const) {
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: `config.${key}`,
          message: `"${key}" belongs at the top level, next to config:, not inside it. Move it out of config: (indent it like config:); inside config: it does nothing.`,
          line,
        })
      );
    }
  });

  it("theme under a story's config: warns the same way", () => {
    const result = parseStory(story({ config: "  theme: dark\n" }));
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: "config.theme", message: expect.stringContaining('"theme" belongs at the top level') })
    );
  });

  it("an unknown config key warns; MapLibre map options do not", () => {
    const result = parseMap(map({ extraConfig: "  fooBar: 1\n  maxZom: 12\n" }));
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "config.fooBar",
        message: 'Unknown key "fooBar" in config: it is not a map option maplibre-yaml or MapLibre knows, so it does nothing.',
      })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: "config.maxZom", suggestion: "maxZoom" })
    );
    const ok = parseMap(
      map({
        extraConfig:
          "  cooperativeGestures: true\n  canvasContextAttributes: { antialias: true }\n  customAttribution: Me\n  attributionControl: false\n  renderWorldCopies: false\n  zoomSnap: 0.5\n",
      })
    );
    expect(ok.warnings).toEqual([]);
  });
});

describe("references the map cannot honour (ml-aot.51)", () => {
  it("a chapter layers.show name close to a document layer warns with a did-you-mean", () => {
    const result = parseStory(
      story({
        chapters: `  - id: intro
    title: Intro
    center: [0, 0]
    zoom: 2
    layers:
      show: [walking]
      hide: [water]
`,
      })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "chapters.0.layers.show.0",
        message:
          'Chapter 1 ("intro") shows layer "walking", which is not a layer in this document. Did you mean "walk"? (If it is a basemap layer, ignore this.)',
        suggestion: "walk",
      })
    );
    // "water" is nothing like a document layer: a basemap layer, not flagged.
    expect(result.warnings.filter((w) => w.path.startsWith("chapters.0.layers.hide"))).toEqual([]);
  });

  it("an onChapterEnter action layer typo warns too", () => {
    const result = parseStory(
      story({
        chapters: `  - id: parks
    title: Parks
    center: [0, 0]
    zoom: 2
    onChapterEnter:
      - action: setFilter
        layer: place
        filter: ["==", ["get", "kind"], "park"]
`,
      })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "chapters.0.onChapterEnter.0.layer",
        suggestion: "places",
        message: expect.stringContaining('Chapter 1 ("parks") setFilter names layer "place"'),
      })
    );
  });

  it("fitTo.source that is not a declared source warns with a did-you-mean", () => {
    const result = parseMap(map({ extraConfig: "  fitTo:\n    source: place\n    padding: 70\n" }));
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "config.fitTo.source",
        suggestion: "places",
        message:
          'fitTo.source "place" is not a source declared under sources: (places), so the map keeps its center and zoom. Did you mean "places"?',
      })
    );
  });

  it("a CSV data file warns that CSV is not supported", () => {
    for (const url of [
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vEXAMPLE/pub?output=csv",
      "data/places.csv",
    ]) {
      const result = parseMap(
        map({ rest: `  - id: sheet\n    type: circle\n    source:\n      type: geojson\n      url: "${url}"\n` })
      );
      expect(result.warnings, url).toContainEqual(
        expect.objectContaining({
          path: "layers.1.source.url",
          message: expect.stringContaining("is a CSV file. maplibre-yaml reads GeoJSON, not CSV"),
        })
      );
    }
  });
});

describe("friendlier wording (ml-aot.52)", () => {
  it("a key indented one space too far names that line, not the one above", () => {
    const yaml = story().replace('  - id: the-met\n    title: "The Met"', '  - id: the-met\n     title: "The Met"');
    const result = parseStory(yaml);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "yaml-syntax",
      line: 24,
      message:
        'YAML indentation error: Line 24 is indented differently from line 23 above it: "title:" starts in column 6, but "id:" starts in column 5. Keys that belong together must start in the same column: in a list item, every key lines up under the first one after "- ". Indent with spaces.',
    });
  });

  it("a key indented too little names its own line", () => {
    const yaml = story().replace("    center: [-73.96, 40.78]\n    zoom: 16", "    center: [-73.96, 40.78]\n  zoom: 16");
    const result = parseStory(yaml);
    expect(result.errors[0]).toMatchObject({
      code: "yaml-syntax",
      line: 26,
      message: expect.stringContaining(
        'YAML indentation error: Line 26 is indented differently from line 25 above it: "zoom:" starts in column 3, but "center:" starts in column 5.'
      ),
    });
  });

  it("outside a list the advice leaves list items out; a value with a colon is told to quote it", () => {
    const deeper = parseMap("type: map\nid: m\nconfig:\n  center: [0, 0]\n    zoom: 3\n");
    expect(deeper.errors[0]?.message).toBe(
      'YAML indentation error: Line 5 is indented differently from line 4 above it: "zoom:" starts in column 5, but "center:" starts in column 3. Keys that belong together must start in the same column. Indent with spaces.'
    );
    const colon = parseStory(story().replace('title: "The Met"', "title: Note: the Met"));
    expect(colon.errors[0]?.message).toBe(
      'YAML indentation error: Line 24 has a second ": " inside the value of "title:". Put a value that contains a colon in quotes, e.g. title: "Note: the Met".'
    );
  });

  it("a chapter without center says it is missing, counting chapters from 1 and naming it", () => {
    const yaml = story().replace("    center: [-73.99, 40.70]\n", "");
    const result = parseStory(yaml);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "chapters.2.center",
        message: 'Chapter 3 ("bridge") is missing center: — add center: [longitude, latitude].',
      }),
    ]);
  });

  it("a missing map config key says it is missing", () => {
    const yaml = map().replace("  zoom: 11\n", "");
    const result = parseMap(yaml);
    expect(result.errors[0]).toMatchObject({
      path: "config.zoom",
      message: "config is missing zoom: — add zoom: 12 (a number from 0 to 24).",
    });
  });
});
