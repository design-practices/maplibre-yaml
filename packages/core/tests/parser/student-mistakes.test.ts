/**
 * The YAML mistakes students make most, from the vanilla classroom audit
 * (ml-okw, ml-aot.15, ml-zft): each must produce a message that names the
 * field and the fix — the text the error card shows — not "Expected array,
 * got undefined" or "Value does not match any of the expected formats".
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { ColorSchema } from "../../src/schemas/base.schema";

/** A map document with `config` and the first layer's `paint` swapped in. */
function doc({
  config = "  center: [-98, 39]\n  zoom: 3",
  paint = '      circle-color: "#ef4444"',
  extra = "",
}: { config?: string; paint?: string; extra?: string } = {}): string {
  return `type: map
id: m
config:
${config}
  mapStyle: "https://demotiles.maplibre.org/style.json"
${extra}layers:
  - id: cities
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    paint:
${paint}
`;
}

const parse = (yaml: string) => YAMLParser.safeParseMapBlock(yaml);

describe("a misspelled required key is reported as the typo (ml-okw)", () => {
  it("centre: → Unknown key \"centre\" — did you mean \"center\"?, at the typo's line", () => {
    const result = parse(doc({ config: "  centre: [-98, 39]\n  zoom: 3" }));
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "config.centre",
        message: 'Unknown key "centre" — did you mean "center"? ("center" is required here.)',
        suggestion: "center",
        line: 4,
        column: 3,
      },
    ]);
  });

  it("a letter-case slip (Zoom) and a one-letter typo (zom) are caught the same way", () => {
    for (const typo of ["Zoom", "zom"]) {
      const result = parse(doc({ config: `  center: [-98, 39]\n  ${typo}: 3` }));
      expect(result.errors[0]?.message, typo).toBe(
        `Unknown key "${typo}" — did you mean "zoom"? ("zoom" is required here.)`
      );
      expect(result.errors[0]?.path).toBe(`config.${typo}`);
    }
  });

  it("separate lat/lng keys get the [longitude, latitude] form", () => {
    const result = parse(doc({ config: "  lat: 39\n  lng: -98\n  zoom: 3" }));
    expect(result.errors[0]?.message).toContain("center: [longitude, latitude] — longitude first");
  });

  it("a missing key with no look-alike sibling keeps the plain message", () => {
    const result = parse(doc({ config: "  zoom: 3" }));
    expect(result.errors[0]).toMatchObject({
      path: "config.center",
      message: "Expected array, got undefined",
    });
  });

  it("an optional config key with a spelling variant warns (config passes unknown keys through)", () => {
    const result = parse(doc({ config: "  center: [-98, 39]\n  zoom: 3\n  bearIng: 10" }));
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "config.bearIng",
        message: 'Unknown key "bearIng". Did you mean "bearing"?',
      })
    );
    // A real MapLibre option the schema does not list is still not flagged.
    const passthrough = parse(doc({ config: "  center: [-98, 39]\n  zoom: 3\n  cooperativeGestures: true" }));
    expect(passthrough.warnings).toEqual([]);
  });
});

describe("unquoted #hex colours (ml-okw)", () => {
  it("names the property and shows the quoted fix, at its line", () => {
    const result = parse(doc({ paint: "      circle-radius: 10\n      circle-color: #ef4444" }));
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "layers.0.paint.circle-color",
        message:
          'Colours starting with # must be quoted: circle-color: "#ef4444". Without quotes, YAML reads # as the start of a comment, so this value is empty.',
        line: 15,
        column: 7,
      },
    ]);
  });

  it("an ordinary comment after an empty key is not mistaken for a lost value", () => {
    const result = parse(doc({ paint: "      circle-color: # TODO pick one" }));
    expect(result.errors.map((e) => e.message).join(" ")).not.toContain("must be quoted");
  });

  it("inside a flow map (a YAML syntax error) the error carries a quoting hint", () => {
    const result = parse(doc({ paint: '      { "circle-color": #ef4444, "circle-radius": 10 }' }).replace("    paint:\n      {", "    paint: {"));
    expect(result.errors[0]?.code).toBe("yaml-syntax");
    expect(result.errors[0]?.message).toContain('Hint: colours starting with # must be quoted, e.g. "#ef4444"');
  });
});

