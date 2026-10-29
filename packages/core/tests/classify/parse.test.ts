/**
 * @file classify: validation (ml-340/ml-kar) — positioned errors, did-you-mean
 * for method and palette names, the layer-level checks (layer type, paint
 * clash, vector sources), and the same block across v1, v2 and stories.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { classifyParse as D } from "../fixtures/parity";

const parse = (doc: string) => YAMLParser.safeParseMapBlock(doc);

function only(result: ReturnType<typeof parse>) {
  expect(result.success).toBe(false);
  return result.errors;
}

describe("valid blocks", () => {
  it("accepts the four forms", () => {
    const result = parse(D.fourForms);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts explicit breaks over a vector tile source", () => {
    const result = parse(D.vectorExplicitBreaks);
    expect(result.success).toBe(true);
  });
});

describe("block errors — positioned, with did-you-mean", () => {
  it("names the method it was probably meant to be", () => {
    const [error] = only(parse(D.methodTypo));
    expect(error!.path).toBe("layers.0.classify.method");
    expect(error!.message).toContain('Did you mean "jenks"?');
    expect(error!.line).toBe(18);
  });

  it("names the palette it was probably meant to be, case-insensitively", () => {
    const [error] = only(parse(D.paletteTypo));
    expect(error!.path).toBe("layers.0.classify.palette");
    expect(error!.message).toContain('Did you mean "YlGnBu"?');
    expect(error!.line).toBe(21);
  });

  it("says when a palette has too few colours for the classes", () => {
    const [error] = only(parse(D.paletteTooFewColours));
    expect(error!.message).toMatch(/Blues has colours for up to 9 classes/);
  });

  it("refuses more classes than the default palette can colour (ml-aot.78)", () => {
    const [error] = only(parse(D.tooManyClasses));
    expect(error!.path).toBe("layers.0.classify.breaks");
    expect(error!.message).toContain("13 classes");
    expect(error!.message).toContain("colors:");
    // 12 classes still fit viridis; with colors: any count works.
    expect(parse(D.twelveClasses).success).toBe(true);
    expect(parse(D.manyClassesWithColors).success).toBe(true);
  });

  it("checks breaks go up", () => {
    const [error] = only(parse(D.breaksGoDown));
    expect(error!.path).toBe("layers.0.classify.breaks.1");
    expect(error!.message).toContain("breaks must go up");
  });

  it("counts colours against classes (n breaks → n + 1)", () => {
    const [error] = only(parse(D.colourCount));
    expect(error!.path).toBe("layers.0.classify.colors");
    expect(error!.message).toContain("3 classes (2 breaks + 1)");
  });

  it("needs a form, and only one", () => {
    expect(only(parse(D.noForm))[0]!.message).toContain("classify needs one of breaks:");
    expect(only(parse(D.twoForms))[0]!.message).toContain("not both");
  });

  it("rejects a colour that is not one, and accepts hide for noData", () => {
    const errors = only(parse(D.noDataTypo));
    expect(errors[0]!.path).toBe("layers.0.classify.noData");
    expect(errors[0]!.message).toContain('Did you mean "grey"?');
  });

  it("says palette:, not scheme:", () => {
    const errors = only(parse(D.schemeKey));
    expect(errors.some((e) => e.message.includes("palette:, not scheme:"))).toBe(true);
  });

  it("warns on an unknown key with a did-you-mean", () => {
    const result = parse(D.unknownKey);
    expect(result.success).toBe(true);
    expect(result.warnings[0]!.message).toContain('Did you mean "palette"?');
  });
});

describe("categories map order (ml-aot.80)", () => {
  it("keeps the authored order of numeric keys, as the list form", async () => {
    const { resolveClassify, classifyLegendEntries } = await import("../../src/classify/compile");
    const result = parse(D.categoriesNumericKeys);
    expect(result.errors).toEqual([]);
    const classify = (result.data as never as { layers: Array<{ classify: never }> }).layers[0]!.classify;
    const record = resolveClassify(classify, "fill");
    expect(record.categories).toEqual([
      { value: "10", color: "red" },
      { value: "2", color: "green" },
      { value: "b", color: "blue" },
      { value: "1", color: "black" },
    ]);
    expect(classifyLegendEntries(record).slice(1, 5).map((e) => e.label)).toEqual(["10", "2", "b", "1"]);
  });

  it("leaves a map JavaScript would not reorder as written", () => {
    const result = parse(D.categoriesWordKeys);
    const classify = (result.data as never as { layers: Array<{ classify: Record<string, unknown> }> }).layers[0]!
      .classify;
    expect(classify["categories"]).toEqual({ residential: "#f6e8c3", commercial: "#d8b365" });
    expect(classify["colors"]).toBeUndefined();
  });
});

describe("layer checks", () => {
  it("refuses method: over a vector tile source, and says why", () => {
    const [error] = only(parse(D.methodOverTiles));
    expect(error!.path).toBe("layers.0.classify.method");
    expect(error!.message).toContain("only ever sees the tiles in view");
    expect(error!.message).toContain("breaks:");
    expect(error!.line).toBe(19);
  });

  it("refuses method: over a basemap source the document does not declare", () => {
    const [error] = only(parse(D.methodOverBasemap));
    expect(error!.message).toContain("not a GeoJSON source declared in this document");
  });

  it("refuses method: over a source read by view, in every spelling", () => {
    const bare = YAMLParser.safeParseMapBlock(D.methodOverViewportBare);
    expect(bare.success).toBe(false);
    expect(bare.errors[0]!.path).toBe("layers.0.classify.method");
    expect(bare.errors[0]!.message).toContain("load: viewport");

    // The object form.
    const object = YAMLParser.safeParseMapBlock(D.methodOverViewportObject);
    expect(object.success).toBe(false);
    expect(object.errors[0]!.path).toBe("layers.0.classify.method");

    // An inline source on the layer.
    const inline = parse(D.methodOverViewportInline);
    expect(inline.success).toBe(false);
    expect(inline.errors[0]!.path).toBe("layers.0.classify.method");
  });

  it("AE5: the by-view refusal names mlym breaks, with the file, field and method filled in", () => {
    const inline = parse(D.methodOverViewportInline);
    expect(inline.errors[0]!.message).toContain("`mlym breaks t.fgb --field income --method jenks`");
    const bare = YAMLParser.safeParseMapBlock(D.methodOverViewportBare);
    expect(bare.errors[0]!.message).toContain("`mlym breaks tracts.fgb --field income --method quantile`");
    // Vector tiles: computed over the file the tiles were made from.
    const [tiles] = only(parse(D.methodOverTiles));
    expect(tiles!.message).toContain("mlym breaks");
  });

  it("accepts method: over a GeoParquet source read by view: the runtime computes from one column (0.10 U3)", () => {
    expect(YAMLParser.safeParseMapBlock(D.methodOverViewportParquet).errors).toEqual([]);
    // format: geoparquet on an extensionless URL counts too.
    expect(YAMLParser.safeParseMapBlock(D.methodOverViewportParquetFormat).errors).toEqual([]);
  });

  it("keeps explicit breaks: on a source read by view", () => {
    const result = YAMLParser.safeParseMapBlock(D.breaksOverViewport);
    expect(result.errors).toEqual([]);
  });

  it("refuses classify plus an authored colour on the same property", () => {
    const [error] = only(parse(D.paintClash));
    expect(error!.path).toBe("layers.0.paint.fill-color");
    expect(error!.message).toContain("Keep one");
    expect(error!.line).toBe(19);
  });

  it("allows an authored colour on another property", () => {
    const result = parse(D.otherPaintProperty);
    expect(result.success).toBe(true);
  });

  it("checks property: against the layer type, with a did-you-mean", () => {
    const [error] = only(parse(D.propertyTypo));
    expect(error!.message).toContain('Did you mean "circle-color"?');
  });

  it("refuses a layer type with no colour to classify", () => {
    const [error] = only(parse(D.heatmapLayer));
    expect(error!.path).toBe("layers.0.classify");
    expect(error!.message).toContain("heatmap layer");
  });

  it("refuses radius: off circle layers", () => {
    const [error] = only(parse(D.radiusOffCircle));
    expect(error!.path).toBe("layers.0.classify.radius");
  });

  it("refuses hide over a legacy-syntax filter", () => {
    const [error] = only(parse(D.hideOverLegacyFilter));
    expect(error!.path).toBe("layers.0.filter");
  });

  it("reports a layer check beside a block error", () => {
    const errors = only(parse(D.layerAndBlockErrors));
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("layers.0.classify.palette");
    expect(paths).toContain("layers.0.paint.fill-color");
  });
});

describe("v2 and stories", () => {
  it("validates classify on v2 style.layers[] the same way", () => {
    const ok = YAMLParser.safeParseMapBlock(D.v2Valid);
    expect(ok.errors).toEqual([]);
    const bad = YAMLParser.safeParseMapBlock(D.v2MethodOverTiles);
    expect(bad.success).toBe(false);
    expect(bad.errors[0]!.path).toBe("style.layers.0.classify.method");
  });

  it("refuses method: over a v2 source whose runtime.load reads by view", () => {
    const bad = YAMLParser.safeParseMapBlock(D.v2MethodOverViewport);
    expect(bad.success).toBe(false);
    expect(bad.errors[0]!.path).toBe("style.layers.0.classify.method");
    expect(bad.errors[0]!.message).toContain("load: viewport");
  });

  it("validates classify in a story's layers", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(D.storyMethodOverTiles);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === "layers.0.classify.method")).toBe(true);
  });
});
