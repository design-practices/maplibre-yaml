/**
 * The map's accessible name and description (0.9): the document's `title:`
 * names the canvas MapLibre already makes a region, and `description:` is
 * linked with aria-describedby.
 */
import { describe, it, expect } from "vitest";
import { applyAccessibleName, MAP_DESCRIPTION_CLASS } from "../../src/renderer/accessible-name";
import { createStrings, defaultStrings } from "../../src/i18n";

/** A map as MapLibre builds it: canvas in a canvas container, labelled. */
function fakeMap(opts: { maplibreLabels?: boolean } = {}) {
  const container = document.createElement("div");
  const canvasContainer = document.createElement("div");
  const canvas = document.createElement("canvas");
  if (opts.maplibreLabels !== false) {
    canvas.setAttribute("role", "region");
    canvas.setAttribute("aria-label", "Map");
  }
  canvasContainer.appendChild(canvas);
  container.appendChild(canvasContainer);
  document.body.appendChild(container);
  return {
    canvas,
    canvasContainer,
    map: { getCanvas: () => canvas, getCanvasContainer: () => canvasContainer },
  };
}

describe("applyAccessibleName", () => {
  it("no title: MapLibre's own name stays", () => {
    const { canvas, map } = fakeMap();
    applyAccessibleName(map, { strings: defaultStrings });
    expect(canvas.getAttribute("aria-label")).toBe("Map");
    expect(canvas.getAttribute("role")).toBe("region");
    expect(canvas.hasAttribute("aria-describedby")).toBe(false);
  });

  it("title names the canvas; description is a hidden element it points at", () => {
    const { canvas, canvasContainer, map } = fakeMap();
    const el = applyAccessibleName(map, {
      title: "Heat vulnerability in the Bronx",
      description: "Census tracts shaded from pale yellow (low) to dark red (high).",
      strings: defaultStrings,
    });
    expect(canvas.getAttribute("aria-label")).toBe("Heat vulnerability in the Bronx");
    expect(el).not.toBeNull();
    expect(el!.classList.contains(MAP_DESCRIPTION_CLASS)).toBe(true);
    expect(el!.parentElement).toBe(canvasContainer);
    expect(canvas.getAttribute("aria-describedby")).toBe(el!.id);
    expect(document.getElementById(el!.id)!.textContent).toBe(
      "Census tracts shaded from pale yellow (low) to dark red (high)."
    );
    // Visually hidden, not display:none — browse mode still reads it.
    expect(el!.style.position).toBe("absolute");
    expect(el!.hidden).toBe(false);
  });

  it("two maps get distinct description ids", () => {
    const a = fakeMap();
    const b = fakeMap();
    const ea = applyAccessibleName(a.map, { description: "A", strings: defaultStrings });
    const eb = applyAccessibleName(b.map, { description: "B", strings: defaultStrings });
    expect(ea!.id).not.toBe(eb!.id);
  });

  it("a maplibre-gl that set no name or role gets them (Map.Title, translatable)", () => {
    const { canvas, map } = fakeMap({ maplibreLabels: false });
    applyAccessibleName(map, { strings: createStrings({ "Map.Title": "Karte" }) });
    expect(canvas.getAttribute("aria-label")).toBe("Karte");
    expect(canvas.getAttribute("role")).toBe("region");
  });

  it("a test double without a canvas is left alone", () => {
    expect(applyAccessibleName({}, { title: "x", strings: defaultStrings })).toBeNull();
    expect(applyAccessibleName(null, { title: "x", strings: defaultStrings })).toBeNull();
  });
});
