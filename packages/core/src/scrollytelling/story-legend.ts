/**
 * @file A story's legend: pinned, above the cards, a button on small screens
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @description
 * The legend of a `<ml-scrollytelling>` story is not map chrome under the
 * chapter cards (where every card passing its corner covered it). It is
 * pinned in one corner of a layer above the cards and never moves while the
 * story scrolls (predictable, no scroll-linked motion: WCAG 3.2).
 *
 * The rule, worked out from the layout -- never from the scroll position:
 *
 * - **Corner:** the author's `legend.position`; else top-left (opposite the
 *   chapter rail), or top-right on a wide screen whose cards are all on the
 *   left.
 * - **Open or collapsed:** the author's `legend.collapsed: true | false`;
 *   else (`auto`) a compact "Legend" button on phones (either orientation)
 *   and wherever cards pass the legend's corner, and open elsewhere -- so an
 *   open legend never sits over card text.
 * - **Opened:** a non-modal panel above the cards. The toggle is a real
 *   button (`aria-expanded`, `aria-controls`); Escape closes it and returns
 *   focus to the button; on phones a tap outside closes it; focus is never
 *   trapped and the map stays usable. The panel scrolls when it is taller
 *   than the map.
 */

import type { Chapter, ScrollytellingBlock } from "../schemas/scrollytelling.schema";
import type { ControlPosition } from "../schemas/map.schema";
import { LegendBuilder } from "../renderer/legend-builder";
import { escapeHtml } from "../utils/html";

/** Phones held upright, and narrow windows: cards span the map's width. */
export const STORY_NARROW_QUERY = "(max-width: 768px)";
/** Phones on their side: short, touch, cards beside the map's centre. */
export const STORY_LANDSCAPE_QUERY =
  "(max-height: 500px) and (max-width: 1000px) and (min-width: 769px) and (pointer: coarse)";

/** The screen the legend is laid out for. */
export interface StoryScreen {
  /** `STORY_NARROW_QUERY` matches. */
  narrow: boolean;
  /** `STORY_LANDSCAPE_QUERY` matches. */
  landscape: boolean;
  /** Viewport width in CSS pixels. */
  width: number;
}

/** Where the legend sits and whether it starts collapsed. */
export interface StoryLegendPlacement {
  corner: ControlPosition;
  collapsed: boolean;
}

/** A desktop card's widest (`.chapter-content` max-width). */
const CARD_MAX_WIDTH = 450;
/** Room an open legend takes from the map's edge. */
const LEGEND_ROOM = 190;

/**
 * The legend's corner and starting state for a screen (see the file header).
 * Pure: the same story and screen always give the same answer.
 */
export function storyLegendPlacement(
  story: { chapters?: unknown; legend?: unknown },
  screen: StoryScreen
): StoryLegendPlacement {
  const legend = (story.legend ?? {}) as { position?: ControlPosition; collapsed?: boolean | "auto" };
  // The sides of the map a card passes over on this screen.
  const sides = new Set<"left" | "right">();
  for (const chapter of (story.chapters ?? []) as Chapter[]) {
    if (chapter.hidden) continue;
    const align = chapter.alignment ?? "center";
    if (screen.narrow) {
      sides.add("left").add("right");
    } else if (screen.landscape) {
      // On a phone on its side centred and full-width cards sit on the left.
      sides.add(align === "right" ? "right" : "left");
    } else if (align === "left" || align === "right") {
      sides.add(align);
    } else if (align === "full" || (screen.width - CARD_MAX_WIDTH) / 2 < LEGEND_ROOM) {
      sides.add("left").add("right");
    }
  }
  const corner: ControlPosition =
    legend.position ?? (sides.has("left") && !sides.has("right") ? "top-right" : "top-left");
  const side = corner.endsWith("left") ? "left" : "right";
  const small = screen.narrow || screen.landscape;
  const collapsed =
    legend.collapsed === true || legend.collapsed === false ? legend.collapsed : small || sides.has(side);
  return { corner, collapsed };
}

let nextId = 0;

/**
 * The legend layer of one story element. Built once per render; laid out
 * again only when the screen changes (resize, rotation), never on scroll.
 */
export class StoryLegend {
  readonly layer: HTMLElement;
  private readonly root: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly cleanups: Array<() => void> = [];
  /** The reader opened or closed it since the last layout change. */
  private readerChoice: boolean | null = null;
  /** The layout's last answer, to tell a screen change from a re-layout. */
  private lastKey = "";
  private placement: StoryLegendPlacement = { corner: "top-left", collapsed: false };

