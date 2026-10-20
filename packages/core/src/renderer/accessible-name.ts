/**
 * @file The map's accessible name and description
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * A map canvas is opaque to a screen reader. MapLibre already makes it a
 * named landmark — `role="region"`, `aria-label` from `locale["Map.Title"]`
 * ("Map" in English) — so every map on a page is announced as just "Map".
 * The document's `title:` replaces that generic name with the map's own, and
 * `description:` becomes its accessible description: a visually hidden
 * element (still readable in a screen reader's browse mode) that the canvas
 * points at with `aria-describedby`, the alt-text pattern for a figure that
 * can't carry `alt`.
 *
 * Extends MapLibre rather than replacing it: with no `title:` the canvas
 * keeps MapLibre's own name (so `locale["Map.Title"]` still translates it),
 * and `role` is only added where a maplibre-gl major didn't set one.
 */

import type { Strings } from "../i18n";

/** The usual "visually hidden, still read" rules (no layout, no clipping of focus). */
const VISUALLY_HIDDEN =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;" +
  "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";

/** Class on the hidden description element. */
export const MAP_DESCRIPTION_CLASS = "ml-map-description";

let nextId = 0;

/** The part of a MapLibre map this needs (absent on test doubles). */
interface CanvasHost {
  getCanvas?: () => HTMLCanvasElement | undefined;
  getCanvasContainer?: () => HTMLElement | undefined;
}

/**
 * Name and describe the map's canvas.
 *
 * @param map - the MapLibre map, just constructed.
 * @param options.title - the document's `title:`; absent keeps MapLibre's name.
 * @param options.description - the document's `description:`.
 * @param options.strings - the document's strings (for `Map.Title` on a
 *   maplibre-gl that set no name itself).
 * @returns the description element, when one was created (MapLibre removes
 *   it with the canvas container on `map.remove()`).
 */
export function applyAccessibleName(
  map: unknown,
  options: { title?: string; description?: string; strings: Strings }
): HTMLElement | null {
  const host = (map ?? {}) as CanvasHost;
  let canvas: HTMLCanvasElement | undefined;
  try {
    canvas = typeof host.getCanvas === "function" ? host.getCanvas() : undefined;
  } catch {
    canvas = undefined;
  }
  if (!canvas || typeof canvas.setAttribute !== "function") return null;

  const title = typeof options.title === "string" ? options.title.trim() : "";
  if (title) {
    canvas.setAttribute("aria-label", title);
  } else if (!canvas.getAttribute("aria-label")) {
    canvas.setAttribute("aria-label", options.strings("Map.Title"));
  }
  if (!canvas.getAttribute("role")) canvas.setAttribute("role", "region");

  const description = typeof options.description === "string" ? options.description.trim() : "";
  if (!description) return null;
  const container =
    (typeof host.getCanvasContainer === "function" ? host.getCanvasContainer() : undefined) ??
    canvas.parentElement;
  const doc = canvas.ownerDocument;
  if (!container || !doc) return null;
  const element = doc.createElement("div");
  element.id = `ml-map-description-${++nextId}`;
  element.className = MAP_DESCRIPTION_CLASS;
  element.style.cssText = VISUALLY_HIDDEN;
  element.textContent = description;
  container.appendChild(element);
  const describedBy = (canvas.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  canvas.setAttribute("aria-describedby", [...describedBy, element.id].join(" "));
  return element;
}
