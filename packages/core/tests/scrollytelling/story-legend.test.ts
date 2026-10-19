/**
 * The story legend's static rule (0.8.1 maintainer decision): pinned, its
 * corner and starting state worked out from the layout alone, never from the
 * scroll position.
 */
import { describe, it, expect } from "vitest";
import { storyLegendPlacement, StoryLegend } from "../../src/scrollytelling/story-legend";
import { storyMapDocument } from "../../src/scrollytelling";
import { ScrollytellingBlockSchema } from "../../src/schemas";

const chapters = (...alignments: Array<string | undefined>) =>
  alignments.map((alignment, i) => ({ id: `c${i}`, title: `C${i}`, center: [0, 0], zoom: 2, ...(alignment ? { alignment } : {}) }));

const PHONE = { narrow: true, landscape: false, width: 390 };
const SIDE = { narrow: false, landscape: true, width: 844 };
const DESK = { narrow: false, landscape: false, width: 1280 };

describe("storyLegendPlacement", () => {
  it("phones: top-left, collapsed to a button", () => {
    expect(storyLegendPlacement({ chapters: chapters(undefined), legend: {} }, PHONE)).toEqual({
      corner: "top-left",
      collapsed: true,
    });
  });

  it("a phone on its side: collapsed; top-right when its cards sit on the left", () => {
    expect(storyLegendPlacement({ chapters: chapters(undefined, "left"), legend: {} }, SIDE)).toEqual({
      corner: "top-right",
      collapsed: true,
    });
  });

  it("wide screens: open where no card passes the corner", () => {
    expect(storyLegendPlacement({ chapters: chapters(undefined, undefined), legend: {} }, DESK)).toEqual({
      corner: "top-left",
      collapsed: false,
    });
    // Left cards cover top-left: the legend goes top-right, open.
    expect(storyLegendPlacement({ chapters: chapters("left", "left"), legend: {} }, DESK)).toEqual({
      corner: "top-right",
      collapsed: false,
    });
    // Cards on both sides, or full-width: collapsed (a button over them).
    expect(storyLegendPlacement({ chapters: chapters("left", "right"), legend: {} }, DESK)).toEqual({
      corner: "top-left",
      collapsed: true,
    });
    expect(storyLegendPlacement({ chapters: chapters("full"), legend: {} }, DESK).collapsed).toBe(true);
    // A centred card on a window too narrow to leave the corner free.
    expect(storyLegendPlacement({ chapters: chapters(undefined), legend: {} }, { ...DESK, width: 800 }).collapsed).toBe(true);
  });

  it("hidden chapters have no card", () => {
    const story = { chapters: [...chapters(undefined), { id: "h", title: "H", center: [0, 0], zoom: 2, hidden: true, alignment: "left" }] };
    expect(storyLegendPlacement({ ...story, legend: {} }, DESK)).toEqual({ corner: "top-left", collapsed: false });
  });

  it("the author's position and collapsed win", () => {
    expect(storyLegendPlacement({ chapters: chapters("left"), legend: { position: "bottom-left" } }, DESK)).toEqual({
      corner: "bottom-left",
      collapsed: true,
    });
    expect(storyLegendPlacement({ chapters: chapters(undefined), legend: { collapsed: false } }, PHONE).collapsed).toBe(false);
    expect(storyLegendPlacement({ chapters: chapters(undefined), legend: { collapsed: true } }, DESK).collapsed).toBe(true);
    expect(storyLegendPlacement({ chapters: chapters(undefined), legend: { collapsed: "auto" } }, DESK).collapsed).toBe(false);
  });
});

describe("the story's map no longer builds the legend", () => {
  it("storyMapDocument leaves legend out", () => {
    const story = ScrollytellingBlockSchema.parse({
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
      legend: { title: "Key", items: [{ color: "#f00", label: "Red" }] },
      chapters: chapters(undefined),
    });
    expect(storyMapDocument(story).legend).toBeUndefined();
  });
});

describe("StoryLegend", () => {
  it("is a real button controlling a labelled panel with the entries", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const story = ScrollytellingBlockSchema.parse({
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
      legend: { title: "Key", collapsed: true, items: [{ color: "#f00", label: "Red" }] },
      chapters: chapters(undefined),
    });
    const legend = new StoryLegend(host, story, null);
    host.appendChild(legend.layer);
    legend.layout();
    const toggle = legend.element.querySelector("button")!;
    const panel = legend.element.querySelector<HTMLElement>(".scrolly-legend-panel")!;
    expect(toggle.textContent).toBe("Key");
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(panel.textContent).toContain("Red");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    // Escape from inside closes it and puts focus back on the button.
    panel.tabIndex = -1;
    panel.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    legend.destroy();
    expect(host.querySelector(".scrolly-legend-layer")).toBeNull();
  });
});
