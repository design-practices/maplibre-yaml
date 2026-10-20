/**
 * @file `<ml-scrollytelling>`: scroll-driven map stories as a web component
 * @module @maplibre-yaml/core/components/ml-scrollytelling
 *
 * @description
 * A story map from a `type: scrollytelling` document, with no build step:
 * load `@maplibre-yaml/core/register` (from a CDN with an import map, or
 * through a bundler) and write the element. Astro's `<Scrollytelling>`
 * renders this same element, so both paths run one engine.
 *
 * ## Giving it a story (same order as `<ml-map>`)
 *
 * 1. The `story` (alias `config`) property: an object or a JSON string.
 * 2. An inline `<script type="text/yaml">` child.
 * 3. `src="story.yaml"`: fetched, parsed and validated in the browser.
 * 4. The `config` attribute: the story as JSON.
 *
 * ```html
 * <ml-scrollytelling src="story.yaml"></ml-scrollytelling>
 * ```
 *
 * It renders a sticky `<ml-map>` (so slots, the worker setup, effects and
 * the map's own error card all apply) and the chapter column, and drives the
 * map from the scroll position: camera moves, layer show/hide, chapter
 * actions, the chapter rail, themes and reduced motion. A story that fails
 * to load or validate shows ONE error card -- the errors with their line
 * numbers and did-you-mean hints -- and no map.
 *
 * Children with `slot="top-left|top-right|bottom-left|bottom-right"` are
 * handed to the story's map, as on `<ml-map>`. The legend (`legend:` or a
 * `slot="legend"` child) is the story's own: pinned in one corner above the
 * chapter cards, never moved by the scroll, a "Legend" button on phones
 * (see scrollytelling/story-legend).
 *
 * Nothing on the map moves with the scroll. MapLibre's controls (scale bar,
 * attribution, navigation), corner slots, the params panel and the notice
 * stay in their corners in the map's layer, under the cards: a card passes
 * over a corner while it scrolls by and comes to rest clear of the bottom
 * ones. On phones the attribution stays a compact (i).
 *
 * `base="/my-repo/"` (same meaning as `<ml-map base>`) makes the story work on
 * a site published under a subpath, such as a GitHub Pages project site: the
 * `src` URL, every path in the story's map document, and chapter
 * `image`/`video` paths resolve against it.
 *
 * Light DOM (no shadow root): the chapters are ordinary page content -- page
 * CSS styles them, links and images in a chapter work, and find-in-page and
 * screen readers see them.
 *
 * @fires ml-scrollytelling:chapter - A chapter became active
 * @fires ml-scrollytelling:action - A `custom` chapter action ran
 * @fires ml-scrollytelling:error - The story could not be loaded or validated
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  YAMLParser,
  type ParseError,
  type ParseResult,
  type ScrollytellingBlock,
  type ValidationWarning,
} from "../parser/yaml-parser.js";
import type { Chapter, ChapterAction } from "../schemas/scrollytelling.schema";
import {
  createStoryController,
  prefersReducedMotion,
  storyMapDocument,
  type CameraPadding,
  type StoryController,
  type StoryMap,
} from "../scrollytelling/engine";
import {
  chaptersHTML,
  errorCardHTML,
  footerHTML,
  railButtonsHTML,
  type StoryProblem,
} from "../scrollytelling/render";
import { injectScrollytellingStyles } from "../scrollytelling/styles";
import { normalizeDocumentBase, resolveDocumentUrl } from "../utils/document-base.js";
import { displayPath } from "../parser/validation-utils.js";
import { noteStoryImageRefs } from "../utils/image-refs.js";
import { ML_MAP_SLOTS, registerMLMap, type MLMap } from "./ml-map.js";
import { isLocalPage } from "./map-notice.js";
import {
  StoryLegend,
  storyLegendConfig,
  STORY_NARROW_QUERY,
  STORY_LANDSCAPE_QUERY,
} from "../scrollytelling/story-legend.js";
import type { ClassifyRecord } from "../classify/compile.js";
import {
  isFilePage,
  looksLikeHtml,
  resolveUrl,
  srcFetchFailedCard,
  srcHtmlCard,
  srcHttpErrorCard,
  type ErrorCardContent,
} from "./student-messages.js";

/** The layout breakpoint the stylesheet switches to stacked cards at. */
const NARROW_QUERY = "(max-width: 768px)";

/** After a resize, how long the layout must hold still before the chapter is re-framed. */
const REALIGN_DELAY_MS = 120;

/**
 * Every event `<ml-scrollytelling>` dispatches, typed with its `detail`. All
 * bubble.
 */
export interface MLScrollytellingEventMap {
  "ml-scrollytelling:chapter": CustomEvent<{
    chapterId: string;
    previousChapterId: string | null;
    index: number;
    callback: string | null;
    /** The story's MapLibre map; `null` when it failed to load. */
    map: MapLibreMap | null;
  }>;
  "ml-scrollytelling:action": CustomEvent<{
    action: ChapterAction;
    chapterId: string;
    phase: "enter" | "exit";
    map: MapLibreMap | null;
  }>;
  "ml-scrollytelling:error": CustomEvent<{
    errors: ParseError[];
    warnings: ValidationWarning[];
    /** The `src` URL, when the story came from one. */
    source: string | null;
  }>;
}

interface Waiter {
  resolve: (map: MapLibreMap) => void;
  reject: (error: Error) => void;
}

/**
 * The `<ml-scrollytelling>` custom element.
 *
 * @fires ml-scrollytelling:chapter - A chapter became active
 * @fires ml-scrollytelling:action - A `custom` chapter action ran
 * @fires ml-scrollytelling:error - The story could not be loaded or validated
 */
