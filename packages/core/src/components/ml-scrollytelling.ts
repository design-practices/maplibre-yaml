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
 * Children with `slot="top-left|top-right|bottom-left|bottom-right|legend"`
 * are handed to the story's map, as on `<ml-map>`.
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
import { noteStoryImageRefs } from "../utils/image-refs.js";
import { ML_MAP_SLOTS, registerMLMap, type MLMap } from "./ml-map.js";
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
const NARROW_QUERY = "(max-width: 768px), (max-height: 500px) and (max-width: 1000px)";

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
    return ["src", "config", "base"];
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
    const note = this.ownerDocument.createElement("p");
    note.className = "chapter-media-missing";
    note.setAttribute("role", "status");
    note.textContent =
      `${media instanceof HTMLVideoElement ? "Video" : "Image"} "${written}" didn't load. ` +
      `Check the file name and folder — capital letters count (Photo.JPG and photo.jpg are ` +
      `different files on GitHub Pages).`;
    media.style.display = "none";
    holder.appendChild(note);
    console.warn(`[ml-scrollytelling] chapter media "${written}" didn't load (${media.currentSrc || written})`);
  }

  /**
   * Images that failed before this element was listening (server-rendered
   * chapters, e.g. Astro's): they are `complete` with no pixels.
   */
  private checkMediaLoaded(): void {
    for (const img of Array.from(this.querySelectorAll<HTMLImageElement>(".chapter-media img"))) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
        this.onMediaError({ target: img } as unknown as Event);
      }
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
        `[ml-scrollytelling] ${source ? `${source}: ` : ""}${warning.path ? `${warning.path}: ` : ""}${warning.message}${where}`
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
  }

  /** Hand `slot="…"` children of the story to its map. */
  private adoptSlots(mapEl: MLMap): void {
    for (const child of Array.from(this.children)) {
      const name = child.getAttribute("slot");
      if (name !== null && ML_MAP_SLOTS.includes(name)) mapEl.appendChild(child);
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
    let frame = 0;
    const onScroll = () => {
      if (frame || !view) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        sync();
        if (this.controller === controller) this.placeChrome();
      });
    };
    view?.addEventListener("scroll", onScroll, { passive: true, capture: true });
    view?.addEventListener("resize", onScroll, { passive: true });
    this.stopScrollSync = () => {
      view?.removeEventListener("scroll", onScroll, { capture: true });
      view?.removeEventListener("resize", onScroll);
      if (frame) view?.cancelAnimationFrame(frame);
      frame = 0;
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
          // The legend and slots mount as the map loads: place them now.
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
    const sections = Array.from(
      this.querySelectorAll<HTMLElement>(":scope > .scrolly-chapters > .scrolly-chapter")
    );
    if (h === 0) return sections[0]?.dataset.chapterId ?? null;
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

    const message = errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ");
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
    const alignment = chapter.alignment ?? "center";
    if (alignment === "left") return { ...zero, left: cap(box.right - mapBox.left + 16, mapBox.width) };
    if (alignment === "right") return { ...zero, right: cap(mapBox.right - box.left + 16, mapBox.width) };
    // Centred and full-width: the card rests centred on the map (the
    // chapter is one map-height tall and centres it): pad from its top edge
    // down. The strip above a tall card (a chapter image) is all the reader
    // sees of the map, so this one may take up to 75%.
    const bottom = mapBox.height / 2 + box.height / 2 + 16;
    return { ...zero, bottom: Math.round(Math.max(0, Math.min(bottom, mapBox.height * 0.75))) };
  }

  /**
   * Keep the map's corner chrome (legend, slots, params panel) out from
   * under the chapter cards (ml-aot.39, ml-aot.50). The cards scroll over
   * the map above its chrome, so a legend in any corner was covered by
   * every card passing through it -- on phones for most of each chapter.
   * Each frame, every corner the cards overlap sideways is moved
   * vertically to the nearest spot no card covers, never closer to the
   * edge than its own inset (which clears MapLibre's scale bar and
   * attribution) and never off the map. With no free spot it stays home.
   * The offset is a CSS variable the stylesheet reads, so it composes with
   * ChromeLayout's own placement instead of overriding it.
   */
  private placeChrome(): void {
    const container = this.querySelector<HTMLElement>(":scope > .scrolly-map-container");
    if (!container) return;
    const mapBox = container.getBoundingClientRect();
    if (mapBox.height === 0) return;
    const cards = Array.from(
      this.querySelectorAll<HTMLElement>(":scope > .scrolly-chapters .chapter-content")
    )
      .map((card) => card.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.bottom > mapBox.top && r.top < mapBox.bottom);
    const set = (el: HTMLElement, name: string, px: number | null) => {
      const value = px === null ? "" : `${Math.round(px)}px`;
      if (el.style.getPropertyValue(name) === value) return;
      if (value) el.style.setProperty(name, value);
      else el.style.removeProperty(name);
    };
    for (const corner of Array.from(container.querySelectorAll<HTMLElement>(".ml-map-chrome"))) {
      const bottom = /-bottom-/.test(corner.className);
      const left = /-left\b/.test(corner.className);
      const yVar = bottom ? "--ml-scrolly-chrome-bottom" : "--ml-scrolly-chrome-top";
      const insetY = parseFloat(corner.style.getPropertyValue("--ml-chrome-inset")) || 10;
      const insetX = 10;
      const { width, height } = corner.getBoundingClientRect();
      if (height === 0 || width === 0) continue;
      // Offsets from the corner's own edges: home, then just past each card
      // (vertically: above/below it; sideways: beside it).
      const ys = [
        insetY,
        ...cards.map((r) => (bottom ? mapBox.bottom - r.top + 10 : r.bottom - mapBox.top + 10)),
      ].filter((o) => o >= insetY && o + height <= mapBox.height - 10);
      const xs = [
        insetX,
        ...cards.map((r) => (left ? r.right - mapBox.left + 10 : mapBox.right - r.left + 10)),
      ].filter((o) => o >= insetX && o + width <= mapBox.width - 10);
      let best: { x: number; y: number; cost: number } | null = null;
      for (const x of xs) {
        for (const y of ys) {
          const l = left ? mapBox.left + x : mapBox.right - x - width;
          const t = bottom ? mapBox.bottom - y - height : mapBox.top + y;
          const covered = cards.some((r) => r.left < l + width && l < r.right && r.top < t + height && t < r.bottom);
          if (covered) continue;
          // Prefer the smallest move, and up/down over sideways.
          const cost = (y - insetY) + 2 * (x - insetX);
          if (!best || cost < best.cost) best = { x, y, cost };
        }
      }
      set(corner, yVar, best && best.y !== insetY ? best.y : null);
      set(corner, "--ml-scrolly-chrome-x", best && best.x !== insetX ? best.x : null);
    }
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
