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

/**
 * Stacking above the map (ml-3d0). Chrome corners sit at z-index 1 and
 * MapLibre's own control corners at 2; popups carry no z-index of their own,
 * so a panel used to cover any popup opened near it. Popups are transient
 * and user-invoked, so they go on top of both. Markers stay map content,
 * below the chrome.
 */
export const POPUP_Z_INDEX = "3";

/** Anything with MapLibre Popup's element accessor and `open` event. */
interface LiftablePopup {
  getElement?(): HTMLElement | undefined;
  on?(type: "open", listener: () => void): unknown;
}

/**
 * Raise a popup above the chrome corners and map controls. Applied on every
 * `open`, since MapLibre creates the popup element only when it opens (and a
 * marker's popup re-opens on each click), and once immediately for a popup
 * that is already open.
 */
export function liftPopup<P extends LiftablePopup>(popup: P): P {
  const apply = () => {
    const el = popup.getElement?.();
    if (el) el.style.zIndex = POPUP_Z_INDEX;
  };
  popup.on?.("open", apply);
  apply();
  return popup;
}

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

  /** Mount one chrome piece into a corner: after the current occupants, or at the corner's edge (`first`). */
  mount(corner: ChromeCorner, el: HTMLElement, first = false): void {
    el.style.pointerEvents = "auto";
    // Flex children refuse to shrink by default (min-height: auto) — a
    // piece taller than the corner must scroll, not clip unreachably under
    // MapLibre's overflow: hidden host.
    el.style.minHeight = "0";
    el.style.overflowY = "auto";
    const host = this.corner(corner);
    if (first) host.prepend(el);
    else host.appendChild(el);
    this.shareRows();
  }

  /**
   * Two occupied corners on one edge (top-left and top-right, or the bottom
   * pair) share that edge: each may take at most half the map's width, so
   * on a narrow map — a phone — a legend and the layer panel sit side by
   * side instead of overlapping (ml-aot.111). A corner alone keeps the full
   * width. Pieces wrap their text within the limit.
   */
  private shareRows(): void {
    for (const edge of ["top", "bottom"] as const) {
      const left = this.corners.get(`${edge}-left`);
      const right = this.corners.get(`${edge}-right`);
      const shared = Boolean(left?.childElementCount && right?.childElementCount);
      for (const el of [left, right]) {
        if (!el) continue;
        el.style.maxWidth = shared ? "calc(50% - 15px)" : "";
        for (const child of Array.from(el.children) as HTMLElement[]) {
          child.style.maxWidth = shared ? "100%" : "";
          child.style.boxSizing = shared ? "border-box" : child.style.boxSizing;
        }
      }
    }
  }

  /**
   * Keep MapLibre's compact attribution from covering bottom-left chrome.
   *
   * @remarks
   * On a narrow map (MapLibre's threshold is 640px) the attribution control
   * goes compact and starts EXPANDED until the first drag. Expanded, it wraps
   * across the map's whole bottom edge from the bottom-right corner, above
   * the chrome (z-index 2 vs 1) -- a bottom-left legend on a phone showed only
   * its title (ml-aot.26). The bottom-left corner cannot reserve space for it
   * (the attribution lives in the other corner and shrinks to an (i) button a
   * moment later), so while bottom-left chrome is mounted the attribution
   * starts collapsed, exactly as MapLibre leaves it after a drag. The (i)
   * button still expands it on demand. Same-corner placement past MapLibre's
   * own controls is unchanged. MapLibre's own controls in the bottom-left
   * corner -- the scale bar, by default -- count too (ml-aot.38); its logo
   * alone does not.
   *
   * @returns Whether an expanded attribution was collapsed.
   */
  collapseCompactAttribution(): boolean {
    if (!this.bottomLeftOccupied()) return false;
    let collapsed = false;
    for (const attribution of this.host.querySelectorAll<HTMLElement>(
      ".maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show"
    )) {
      attribution.classList.remove("maplibregl-compact-show");
      attribution.removeAttribute("open");
      collapsed = true;
    }
    return collapsed;
  }

  /** Whether anything readable sits in the bottom-left corner. */
  private bottomLeftOccupied(): boolean {
    const chrome = this.corners.get("bottom-left");
    if (chrome && chrome.childElementCount > 0) return true;
    const controls = this.host?.querySelector?.<HTMLElement>(".maplibregl-ctrl-bottom-left");
    if (!controls) return false;
    return [...controls.children].some(
      (child) =>
        !child.classList.contains("maplibregl-ctrl-logo") &&
        !child.querySelector(".maplibregl-ctrl-logo")
    );
  }

  /** Remove every corner container (renderer destroy). */
  destroy(): void {
    for (const el of this.corners.values()) el.remove();
    this.corners.clear();
  }
}
