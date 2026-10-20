/**
 * The story legend's static rule (0.8.1 maintainer decision): pinned, its
 * corner and starting state worked out from the layout alone, never from the
 * scroll position.
 */
import { describe, it, expect } from "vitest";
import { storyLegendPlacement, StoryLegend } from "../../src/scrollytelling/story-legend";
import { storyMapDocument, railHTML, chaptersHTML } from "../../src/scrollytelling";
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
    // The button always reads "Legend"; the author's title heads the panel.
    expect(toggle.textContent).toBe("Legend");
    expect(panel.querySelector(".scrolly-legend-heading")?.textContent).toBe("Key");
    expect(panel.getAttribute("aria-label")).toBe("Key");
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

describe("story legend toggle label", () => {
  it('reads "Legend" and adds no duplicate heading when the title is "Legend" or absent', () => {
    for (const legendConfig of [{ title: "Legend" }, {}]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const story = ScrollytellingBlockSchema.parse({
        type: "scrollytelling",
        id: "s2",
        config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
        legend: { ...legendConfig, collapsed: true, items: [{ color: "#f00", label: "Red" }] },
        chapters: [{ id: "a", title: "A", center: [0, 0], zoom: 1 }],
      });
      const legend = new StoryLegend(host, story, null);
      host.appendChild(legend.layer);
      legend.layout();
      expect(legend.element.querySelector("button")!.textContent).toBe("Legend");
      expect(legend.element.querySelector(".scrolly-legend-heading")).toBeNull();
      host.remove();
    }
  });
});

describe("story strings follow config.locale (0.9)", () => {
  const story = (locale: Record<string, string>, legendTitle?: string) =>
    ScrollytellingBlockSchema.parse({
      type: "scrollytelling",
      id: "s3",
      showMarkers: true,
      config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json", locale },
      legend: { ...(legendTitle ? { title: legendTitle } : {}), collapsed: true, items: [{ color: "#f00", label: "Red" }] },
      chapters: [
        { id: "a", title: "El puente", center: [0, 0], zoom: 1, video: "/v.mp4" },
        { id: "b", title: "La orilla", center: [0, 0], zoom: 1 },
      ],
    });

  it("the legend button, the rail and its buttons, and the video fallback", () => {
    const s = story(
      {
        "maplibre-yaml.Legend.Title": "Leyenda",
        "maplibre-yaml.Story.Chapters": "Capítulos",
        "maplibre-yaml.Story.GoToChapter": "Ir al capítulo {number}: {title}",
        "maplibre-yaml.Story.VideoUnsupported": "Tu navegador no reproduce video.",
      },
      "Leyenda"
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const legend = new StoryLegend(host, s, null);
    host.appendChild(legend.layer);
    legend.layout();
    expect(legend.element.querySelector("button")!.textContent).toBe("Leyenda");
    // A title equal to the translated toggle is not repeated as a heading.
    expect(legend.element.querySelector(".scrolly-legend-heading")).toBeNull();
    legend.destroy();
    host.remove();

    const rail = document.createElement("div");
    rail.innerHTML = railHTML(s);
    expect(rail.querySelector("nav")!.getAttribute("aria-label")).toBe("Capítulos");
    const buttons = rail.querySelectorAll("button");
    expect(buttons[1]!.getAttribute("aria-label")).toBe("Ir al capítulo 2: La orilla");

    const chapters = document.createElement("div");
    chapters.innerHTML = chaptersHTML(s);
    expect(chapters.querySelector("video")!.textContent).toBe("Tu navegador no reproduce video.");
  });

  it("English without a locale", () => {
    const s = story({});
    const rail = document.createElement("div");
    rail.innerHTML = railHTML(s);
    expect(rail.querySelector("nav")!.getAttribute("aria-label")).toBe("Story chapters");
    expect(rail.querySelectorAll("button")[0]!.getAttribute("aria-label")).toBe("Go to chapter 1: El puente");
  });

  it("chapter titles in rail labels are escaped", () => {
    const s = ScrollytellingBlockSchema.parse({
      type: "scrollytelling",
      id: "s4",
      showMarkers: true,
      config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
      chapters: [{ id: "a", title: '"><img src=x onerror=alert(1)>', center: [0, 0], zoom: 1 }],
    });
    const rail = document.createElement("div");
    rail.innerHTML = railHTML(s);
    expect(rail.querySelector("img")).toBeNull();
    expect(rail.querySelector("button")!.getAttribute("aria-label")).toBe(
      'Go to chapter 1: "><img src=x onerror=alert(1)>'
    );
  });
});