describe("colour values (ml-aot.15)", () => {
  it("an unknown colour name is an error with a did-you-mean, at the paint path", () => {
    const result = parse(doc({ paint: '      circle-color: "bleu"' }));
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "layers.0.paint.circle-color",
        message:
          '"bleu" is not a colour name. Did you mean "blue"? Use a CSS colour name (red, steelblue), a hex code ("#ff0000"), rgb() or hsl().',
        line: 14,
      }),
    ]);
  });

  it("curly quotes pasted from slides say to retype them", () => {
    const result = parse(doc({ paint: "      circle-color: “#ef4444”" }));
    expect(result.errors[0]).toMatchObject({
      path: "layers.0.paint.circle-color",
      message:
        'Curly quotes (“ ”) are not YAML quotes, so they became part of the colour: “#ef4444”. Retype them as straight quotes: "#ef4444"',
    });
  });

  it.each([
    "steelblue",
    "RED",
    "Transparent",
    "#abc",
    "#abcd",
    "#aabbcc",
    "#aabbccdd",
    "rgb(1, 2, 3)",
    "rgba(1, 2, 3, 0.5)",
    "hsl(120, 50%, 50%)",
    "var(--accent)",
    "oklch(70% 0.1 200)",
    "currentColor",
  ])("accepts %s", (value) => {
    expect(ColorSchema.safeParse(value).success).toBe(true);
  });

  it.each(["bleu", "#ef444", "rgb 1 2 3", "light-blue"])("rejects %s", (value) => {
    expect(ColorSchema.safeParse(value).success).toBe(false);
  });
});

describe("other union failures report the inner field (ml-okw)", () => {
  it('a number written as "10px" names the property and the plain-number fix', () => {
    const result = parse(doc({ paint: '      circle-radius: "10px"' }));
    expect(result.errors[0]).toMatchObject({
      path: "layers.0.paint.circle-radius",
      message:
        "Expected number or array, got string. Write a plain number, without quotes or units: 10",
    });
  });

  it("[latitude, longitude] gets the swapped suggestion", () => {
    const result = parse(doc({ config: "  center: [39, -98]\n  zoom: 3" }));
    expect(result.errors[0]).toMatchObject({
      path: "config.center.1",
      message:
        "Value must be >= -90. Coordinates are [longitude, latitude] — longitude first. Did you mean [-98, 39]?",
    });
  });

  it("type: Map says values are case-sensitive", () => {
    const result = parse(doc().replace("type: map", "type: Map"));
    expect(result.errors[0]?.message).toBe(
      'Expected "map", got "Map" (values are case-sensitive: write "map")'
    );
  });
});

describe("a layer source: that almost names a declared source (ml-aot.15)", () => {
  const withSources = (ref: string) =>
    doc({
      extra: "sources:\n  cities:\n    type: geojson\n    data: { type: FeatureCollection, features: [] }\n",
    }).replace(
      "    source:\n      type: geojson\n      data: { type: FeatureCollection, features: [] }",
      `    source: ${ref}`
    );

  it("warns with a did-you-mean (the document still validates: it might be a basemap source)", () => {
    const result = parse(withSources("citeis"));
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual({
      path: "layers.0.source",
      message:
        'Layer "cities" uses source "citeis", which is not declared under sources:. Did you mean "cities"?',
      suggestion: "cities",
      line: 14,
      column: 13,
    });
  });

  it("does not warn for a name unlike any declared source (a basemap source)", () => {
    const result = parse(withSources("openmaptiles"));
    expect(result.warnings).toEqual([]);
  });
});

describe("bare relative data paths are accepted (ml-zft)", () => {
  it.each(["data/cities.geojson", "cities.geojson", "./cities.geojson", "/data/cities.geojson"])(
    "url: %s",
    (url) => {
      const result = parse(
        doc().replace("data: { type: FeatureCollection, features: [] }", `url: "${url}"`)
      );
      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
    }
  );
});