  constructor(
    private readonly host: HTMLElement,
    private readonly story: ScrollytellingBlock,
    slotElement: HTMLElement | null
  ) {
    const doc = host.ownerDocument;
    const id = `ml-story-legend-${++nextId}`;
    const config = (story.legend ?? {}) as { title?: string; items?: unknown[] };
    const title = config.title ?? "Legend";

    this.layer = doc.createElement("div");
    this.layer.className = "scrolly-legend-layer";
    this.root = doc.createElement("div");
    this.root.className = "scrolly-legend";
    this.toggle = doc.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "scrolly-legend-toggle";
    this.toggle.setAttribute("aria-controls", `${id}-panel`);
    // The button always says what it is ("Legend"), whatever the legend's
    // title: a reader scanning the map — or a screen reader announcing
    // "Legend, button, collapsed" — knows what it opens. The author's title
    // heads the panel instead.
    this.toggle.innerHTML = `<span class="scrolly-legend-label">Legend</span>`;
    this.panel = doc.createElement("div");
    this.panel.className = "scrolly-legend-panel";
    this.panel.id = `${id}-panel`;
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-label", title);

    if (slotElement) {
      // The author's own legend markup (`slot="legend"`) fills the panel.
      slotElement.removeAttribute("hidden");
      this.panel.appendChild(slotElement);
    } else {
      const builder = new LegendBuilder();
      const items = builder.entries((story.layers ?? []) as never[], story.legend as never);
      const heading =
        title.trim().toLowerCase() === "legend"
          ? ""
          : `<div class="scrolly-legend-heading">${escapeHtml(title)}</div>`;
      this.panel.innerHTML = heading + builder.itemsHTML(items);
    }
    this.root.append(this.toggle, this.panel);
    this.layer.appendChild(this.root);

    this.listen(this.toggle, "click", () => this.setOpen(this.panel.hidden, true));
    this.listen(doc, "keydown", (event) => {
      const e = event as KeyboardEvent;
      if (e.key !== "Escape" || this.panel.hidden) return;
      const inside = this.root.contains(doc.activeElement);
      // Escape closes a legend the reader opened, or one they are in; an
      // open-by-default legend on a wide screen stays open otherwise.
      if (!inside && this.readerChoice !== true) return;
      this.setOpen(false, true);
      this.toggle.focus();
    });
    this.listen(doc, "pointerdown", (event) => {
      // Phones: a tap outside closes an opened panel (not modal: the tap
      // still reaches the page).
      if (this.panel.hidden || !this.isSmall()) return;
      if (event.target instanceof Node && this.root.contains(event.target)) return;
      this.setOpen(false, true);
    });
  }

  /** The legend's element tree (for tests and the host). */
  get element(): HTMLElement {
    return this.root;
  }

  /** Whether the panel is showing. */
  get open(): boolean {
    return !this.panel.hidden;
  }

  /**
   * Work out the corner and starting state for the screen as it is now.
   * A reader's own open/close stays until the screen changes.
   */
  layout(): void {
    const view = this.host.ownerDocument.defaultView;
    const screen: StoryScreen = {
      narrow: view?.matchMedia?.(STORY_NARROW_QUERY).matches ?? false,
      landscape: view?.matchMedia?.(STORY_LANDSCAPE_QUERY).matches ?? false,
      width: view?.innerWidth ?? 1024,
    };
    this.placement = storyLegendPlacement(this.story, screen);
    const key = `${this.placement.corner}|${this.placement.collapsed}|${screen.narrow}|${screen.landscape}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.readerChoice = null;
    }
    const { corner } = this.placement;
    this.root.dataset.corner = corner;
    this.root.dataset.collapsedByDefault = String(this.placement.collapsed);
    this.place(corner);
    this.setOpen(this.readerChoice ?? !this.placement.collapsed, false);
  }

  /** Keep the legend clear of MapLibre's own controls and the rail. */
  private place(corner: ControlPosition): void {
    const top = corner.startsWith("top");
    const left = corner.endsWith("left");
    const controls = this.host.querySelector<HTMLElement>(
      `:scope > .scrolly-map-container .maplibregl-ctrl-${corner}`
    );
    const controlsExtent = controls && controls.offsetHeight > 0 ? controls.offsetHeight + 10 : 0;
    const railOnRight = !left && this.host.querySelector(":scope > .scrolly-map-container > .chapter-markers");
    const style = this.root.style;
    style.top = top ? `${10 + controlsExtent}px` : "";
    style.bottom = top ? "" : `${10 + controlsExtent}px`;
    style.left = left ? "10px" : "";
    style.right = left ? "" : railOnRight ? "48px" : "10px";
    style.setProperty("--ml-story-legend-offset", `${20 + controlsExtent}px`);
  }

  private setOpen(open: boolean, byReader: boolean): void {
    if (byReader) this.readerChoice = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.root.classList.toggle("is-open", open);
  }

  private isSmall(): boolean {
    const view = this.host.ownerDocument.defaultView;
    return Boolean(
      view?.matchMedia?.(STORY_NARROW_QUERY).matches || view?.matchMedia?.(STORY_LANDSCAPE_QUERY).matches
    );
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler, true);
    this.cleanups.push(() => target.removeEventListener(type, handler, true));
  }

  /**
   * Take the layer off the page. The author's slot element, if any, goes
   * back on the story element so a later render finds it.
   */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const slot = this.panel.querySelector<HTMLElement>(':scope > [slot="legend"]');
    if (slot) this.host.appendChild(slot);
    this.layer.remove();
  }
}
