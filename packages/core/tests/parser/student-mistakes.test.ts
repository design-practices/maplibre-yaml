/**
 * The YAML mistakes students make most, from the vanilla classroom audit
 * (ml-okw, ml-aot.15, ml-zft): each must produce a message that names the
 * field and the fix — the text the error card shows — not "Expected array,
 * got undefined" or "Value does not match any of the expected formats".
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { ColorSchema } from "../../src/schemas/base.schema";
import { studentMistakes as D, RELATIVE_DATA_URLS, ZOOM_TYPOS } from "../fixtures/parity";

const parse = (yaml: string) => YAMLParser.safeParseMapBlock(yaml);

describe("a misspelled required key is reported as the typo (ml-okw)", () => {
  it("centre: → Unknown key \"centre\" — did you mean \"center\"?, at the typo's line", () => {
    const result = parse(D.centreTypo);
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
    for (const typo of ZOOM_TYPOS) {
      const result = parse(D.zoomTypo(typo));
      expect(result.errors[0]?.message, typo).toBe(
        `Unknown key "${typo}" — did you mean "zoom"? ("zoom" is required here.)`
      );
      expect(result.errors[0]?.path).toBe(`config.${typo}`);
    }
  });

  it("separate lat/lng keys get the [longitude, latitude] form", () => {
    const result = parse(D.latLng);
    expect(result.errors[0]?.message).toContain("center: [longitude, latitude] — longitude first");
  });

  it("a missing key with no look-alike sibling says it is missing, with the line to add (ml-aot.52)", () => {
    const result = parse(D.missingCenter);
    expect(result.errors[0]).toMatchObject({
      path: "config.center",
      message: "config is missing center: — add center: [longitude, latitude].",
    });
  });

  it("an optional config key with a spelling variant warns (config passes unknown keys through)", () => {
    const result = parse(D.optionalKeyVariant);
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: "config.bearIng",
        message: 'Unknown key "bearIng". Did you mean "bearing"?',
      })
    );
    // A real MapLibre option the schema does not list is still not flagged.
    const passthrough = parse(D.passthroughOption);
    expect(passthrough.warnings).toEqual([]);
  });
});

describe("unquoted #hex colours (ml-okw)", () => {
  it("names the property and shows the quoted fix, at its line", () => {
    const result = parse(D.unquotedHex);
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
    const result = parse(D.emptyKeyComment);
    expect(result.errors.map((e) => e.message).join(" ")).not.toContain("must be quoted");
  });

  it("inside a flow map (a YAML syntax error) the error carries a quoting hint", () => {
    const result = parse(D.hexInFlowMap);
    expect(result.errors[0]?.code).toBe("yaml-syntax");
    expect(result.errors[0]?.message).toContain('Hint: colours starting with # must be quoted, e.g. "#ef4444"');
  });
});

describe("colour values (ml-aot.15)", () => {
  it("an unknown colour name is an error with a did-you-mean, at the paint path", () => {
    const result = parse(D.colourNameTypo);
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
    const result = parse(D.curlyQuotes);
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
    const result = parse(D.numberWithUnits);
    expect(result.errors[0]).toMatchObject({
      path: "layers.0.paint.circle-radius",
      message:
        "Expected number or array, got string. Write a plain number, without quotes or units: 10",
    });
  });

  it("[latitude, longitude] gets the swapped suggestion", () => {
    const result = parse(D.latLonSwapped);
    expect(result.errors[0]).toMatchObject({
      path: "config.center.1",
      message:
        "Value must be >= -90. Coordinates are [longitude, latitude] — longitude first. Did you mean [-98, 39]?",
    });
  });

  it("type: Map says values are case-sensitive", () => {
    const result = parse(D.typeCase);
    expect(result.errors[0]?.message).toBe(
      'Expected "map", got "Map" (values are case-sensitive: write "map")'
    );
  });
});

describe("a layer source: that names no source (ml-aot.15, ml-aot.133)", () => {
  it("a typo is an error at the source: line, with a did-you-mean (ml-aot.133)", () => {
    const result = parse(D.sourceTypo);
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "layers.0.source",
        message:
          'Layer "cities" uses source "citeis", which this document doesn\'t define. Did you mean "cities"? ' +
          'Sources defined here: "cities". (To draw from one of the basemap style\'s own sources, the ' +
          "layer also needs source-layer:.)",
        suggestion: "cities",
        line: 14,
        column: 13,
      },
    ]);
  });

  it("a circle layer can't draw from a basemap's vector source without source-layer: an error too", () => {
    const result = parse(D.basemapSourceNoSourceLayer);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.path).toBe("layers.0.source");
  });

  it("with source-layer: the name may be a basemap source: a near miss warns, anything else is silent", () => {
    const near = parse(D.nearMissWithSourceLayer);
    expect(near.success).toBe(true);
    expect(near.warnings).toContainEqual({
      path: "layers.0.source",
      message:
        'Layer "cities" uses source "citeis", which is not declared under sources:. Did you mean "cities"?',
      suggestion: "cities",
      line: 14,
      column: 13,
    });

    const basemap = parse(D.basemapSourceWithSourceLayer);
    expect(basemap.success).toBe(true);
    expect(basemap.warnings).toEqual([]);
  });
});

describe("bare relative data paths are accepted (ml-zft)", () => {
  it.each(RELATIVE_DATA_URLS)(
    "url: %s",
    (url) => {
      const result = parse(D.relativeDataUrl(url));
      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
    }
  );
});
