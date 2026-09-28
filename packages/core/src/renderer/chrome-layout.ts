/**
 * @file Shared overlay-chrome corner layout (KTD10)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * One positioning contract for everything rendered OVER the map: the legend,
 * the params panel (U8), and author slot children (U9) all register into the
 * same four corner containers instead of inventing their own absolute
 * placement. Multiple occupants of one corner stack in registration order;
 * corner containers are `pointer-events: none` so an empty corner never
 * shadows map gestures, and each mounted piece opts back in.
 *
 * The corners deliberately mirror MapLibre's own control positions, but this
 * system is separate from `map.addControl` on purpose: chrome here is
 * document chrome (legend, parameter controls, author markup), not map
 * controls, and it lives on the HOST element so it survives style reloads.
 */

import type { ControlPosition } from "../schemas/map.schema";

/**
 * Chrome corners are the SAME four positions the schema's
 * `ControlPosition` already names — one vocabulary for every placed thing,
 * not a third spelling of the corners.
 */
export type ChromeCorner = ControlPosition;

export const CHROME_CORNERS: readonly ChromeCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export class ChromeLayout {
  private readonly corners = new Map<ChromeCorner, HTMLElement>();

  constructor(private readonly host: HTMLElement) {}

  /** The corner's container, created on first use. */
  corner(corner: ChromeCorner): HTMLElement {
    const existing = this.corners.get(corner);
    if (existing) return existing;

    const el = document.createElement("div");
    el.className = `ml-map-chrome ml-map-chrome-${corner}`;
    el.style.position = "absolute";
    el.style.zIndex = "1";
    el.style.display = "flex";
    // Bottom corners grow upward so the first-registered piece hugs the edge.
    el.style.flexDirection = corner.startsWith("bottom") ? "column-reverse" : "column";
    el.style.gap = "8px";
    el.style.pointerEvents = "none";
    // MapLibre's own control corner (z-index 2, same 10px inset) may already
    // occupy this corner — nudge the chrome corner past it so a navigation
    // control and the params panel compose instead of overlapping. Controls
    // added AFTER the first chrome mount are not re-measured (documented).
    const controls = this.host.querySelector<HTMLElement>(
      `.maplibregl-ctrl-${corner}`
    );
    const controlsExtent =
      controls && controls.offsetHeight > 0 ? controls.offsetHeight + 10 : 0;
    const inset = 10 + controlsExtent;
    el.style.maxHeight = `calc(100% - ${inset + 10}px)`;
    el.style[corner.startsWith("top") ? "top" : "bottom"] = `${inset}px`;
    el.style[corner.endsWith("left") ? "left" : "right"] = "10px";
    el.style.alignItems = corner.endsWith("left") ? "flex-start" : "flex-end";

    this.host.appendChild(el);
    this.corners.set(corner, el);
    return el;
  }

  /** Mount one chrome piece into a corner (stacks after current occupants). */
  mount(corner: ChromeCorner, el: HTMLElement): void {
    el.style.pointerEvents = "auto";
    // Flex children refuse to shrink by default (min-height: auto) — a
    // piece taller than the corner must scroll, not clip unreachably under
    // MapLibre's overflow: hidden host.
    el.style.minHeight = "0";
    el.style.overflowY = "auto";
    this.corner(corner).appendChild(el);
  }

  /** Remove every corner container (renderer destroy). */
  destroy(): void {
    for (const el of this.corners.values()) el.remove();
    this.corners.clear();
  }
}
