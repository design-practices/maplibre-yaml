/**
 * A layer's own legend entry shows a legend without a `legend:` block (0.9),
 * as a classified layer does; `legend: false` still turns it off.
 */
import { describe, it, expect } from "vitest";
import { effectiveLegend, wantsAutomaticLegend } from "../../src/classify/compile";
import { storyMapDocument } from "../../src/scrollytelling/engine";
import { storyLegendConfig } from "../../src/scrollytelling/story-legend";

const entry = { id: "veg", type: "raster", source: "v", legend: { label: "Vegetation", color: "#41ab5d" } };

describe("a layer legend entry without a legend: block", () => {
  it("gets the automatic legend", () => {
    expect(wantsAutomaticLegend([entry])).toBe(true);
    expect(effectiveLegend(undefined, [entry], { auto: true })).toEqual({ auto: true });
    expect(effectiveLegend(false, [entry], { auto: true })).toBeUndefined();
    expect(effectiveLegend({ position: "top-right" }, [entry], { auto: true })).toEqual({ position: "top-right" });
    // legend: false on the layer, or no entry at all: nothing.
    expect(wantsAutomaticLegend([{ ...entry, legend: false }, { id: "x", type: "fill" }])).toBe(false);
  });

  it("a story pins it, and its map doesn't build a second one", () => {
    const story = {
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 2, mapStyle: "x.json" },
      layers: [entry],
      chapters: [{ id: "a", title: "A", center: [0, 0], zoom: 2 }],
    };
    expect(storyLegendConfig(story)).toEqual({});
    expect(storyMapDocument(story as never)["legend"]).toBe(false);
  });
});