export class MLScrollytelling extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["src", "config", "base", "quiet"];
  }

  /** The validated story being shown, or `null`. */
  private _story: ScrollytellingBlock | null = null;
  /** A `story`/`config` property assigned before the element connected. */
  private pendingValue: unknown = undefined;
  private initialized = false;
  /** Bumped per load/render, so a slow fetch or map cannot land late. */
  private generation = 0;
  /** JSON of the last object/attribute applied (equal re-assignments are no-ops). */
  private appliedKey: string | null = null;
  /** Whether a story has rendered into this element (hydration only once). */
  private hasRendered = false;
  private controller: StoryController | null = null;
  private observer: IntersectionObserver | null = null;
  /** Sections within a screen of the viewport (review N1). */
  private near = new Set<Element>();
  /** The chapter sections, cached per render (they don't change in between). */
  private sections: HTMLElement[] | null = null;
  private sectionList(): HTMLElement[] {
    const column = this.querySelector(":scope > .scrolly-chapters");
    if (!this.sections || this.sections.some((s) => s.parentElement !== column)) {
      this.sections = Array.from(this.querySelectorAll<HTMLElement>(":scope > .scrolly-chapters > .scrolly-chapter"));
    }
    return this.sections;
  }
  private nearObserver: IntersectionObserver | null = null;
  /** Removes the scroll/resize listeners that keep the active chapter in sync. */
  private stopScrollSync: (() => void) | null = null;
  private cancelEmptyCheck: (() => void) | null = null;
  /** Chapter the rail is scrolling to; activations in between are ignored. */
  private navTarget: string | null = null;
  private clearNav: (() => void) | null = null;
  private waiters: Waiter[] = [];
  private lastError: Error | null = null;
  private appliedClasses: string[] = [];
  /** The story came from the property, inline YAML or `config`, not `src`. */
  private storyFromElsewhere = false;

  constructor() {
    super();
    this.addEventListener("click", (event) => this.onClick(event));
    this.addEventListener("keydown", (event) => this.onKeydown(event));
    // classify: (0.9) — the story's map reports each classified layer's
    // classes as drawn (computed breaks, the data's range); the pinned
    // legend shows the same edges as the map.
    this.addEventListener("ml-map:layer-classified", (event) => {
      const detail = (event as CustomEvent<{ layerId: string; classify: ClassifyRecord }>).detail;
      if (detail) this.legend?.updateClassify(detail.layerId, detail.classify);
    });
    // A chapter photo or video that fails to load (error does not bubble:
    // capture it). The card showed a broken image with only its alt text
    // and the 404 was in the console alone (ml-aot.51).
    this.addEventListener("error", (event) => this.onMediaError(event), true);
  }

  /** Say on the card that its image or video did not load, and why it may not have. */
  private onMediaError(event: Event): void {
    const media = event.target;
    if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
    const holder = media.closest<HTMLElement>(".chapter-media");
    if (!holder || !this.contains(holder) || holder.querySelector(".chapter-media-missing")) return;
    const written = media.getAttribute("src") ?? "";
    console.warn(`[ml-scrollytelling] chapter media "${written}" didn't load (${media.currentSrc || written})`);
    media.style.display = "none";
    // `quiet`: no note on the card (the console line above stays).
    if (this.hasAttribute("quiet")) return;
    // Two readers, as on the map's notice (ml-aot.70): a visitor gets one
    // plain line; the fix sits under "Details for the site's author", open
    // while the page is served from this computer, closed on a published site.
    const doc = this.ownerDocument;
    const kind = media instanceof HTMLVideoElement ? "video" : "image";
    const note = doc.createElement("div");
    note.className = "chapter-media-missing";
    note.setAttribute("role", "status");
    const lead = doc.createElement("p");
    lead.className = "chapter-media-missing-lead";
    lead.textContent = `This chapter's ${kind} couldn't load.`;
    const details = doc.createElement("details");
    details.open = isLocalPage(doc);
    const summary = doc.createElement("summary");
    summary.textContent = "Details for the site's author";
    const fix = doc.createElement("p");
    fix.textContent =
      `${kind === "video" ? "Video" : "Image"} "${written}" didn't load. ` +
      `Check the file name and folder — capital letters count (Photo.JPG and photo.jpg are ` +
      `different files on most web servers).`;
    details.append(summary, fix);
    note.append(lead, details);
    holder.appendChild(note);
  }

  /**
   * Images that failed before this element was listening (server-rendered
   * chapters, e.g. Astro's): they are `complete` with no pixels.
   */
  private checkMediaLoaded(): void {
    for (const img of Array.from(this.querySelectorAll<HTMLImageElement>(".chapter-media img"))) {
      // Already settled before this element listened. decode() rejects only
      // for an image that failed; `naturalWidth === 0` also flagged a good
      // SVG without intrinsic size (review N5). Still loading: the captured
      // `error` event covers it.
      if (!img.complete || !img.getAttribute("src") || typeof img.decode !== "function") continue;
      img.decode().catch(() => {
        if (img.isConnected) this.onMediaError({ target: img } as unknown as Event);
      });
    }
  }

  /** Validation warnings to repeat on the map once it exists (ml-aot.48). */
  private pageWarnings: string[] = [];

  // ------------------------------------------------------------------
  // Properties
  // ------------------------------------------------------------------

  /**
   * Where the story's own paths start: reflects the `base` attribute; `null`
   * when unset. Same semantics as `<ml-map base>`: with a base, `src`, every
   * path in the story's map document (sources, images, marker icons, style)
   * and chapter `image`/`video` paths resolve against it; full URLs are never
   * changed. Handed to the story's `<ml-map>`.
   */
  get base(): string | null {
    return this.getAttribute("base");
  }

  set base(value: string | null) {
    if (value === null || value === undefined) this.removeAttribute("base");
    else this.setAttribute("base", String(value));
  }

  /** The validated story, or `null` before one loads (or after it failed). */
  get story(): ScrollytellingBlock | null {
    return this._story;
  }

  /**
   * Show a story: a `type: scrollytelling` object or its JSON string. It is
   * validated like every other path. Assigning a value JSON-equal to the
   * one shown is a no-op.
   */
  set story(value: ScrollytellingBlock | string | null) {
    if (value === null || value === undefined) return;
    if (!this.initialized) {
      this.pendingValue = value;
      return;
    }
    this.applyValue(value);
  }

  /** Alias of {@link story}, mirroring `<ml-map>`'s `config`. */
  get config(): ScrollytellingBlock | null {
    return this._story;
  }

  set config(value: ScrollytellingBlock | string | null) {
    this.story = value;
  }

  /** The active chapter's id, or `null`. */
  get activeChapterId(): string | null {
    return this.controller?.activeChapterId ?? null;
  }

  /** The story's `<ml-map>`, once the story has rendered. */
  get mapElement(): MLMap | null {
    return this.querySelector<MLMap>(":scope > .scrolly-map-container > ml-map");
  }

  /** The story's MapLibre map, or `null` before it has loaded. */
  getMap(): MapLibreMap | null {
    const el = this.mapElement;
    return el && typeof el.getMap === "function" ? el.getMap() : null;
  }

  /**
   * Resolve with the story's MapLibre map once it has loaded; reject if the
   * story or its map fails.
   */
  mapReady(): Promise<MapLibreMap> {
    const el = this._story ? this.mapElement : null;
    if (el) return customElements.whenDefined("ml-map").then(() => el.mapReady());
    if (this.lastError) return Promise.reject(this.lastError);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /**
   * Scroll to a chapter and make it active at once (the rail's click). The
   * chapters scrolled past on the way are skipped.
   */
  goToChapter(chapterId: string): void {
    const section = this.sectionFor(chapterId);
    if (!section || !this.controller) return;
    this.clearNav?.();
    this.navTarget = chapterId;
    const view = this.ownerDocument.defaultView;
    const done = () => {
      clearTimeout(timer);
      view?.removeEventListener("scrollend", done);
      if (this.clearNav === done) this.clearNav = null;
      this.navTarget = null;
    };
    const timer = setTimeout(done, 5000);
    view?.addEventListener("scrollend", done, { once: true });
    this.clearNav = done;
    this.controller.activate(chapterId);
    section.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  connectedCallback(): void {
    injectScrollytellingStyles(this.ownerDocument);
    this.upgradeProperty("base");
    this.upgradeProperty("story");
    this.upgradeProperty("config");
    // The container class the Astro component always carried: page CSS and
    // scripts written against `.scrollytelling-container` keep working.
    this.classList.add("scrollytelling-container");

    const reconnect = this.initialized === false && this._story !== null;
    this.initialized = true;
    if (reconnect) {
      this.startEngine(this._story!);
      return;
    }
    this.initialize();
  }

  disconnectedCallback(): void {
    this.cancelEmptyCheck?.();
    this.stopEngine();
    this.initialized = false;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === "quiet") {
      // Like <ml-map quiet>: no on-page notice or card notes (the console
      // keeps every message). Forwarded to the story's map.
      const mapEl = this.mapElement;
      if (mapEl) mapEl.toggleAttribute("quiet", newValue !== null);
      if (newValue !== null) this.querySelectorAll(".chapter-media-missing").forEach((n) => n.remove());
      return;
    }
    if (oldValue === newValue || !this.initialized) return;
    if (name === "base") {
      // Every path in the story may move: re-fetch `src` (its own path
      // depends on the base), or re-render the story already shown.
      if (normalizeDocumentBase(oldValue) === normalizeDocumentBase(newValue)) return;
      const src = this.getAttribute("src");
      if (src && !this.storyFromElsewhere) void this.loadFromURL(src);
      else if (this._story) this.render(this._story);
      return;
    }
    if (newValue === null) return;
    if (name === "src") void this.loadFromURL(newValue);
    else if (name === "config") this.applyValue(newValue);
  }

  private upgradeProperty(name: "story" | "config" | "base"): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const self = this as unknown as Record<string, unknown>;
      const value = self[name];
      delete self[name];
      self[name] = value;
    }
  }

  /** Find the story in priority order (see the module docs). */
  private initialize(): void {
    if (this.pendingValue !== undefined) {
      const value = this.pendingValue;
      this.pendingValue = undefined;
      this.applyValue(value);
      return;
    }
    const script = this.querySelector(
      ':scope > script[type="text/yaml"], :scope > script[type="application/yaml"]'
    );
    if (script?.textContent?.trim()) {
      this.storyFromElsewhere = true;
      this.applyResult(YAMLParser.safeParseScrollytellingBlock(script.textContent), null);
      return;
    }
    const src = this.getAttribute("src");
    if (src) {
      void this.loadFromURL(src);
      return;
    }
    const attr = this.getAttribute("config");
    if (attr) {
      this.applyValue(attr);
      return;
    }

    // Nothing yet. While the document is still parsing, the inline script
    // child may simply not have arrived (the element upgraded at its open
    // tag): look again once parsing is done.
    const doc = this.ownerDocument;
    if (doc.readyState === "loading") {
      doc.addEventListener(
        "DOMContentLoaded",
        () => {
          if (this.initialized && !this._story && this.isConnected) this.initialize();
        },
        { once: true }
      );
      return;
    }
    this.scheduleEmptyCheck();
  }

  /**
   * Report "no story" only if none arrived by the end of the next frame: a
   * module script or a framework may assign `story` right after the element
   * connects (same grace as `<ml-map>`'s empty-config check).
   */
  private scheduleEmptyCheck(): void {
    this.cancelEmptyCheck?.();
    const run = () => {
      this.cancelEmptyCheck?.();
      if (!this.initialized || this._story || this.lastError) return;
      this.fail([{ path: "", message: "No story provided." }], [], {
        title: "No story to show",
        showHelp: true,
      });
    };
    let frame: number | undefined;
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        afterFrame = setTimeout(run, 0);
      });
      fallback = setTimeout(run, 500);
    } else {
      afterFrame = setTimeout(run, 0);
    }
    this.cancelEmptyCheck = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(afterFrame);
      clearTimeout(fallback);
      this.cancelEmptyCheck = null;
    };
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  /** An object or JSON string from the property or the `config` attribute. */
  private applyValue(value: unknown): void {
    this.cancelEmptyCheck?.();
    this.storyFromElsewhere = true;
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        this.appliedKey = null;
        this.fail(
          [
            {
              path: "",
              message: `Invalid JSON for the story: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          []
        );
        return;
      }
    }
    let key: string | null = null;
    try {
      key = JSON.stringify(parsed) ?? null;
    } catch {
      key = null;
    }
    if (key !== null && key === this.appliedKey && this._story) return;
    this.appliedKey = key;
    this.applyResult(YAMLParser.safeParseScrollytellingBlockValue(parsed), null);
  }

  private async loadFromURL(url: string): Promise<void> {
    this.cancelEmptyCheck?.();
    this.appliedKey = null;
    this.storyFromElsewhere = false;
    const generation = ++this.generation;
    this.showLoading();

    // Same path rules and the same failure messages as `<ml-map src>`: with a
    // base, `src` is a site path like every path inside the story.
    const doc = this.ownerDocument;
    const target = resolveDocumentUrl(url, this.base);
    const resolved = resolveUrl(target, doc.baseURI);
    const context = { pageUrl: doc.baseURI, base: this.base };
    const stale = () => generation !== this.generation || !this.initialized;

    let response: Response;
    let text: string;
    try {
      response = await fetch(target);
      if (stale()) return;
      if (!response.ok) {
        this.failWith(srcHttpErrorCard(url, resolved, response.status, response.statusText, context), url);
        return;
      }
      text = await response.text();
    } catch (error) {
      if (stale()) return;
      this.failWith(srcFetchFailedCard(url, resolved, error, isFilePage(doc)), url);
      return;
    }
    if (stale()) return;
    if (looksLikeHtml(text, response.headers?.get?.("content-type") ?? null)) {
      this.failWith(srcHtmlCard(url, resolved, context), url);
      return;
    }
    this.applyResult(YAMLParser.safeParseScrollytellingBlock(text), url);
  }

  /** A prepared failure from the shared `<ml-map>` messages, worded for a story. */
  private failWith(content: ErrorCardContent, source: string): void {
    this.fail(content.errors, [], {
      title: content.title.replace(/([Mm])ap file/, (_m, m: string) => (m === "M" ? "Story file" : "story file")),
      source,
      hint: content.hint,
    });
  }

  private applyResult(result: ParseResult<ScrollytellingBlock>, source: string | null): void {
    this.cancelEmptyCheck?.();
    this.pageWarnings = [];
    for (const warning of result.warnings ?? []) {
      const where =
        warning.line !== undefined
          ? ` (line ${warning.line}${warning.column !== undefined ? `, column ${warning.column}` : ""})`
          : "";
      if (warning.onPage) this.pageWarnings.push(`${warning.message}${where}`);
      console.warn(
        `[ml-scrollytelling] ${source ? `${source}: ` : ""}${displayPath(warning) ? `${displayPath(warning)}: ` : ""}${warning.message}${where}`
      );
    }
    if (result.success && result.data) {
      this.render(result.data);
    } else {
      this.fail(result.errors, result.warnings ?? [], { source });
    }
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  /** The `src` loading state, unless chapters are already on the page. */
  private showLoading(): void {
    if (this.querySelector(":scope > .scrolly-chapters > .scrolly-chapter, :scope > .scrolly-chapters > .chapters-loading")) {
      return;
    }
    this.querySelector(":scope > .scrolly-error")?.remove();
    const column = this.ensureColumn();
    column.innerHTML =
      '<div class="chapters-loading" role="status"><div class="loading-spinner"></div><p>Loading story...</p></div>';
  }

  private ensureColumn(): HTMLElement {
    let column = this.querySelector<HTMLElement>(":scope > .scrolly-chapters");
    if (!column) {
      column = this.ownerDocument.createElement("div");
      column.className = "scrolly-chapters";
      this.appendChild(column);
    }
    return column;
  }

  /** Render (or hydrate server-rendered markup for) a validated story. */
  private render(story: ScrollytellingBlock): void {
    const generation = ++this.generation;
    const hydrating = !this.hasRendered;
    this.hasRendered = true;
    this._story = story;
    this.lastError = null;
    this.querySelectorAll(":scope > .scrolly-error").forEach((el) => el.remove());

    const theme = story.theme ?? "light";
    this.classList.remove("theme-light", "theme-dark");
    this.classList.add(`theme-${theme}`);
    this.classList.toggle("has-markers", story.showMarkers === true);
    this.applyBlockAttributes(story);

    // The sticky map. A server render (Astro) already put an <ml-map> with
    // its document here, and it may be loading: leave it alone.
    const doc = this.ownerDocument;
    let mapContainer = this.querySelector<HTMLElement>(":scope > .scrolly-map-container");
    if (!mapContainer) {
      mapContainer = doc.createElement("div");
      mapContainer.className = "scrolly-map-container";
      const column = this.querySelector(":scope > .scrolly-chapters");
      this.insertBefore(mapContainer, column);
    }
    let mapEl = mapContainer.querySelector<MLMap>(":scope > ml-map");
    const mapDocument = JSON.stringify(storyMapDocument(story));
    if (!mapEl) {
      mapEl = doc.createElement("ml-map") as MLMap;
      mapEl.id = `${this.id || story.id}-map`;
      this.adoptSlots(mapEl);
      // As an attribute, not the property: the document stays on the
      // element, so it re-renders if the story is moved in the DOM. Set
      // before the map connects, so it never reports "No configuration
      // provided" (ml-4al).
      this.syncMapBase(mapEl);
      mapEl.setAttribute("config", mapDocument);
      mapContainer.prepend(mapEl);
    } else {
      this.adoptSlots(mapEl);
      // A server render puts the base on <ml-map> itself; keep them in step.
      this.syncMapBase(mapEl);
      if (!hydrating || !(mapEl.hasAttribute("config") || mapEl.hasAttribute("src"))) {
        mapEl.setAttribute("config", mapDocument);
      }
    }

    // The rail.
    let rail = mapContainer.querySelector<HTMLElement>(":scope > .chapter-markers");
    if (story.showMarkers) {
      if (!rail) {
        rail = doc.createElement("nav");
        rail.className = "chapter-markers";
        mapContainer.appendChild(rail);
      }
      if (rail.tagName === "NAV") rail.setAttribute("aria-label", "Story chapters");
      rail.innerHTML = railButtonsHTML(story);
    } else {
      rail?.remove();
    }

    // The legend: pinned above the cards, in a layer of its own.
    this.mountLegend(story, mapContainer);

    // The chapters: keep server-rendered sections when they are this story's.
    const column = this.ensureColumn();
    const rendered = Array.from(
      column.querySelectorAll<HTMLElement>(":scope > .scrolly-chapter")
    ).map((section) => section.dataset.chapterId);
    const wanted = (story.chapters ?? []).map((chapter: Chapter) => chapter.id);
    const same = rendered.length === wanted.length && rendered.every((id, i) => id === wanted[i]);
    if (hydrating && same) {
      column.querySelector(":scope > .chapters-loading")?.remove();
      if (story.footer && !column.querySelector(":scope > .scrolly-footer")) {
        column.insertAdjacentHTML("beforeend", footerHTML(story));
      }
    } else {
      column.innerHTML = chaptersHTML(story, { base: this.base }) + footerHTML(story);
    }

    this.startEngine(story, generation);
  }

  /** The story's map resolves its document's paths against the story's base. */
  private syncMapBase(mapEl: MLMap): void {
    const base = this.base;
    if (base === null) mapEl.removeAttribute("base");
    else if (mapEl.getAttribute("base") !== base) mapEl.setAttribute("base", base);
    // `quiet` on the story reaches its map (review F1): no on-page notice.
    mapEl.toggleAttribute("quiet", this.hasAttribute("quiet"));
  }

  /**
   * Hand `slot="…"` children of the story to its map -- all but the legend,
   * which the story pins above its cards itself.
   */
  private adoptSlots(mapEl: MLMap): void {
    for (const child of Array.from(this.children)) {
      const name = child.getAttribute("slot");
      if (name !== null && name !== "legend" && ML_MAP_SLOTS.includes(name)) mapEl.appendChild(child);
    }
  }

  /** The story's pinned legend (see scrollytelling/story-legend). */
  private legend: StoryLegend | null = null;

  /**
   * Build the legend layer for a story: its `legend:` entries, or the
   * author's `slot="legend"` markup (on the story, or inside a
   * server-rendered map). Nothing when the story has neither.
   */
  private mountLegend(story: ScrollytellingBlock, mapContainer: HTMLElement): void {
    const slot =
      this.querySelector<HTMLElement>(':scope > [slot="legend"]') ??
      mapContainer.querySelector<HTMLElement>('ml-map [slot="legend"]') ??
      this.legend?.element.querySelector<HTMLElement>('[slot="legend"]') ??
      null;
    // Take the slot element before the old layer goes (destroy() would put
    // it back on the element).
    if (slot) this.appendChild(slot);
    this.legend?.destroy();
    this.legend = null;
    // `legend:` as written; automatic for a classified story; `false`: none
    // (an author's slot="legend" markup still shows).
    const config = storyLegendConfig(story);
    if (!config && !slot) return;
    const legend = new StoryLegend(this, { ...story, legend: (config ?? {}) as never }, slot);
    mapContainer.after(legend.layer);
    legend.layout();
    this.legend = legend;
  }

  /**
   * Lay out the pinned chrome for the screen as it is (first render, map
   * load, resize, rotation) -- never on scroll. The legend picks its corner
   * and state; on phones MapLibre's attribution stays a compact (i).
   */
  private layoutChrome(): void {
    const slot = this.legend?.element.querySelector('[slot="legend"]');
    // A server-rendered map may have mounted the legend slot itself.
    if (this.legend && !slot) {
      const stray = this.querySelector<HTMLElement>(':scope > .scrolly-map-container [slot="legend"]');
      if (stray) this.legend.element.querySelector(".scrolly-legend-panel")?.appendChild(stray);
    }
    this.legend?.layout();
    const view = this.ownerDocument.defaultView;
    const small = Boolean(view?.matchMedia?.(STORY_NARROW_QUERY).matches || view?.matchMedia?.(STORY_LANDSCAPE_QUERY).matches);
    if (!small) return;
    for (const attribution of Array.from(
      this.querySelectorAll<HTMLElement>(".maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show")
    )) {
      attribution.classList.remove("maplibregl-compact-show");
      attribution.removeAttribute("open");
    }
  }

  /** The block's own `className` / `style` land on the element. */
  private applyBlockAttributes(story: ScrollytellingBlock): void {
    for (const name of this.appliedClasses) this.classList.remove(name);
    this.appliedClasses = (story.className ?? "").split(/\s+/).filter(Boolean);
    for (const name of this.appliedClasses) this.classList.add(name);
    if (story.style && !(this.getAttribute("style") ?? "").includes(story.style)) {
      this.style.cssText += `;${story.style}`;
    }
  }

  /** The controller, the scroll observer, and the map hand-off. */
  private startEngine(story: ScrollytellingBlock, generation = this.generation): void {
    this.stopEngine();
    const controller = createStoryController(this, story, null, {
      padding: (chapter) => this.cameraPadding(chapter),
      onProblem: (message) => this.mapElement?._reportNotice(message),
      mapSize: () => {
        const box = this.querySelector(":scope > .scrolly-map-container")?.getBoundingClientRect();
        return box && box.width > 0 ? { width: box.width, height: box.height } : undefined;
      },
    });
    this.controller = controller;

    // Which chapter is active is a function of where the page is scrolled,
    // nothing else (ml-aot.44): recomputed from the live layout on every
    // scroll frame and whenever a section crosses the trigger band. Acting
    // on IntersectionObserver "entering" entries alone kept a history: after
    // scrolling back a little and forward again near a boundary, the later
    // section never re-entered the band (it never left), so the earlier
    // chapter stayed active.
    const sync = () => {
      if (this.controller !== controller) return;
      const id = this.chapterInView();
      if (id === null) return;
      // A rail jump skips the chapters it scrolls past.
      if (this.navTarget !== null) {
        if (id === this.navTarget) this.clearNav?.();
        return;
      }
      controller.activate(id);
    };
    const view = this.ownerDocument.defaultView;
    this.checkMediaLoaded();

    // Where the reader is: the active chapter's card, as a fraction of the
    // screen height. A resize (a phone rotated) changes every section's
    // height while the page keeps its scroll offset in pixels, so the reader
    // landed chapters away (ml-aot.59); the card is put back where it was.
    let anchor: { id: string; at: number } | null = null;
    let size = view ? { w: view.innerWidth, h: view.innerHeight } : { w: 0, h: 0 };
    const cardOf = (id: string) => {
      const section = this.sectionFor(id);
      return (section?.querySelector<HTMLElement>(".chapter-content") ?? section)?.getBoundingClientRect() ?? null;
    };
    const remember = () => {
      const id = controller.activeChapterId;
      const box = id ? cardOf(id) : null;
      anchor = id && box && view && view.innerHeight > 0 ? { id, at: (box.top + box.height / 2) / view.innerHeight } : null;
    };
    // The layout changed size. Order matters (ml-aot.58): put the reader's
    // card back, resize the map NOW (its own ResizeObserver runs later, so a
    // chapter camera computed first was framed for the old canvas), and
    // only then pick the chapter and re-frame it with the new padding.
    let realignTimer = 0;
    const resized = () => {
      if (!view) return;
      size = { w: view.innerWidth, h: view.innerHeight };
      if (anchor) {
        const box = cardOf(anchor.id);
        if (box) {
          const shift = box.top + box.height / 2 - anchor.at * view.innerHeight;
          if (Math.abs(shift) > 1) view.scrollTo({ top: view.scrollY + shift, behavior: "instant" as ScrollBehavior });
        }
      }
      (this.mapElement?.getMap() as { resize?: () => void } | null | undefined)?.resize?.();
      const before = controller.activeChapterId;
      sync();
      // Re-frame once the layout stops changing: a window dragged wider
      // fires dozens of resizes, and each re-frame is a camera jump.
      if (controller.activeChapterId === before) {
        if (realignTimer) view.clearTimeout(realignTimer);
        realignTimer = view.setTimeout(() => {
          realignTimer = 0;
          if (this.controller !== controller || controller.activeChapterId !== before) return;
          controller.realign();
        }, REALIGN_DELAY_MS);
      }
      // The pinned chrome is laid out for the new screen (never on scroll).
      this.layoutChrome();
      remember();
    };
    let frame = 0;
    const onScroll = () => {
      if (frame || !view) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        if (this.controller !== controller) return;
        // A scroll caused by a resize (the page got shorter) arrives as a
        // scroll: handle it as the resize it is.
        if (view.innerWidth !== size.w || view.innerHeight !== size.h) {
          resized();
          return;
        }
        sync();
        remember();
      });
    };
    const onResize = () => {
      if (!view || (view.innerWidth === size.w && view.innerHeight === size.h)) return;
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      resized();
    };
    // Page keys read the story one chapter at a time (ml-aot.67): a screen-
    // high PageDown/Space skipped the intro and left cards cut at the edges.
    // Only while the story is on screen, with focus on the page or in the
    // story (not a field, button or link), and only between chapters: before
    // the first and after the last, the key scrolls the page as usual.
    //
    // Where the last press is taking the page (ml-aot.68): a press during the
    // smooth scroll of the one before builds on that destination, so quick
    // presses (or a slow page) step one chapter each, never re-aim at the
    // same card.
    let pending: { top: number; at: number } | null = null;
    const onScrollEnd = () => {
      if (pending && view && Math.abs(view.scrollY - pending.top) > 2) pending = null; // interrupted
    };
    const onKey = (event: KeyboardEvent) => {
      if (!view || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const space = event.key === " " || event.key === "Spacebar";
      const forward = event.key === "PageDown" || (space && !event.shiftKey);
      const back = event.key === "PageUp" || (space && event.shiftKey);
      if (!forward && !back) return;
      const target = event.target instanceof Element ? event.target : null;
      const doc = this.ownerDocument;
      if (target && target !== doc.body && target !== doc.documentElement && !this.contains(target)) return;
      if (target?.closest("input, textarea, select, button, a[href], summary, [contenteditable], [role=button], [role=textbox]")) {
        return;
      }
      // The layout as it will be where the page is heading: rectangles are
      // measured now and moved by the distance still to scroll.
      const now = Date.now();
      if (pending && (Math.abs(view.scrollY - pending.top) <= 2 || now - pending.at > 2000)) pending = null;
      const from = pending ? pending.top : view.scrollY;
      const ahead = from - view.scrollY;
      const h = view.innerHeight;
      const story = this.getBoundingClientRect();
      if (story.bottom - ahead <= 0 || story.top - ahead >= h) return;
      const sections = Array.from(
        this.querySelectorAll<HTMLElement>(":scope > .scrolly-chapters > .scrolly-chapter")
      );
      const box = (i: number) => {
        const r = (sections[i]?.querySelector<HTMLElement>(".chapter-content") ?? sections[i])?.getBoundingClientRect();
        return r && r.height > 0 ? { top: r.top - ahead, bottom: r.bottom - ahead, height: r.height } : undefined;
      };
      type Box = NonNullable<ReturnType<typeof box>>;
      const mid = h / 2;
      const centre = (r: Box) => r.top + r.height / 2;
      // A card taller than the screen is read a page at a time: from its top
      // going forward, from its end going back.
      const tall = (r: Box) => r.height > h - 32;
      /** How far to scroll to put a card in reading position. */
      const place = (r: Box) => (!tall(r) ? centre(r) - mid : forward ? r.top - 16 : r.bottom - (h - 16));
      // The card being read: the one across the middle of the screen, else
      // the one on screen nearest it.
      let base = -1;
      let best = Infinity;
      sections.forEach((_, i) => {
        const r = box(i);
        if (!r || r.bottom <= 0 || r.top >= h) return;
        const d = r.top <= mid && r.bottom >= mid ? 0 : Math.abs(centre(r) - mid);
        if (d < best) {
          best = d;
          base = i;
        }
      });
      let shift: number | null = null;
      const current = base === -1 ? undefined : box(base);
      if (current && tall(current)) {
        // Inside a tall card: page through it (a screen less a few lines,
        // so a line carries over) until its end is on screen (review).
        if (forward && current.bottom > h - 16 + 1) shift = Math.min(h - 64, current.bottom - (h - 16));
        if (back && current.top < 16 - 1) shift = -Math.min(h - 64, 16 - current.top);
      }
      if (shift === null) {
        let next = -1;
        if (!current) {
          // No card on screen (before the first, after the last, or between
          // tall sections): the next card ahead of the middle, or behind it.
          sections.forEach((_, i) => {
            const c = box(i);
            if (!c) return;
            if (forward && next === -1 && centre(c) > mid + 4) next = i;
            if (back && centre(c) < mid - 4) next = i;
          });
        } else if (tall(current)) next = forward ? base + 1 : base - 1;
        else if (forward) next = place(current) > 4 ? base : base + 1;
        else next = place(current) < -4 ? base : base - 1;
        // Step over anything with no height (a section not laid out yet).
        while (next >= 0 && next < sections.length && !box(next)) next += forward ? 1 : -1;
        const target = next >= 0 ? box(next) : undefined;
        if (target) shift = place(target);
      }
      // Nothing to do, or nothing the right way (the end of the page, a card
      // already in place): the key does what it always does.
      const max = Math.max(0, (this.ownerDocument.scrollingElement ?? this.ownerDocument.documentElement).scrollHeight - h);
      const top = shift === null ? from : Math.max(0, Math.min(max, from + shift));
      if ((forward && top <= from + 1) || (back && top >= from - 1)) {
        pending = null;
        return;
      }
      event.preventDefault();
      pending = { top, at: now };
      view.scrollTo({ top, behavior: prefersReducedMotion() ? ("instant" as ScrollBehavior) : "smooth" });
    };
    this.ownerDocument.addEventListener("keydown", onKey);
    view?.addEventListener("scrollend", onScrollEnd);

    view?.addEventListener("scroll", onScroll, { passive: true, capture: true });
    view?.addEventListener("resize", onResize, { passive: true });
    // Cards also move without a scroll: the active card's scale transition
    // ends, a chapter photo loads and makes its card taller. The active
    // chapter is worked out again then too.
    this.addEventListener("transitionend", onScroll);
    this.addEventListener("load", onScroll, true);
    this.stopScrollSync = () => {
      view?.removeEventListener("scroll", onScroll, { capture: true });
      view?.removeEventListener("resize", onResize);
      this.ownerDocument.removeEventListener("keydown", onKey);
      view?.removeEventListener("scrollend", onScrollEnd);
      this.removeEventListener("transitionend", onScroll);
      this.removeEventListener("load", onScroll, true);
      if (frame) view?.cancelAnimationFrame(frame);
      frame = 0;
      if (realignTimer) view?.clearTimeout(realignTimer);
      realignTimer = 0;
    };

    if (typeof IntersectionObserver === "function") {
      // Also on band crossings: the first activation on load, layout shifts
      // (an image loading), and environments that scroll without events.
      const observer = new IntersectionObserver(
        () => {
          sync();
          onScroll();
        },
        { root: null, rootMargin: "-40% 0px -40% 0px", threshold: 0 }
      );
      this.querySelectorAll(":scope > .scrolly-chapters > .scrolly-chapter").forEach((section) =>
        observer.observe(section)
      );
      this.observer = observer;

      // The sections within a screen of the viewport: the only ones the
      // per-frame work measures (review N1).
      const nearObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) this.near.add(entry.target);
            else this.near.delete(entry.target);
          }
          onScroll();
        },
        { root: null, rootMargin: "100% 0px 100% 0px", threshold: 0 }
      );
      this.querySelectorAll(":scope > .scrolly-chapters > .scrolly-chapter").forEach((section) =>
        nearObserver.observe(section)
      );
      this.nearObserver = nearObserver;
    }

    const mapEl = this.mapElement;
    if (!mapEl) return;
    const waiters = this.waiters;
    this.waiters = [];
    const ready = customElements.whenDefined("ml-map").then(() => mapEl.mapReady());
    ready.then(
      (map) => {
        for (const w of waiters) w.resolve(map);
        if (generation === this.generation && this.controller === controller) {
          noteStoryImageRefs(mapEl.getRenderer(), story);
          for (const message of this.pageWarnings) mapEl._reportNotice(message);
          controller.setMap(map as unknown as StoryMap);
          // MapLibre's controls exist now: lay the legend out clear of them.
          this.layoutChrome();
          onScroll();
        }
      },
      (error: Error) => {
        for (const w of waiters) w.reject(error);
        if (generation === this.generation && this.controller === controller) {
          // <ml-map> shows its own card; the chapters still read and announce.
          console.warn("[ml-scrollytelling] the story's map failed to load", error);
          controller.setMap(null);
        }
      }
    );
  }

  /**
   * The chapter being read, from the layout as it is now (ml-aot.44/45):
   * the chapter whose card is on screen and nearest the middle of it (a
   * hidden chapter counts by its section). Only once the story reaches the
   * trigger band (the middle 20% of the screen); before the story and after
   * it, `null` (the active chapter stays as it is).
   *
   * Cards, not sections: on phones a card sits at the bottom of its
   * section, so a section crossing the middle used to move the map while the
   * new card was still below the screen and the previous one was being read
   * (ml-aot.45).
   */
  private chapterInView(): string | null {
    const h = this.ownerDocument.defaultView?.innerHeight ?? 0;
    const all = this.sectionList();
    if (h === 0) return all[0]?.dataset.chapterId ?? null;
    // Measure only the sections within a screen of the viewport (review N1:
    // measuring every section each frame cost ~1-2 ms with 200 chapters).
    const sections = this.near.size > 0 ? all.filter((s) => this.near.has(s)) : all;
    const boxes = sections.map((section) => ({
      id: section.dataset.chapterId ?? null,
      section: section.getBoundingClientRect(),
      card: (section.querySelector<HTMLElement>(".chapter-content") ?? section).getBoundingClientRect(),
    }));
    // The story has reached the trigger band (its top is above 60% of the
    // screen) and is still on screen. Before it and once it has scrolled
    // away: no change. (Not "a section is in the band": at the very end the
    // footer fills the band while the last card is still being read.)
    const reached = boxes.some((b) => b.section.top <= h * 0.6 && b.section.bottom > 0);
    if (!reached) return null;
    const middle = h / 2;
    let best: { id: string | null; distance: number } | null = null;
    for (const b of boxes) {
      if (!b.id || b.card.height === 0 || b.card.bottom <= 0 || b.card.top >= h) continue;
      const distance = Math.abs((b.card.top + b.card.bottom) / 2 - middle);
      if (!best || distance < best.distance) best = { id: b.id, distance };
    }
    if (best) return best.id;
    // No card on screen (a card taller than the screen, scrolled through):
    // the section under the middle of the screen.
    const under = boxes.find((b) => b.section.top <= middle && b.section.bottom >= middle);
    return under?.id ?? null;
  }

  private stopEngine(): void {
    this.stopScrollSync?.();
    this.stopScrollSync = null;
    this.nearObserver?.disconnect();
    this.nearObserver = null;
    this.near.clear();
    this.sections = null;
    this.observer?.disconnect();
    this.observer = null;
    this.controller?.destroy();
    this.controller = null;
    this.clearNav?.();
  }

  /**
   * The one error card (ml-aot.7): no map is rendered, so `<ml-map>` never
   * shows a second, misleading card behind it.
   */
  private fail(
    errors: ParseError[],
    warnings: ValidationWarning[],
    opts: { title?: string; source?: string | null; showHelp?: boolean; hint?: string } = {}
  ): void {
    ++this.generation;
    this.stopEngine();
    this._story = null;
    this.legend?.destroy();
    this.legend = null;
    this.querySelector(":scope > .scrolly-map-container")?.remove();
    this.querySelector(":scope > .scrolly-chapters")?.remove();
    this.querySelectorAll(":scope > .scrolly-error").forEach((el) => el.remove());
    this.classList.remove("has-markers");
    delete this.dataset.activeChapter;

    const source = opts.source ?? null;
    this.insertAdjacentHTML(
      "beforeend",
      errorCardHTML(errors as StoryProblem[], {
        title: opts.title,
        source: source ?? undefined,
        warnings: warnings as StoryProblem[],
        showHelp: opts.showHelp,
        hint: opts.hint,
      })
    );

    const message = errors.map((e) => (displayPath(e) ? `${displayPath(e)}: ${e.message}` : e.message)).join("; ");
    this.lastError = Object.assign(
      new Error(`[ml-scrollytelling] ${source ? `${source}: ` : ""}${message}`),
      { errors }
    );
    console.error(this.lastError.message);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(this.lastError);

    this.dispatchEvent(
      new CustomEvent("ml-scrollytelling:error", {
        bubbles: true,
        detail: { errors, warnings, source },
      })
    );
  }

  // ------------------------------------------------------------------
  // Layout helpers
  // ------------------------------------------------------------------

  private sectionFor(chapterId: string): HTMLElement | null {
    for (const section of Array.from(
      this.querySelectorAll<HTMLElement>(":scope > .scrolly-chapters > .scrolly-chapter")
    )) {
      if (section.dataset.chapterId === chapterId) return section;
    }
    return null;
  }

  /**
   * The part of the map a chapter's card covers, as camera padding, so the
   * chapter's `center` lands in the part the reader can see (ml-aot.8).
   *
   * @remarks
   * Narrow screens (and short landscape ones) stack the card low in the
   * chapter: pad the bottom by the card and the space under it. Wide screens
   * pad the side a left/right card sits on; a centred or full-width card
   * sits over the middle of the map, so the camera is offset upward to put
   * the chapter's `center` above it (ml-aot.39, ml-aot.50). Hidden chapters
   * keep the plain centre. At most 60% of the map (75% above a centred or
   * full-width card), so a huge card never squeezes the map to nothing.
   */
  private cameraPadding(chapter: Chapter): CameraPadding | undefined {
    const zero: CameraPadding = { top: 0, right: 0, bottom: 0, left: 0 };
    // The author's own padding, as written; or no offset at all when the
    // story turns it off (review N4).
    const own = (chapter as { padding?: number | Partial<CameraPadding> }).padding;
    if (typeof own === "number") return { top: own, right: own, bottom: own, left: own };
    if (own && typeof own === "object") return { ...zero, ...own };
    if ((this._story as { cameraOffset?: boolean } | null)?.cameraOffset === false) return zero;
    const mapBox = this.querySelector(":scope > .scrolly-map-container")?.getBoundingClientRect();
    const section = this.sectionFor(chapter.id);
    const card = section?.querySelector<HTMLElement>(".chapter-content");
    if (!mapBox || mapBox.width === 0 || !section || !card || chapter.hidden) return zero;
    const box = card.getBoundingClientRect();
    const view = this.ownerDocument.defaultView;
    const narrow = view?.matchMedia?.(NARROW_QUERY).matches ?? false;
    const cap = (value: number, size: number) => Math.round(Math.max(0, Math.min(value, size * 0.6)));

    if (narrow) {
      const below = parseFloat(view?.getComputedStyle(section).paddingBottom ?? "0") || 0;
      return { ...zero, bottom: cap(box.height + below, mapBox.height) };
    }
    // A card beside the map's centre pads that side. Measured, not read from
    // `alignment`: on a phone on its side centred cards sit on the left.
    const middle = (box.left + box.right) / 2;
    const mapMiddle = (mapBox.left + mapBox.right) / 2;
    if (box.width < mapBox.width * 0.6) {
      if (middle < mapMiddle - mapBox.width * 0.1) {
        return { ...zero, left: cap(box.right - mapBox.left + 16, mapBox.width) };
      }
      if (middle > mapMiddle + mapBox.width * 0.1) {
        return { ...zero, right: cap(mapBox.right - box.left + 16, mapBox.width) };
      }
    }
    // Centred and full-width: the card rests centred on the map (the
    // chapter is one map-height tall and centres it): pad from its top edge
    // down. The strip above a tall card (a chapter image) is all the reader
    // sees of the map, so this one may take up to 75%.
    const bottom = mapBox.height / 2 + box.height / 2 + 16;
    return { ...zero, bottom: Math.round(Math.max(0, Math.min(bottom, mapBox.height * 0.75))) };
  }

  // ------------------------------------------------------------------
  // The rail: click and keyboard
  // ------------------------------------------------------------------

  private markerFrom(target: EventTarget | null): HTMLElement | null {
    const el = target instanceof Element ? target.closest<HTMLElement>(".chapter-marker") : null;
    return el && this.contains(el) ? el : null;
  }

  private onClick(event: Event): void {
    const marker = this.markerFrom(event.target);
    if (!marker?.dataset.chapterId) return;
    event.preventDefault();
    this.goToChapter(marker.dataset.chapterId);
  }

  /** Arrow keys / Home / End move along the rail (Enter and Space click). */
  private onKeydown(event: KeyboardEvent): void {
    const marker = this.markerFrom(event.target);
    if (!marker) return;
    const markers = Array.from(this.querySelectorAll<HTMLElement>(".chapter-marker"));
    const i = markers.indexOf(marker);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = markers[Math.min(i + 1, markers.length - 1)];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = markers[Math.max(i - 1, 0)];
        break;
      case "Home":
        next = markers[0];
        break;
      case "End":
        next = markers[markers.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (!next || next === marker) return;
    next.focus();
    if (next.dataset.chapterId) this.goToChapter(next.dataset.chapterId);
  }
}

/** Typed listener overloads (declaration merging; no runtime code). */
export interface MLScrollytelling {
  addEventListener<K extends keyof MLScrollytellingEventMap>(
    type: K,
    listener: (this: MLScrollytelling, event: MLScrollytellingEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLScrollytelling, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof MLScrollytellingEventMap>(
    type: K,
    listener: (this: MLScrollytelling, event: MLScrollytellingEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: MLScrollytelling, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "ml-scrollytelling": MLScrollytelling;
  }
}

/** Register `<ml-scrollytelling>` (and the `<ml-map>` it renders). */
export function registerMLScrollytelling(): void {
  if (typeof window === "undefined") return;
  registerMLMap();
  if (!customElements.get("ml-scrollytelling")) {
    customElements.define("ml-scrollytelling", MLScrollytelling);
  }
}
