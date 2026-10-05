/**
 * @file Browser controller for the Scrollytelling component
 * @module @maplibre-yaml/astro/client/scrollytelling
 *
 * @description
 * Everything `<Scrollytelling>` does in the browser, as one bundled module:
 *
 * - loads a `src` story (fetch + parse + validate), renders its chapters and
 *   hands the story's map document to `<ml-map>` (ml-euv: this used to be an
 *   `is:inline` script importing the bare specifier `@maplibre-yaml/core`,
 *   which no browser resolves, so every `src` story hung on "Loading story");
 * - drives the map from the scroll position (camera, layer visibility);
 * - runs every chapter action the schema accepts -- `setFilter`,
 *   `setPaintProperty`, `setLayoutProperty`, `flyTo`, `easeTo`, `fitBounds`
 *   and `custom` (ml-97k: the last four used to validate and do nothing);
 * - honours `rotateAnimation`, `spinGlobe`, the chapter `callback` and the
 *   block's `className`/`style`.
 *
 * Nothing here touches the DOM at import time, so the Astro frontmatter can
 * share {@link storyMapDocument} with the browser.
 *
 * ## Events (dispatched on the `.scrollytelling-container`, bubbling)
 *
 * - `ml-scrollytelling:chapter` -- a chapter became active. `detail`:
 *   `{ chapterId, previousChapterId, index, callback, map }`. `callback` is
 *   the chapter's `callback:` name, for a page script to dispatch on.
 * - `ml-scrollytelling:action` -- a `custom` chapter action ran. `detail`:
 *   `{ action, chapterId, phase: "enter" | "exit", map }`.
 *
 * The container also carries `data-active-chapter` with the active id.
 */

import type {
  Chapter,
  ChapterAction,
  ScrollytellingBlock,
} from "@maplibre-yaml/core/schemas";

/** The slice of a maplibre `Map` the controller drives. */
export interface StoryMap {
  flyTo(options: Record<string, unknown>): unknown;
  easeTo(options: Record<string, unknown>): unknown;
  jumpTo(options: Record<string, unknown>): unknown;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): unknown;
  rotateTo(bearing: number, options?: Record<string, unknown>): unknown;
  getBearing(): number;
  getCenter(): { lng: number; lat: number };
  getLayer(id: string): unknown;
  setFilter(layer: string, filter: unknown): unknown;
  setPaintProperty(layer: string, property: string, value: unknown): unknown;
  setLayoutProperty(layer: string, property: string, value: unknown): unknown;
  once(type: string, listener: () => void): unknown;
}

/** The `<ml-map>` element API the controller needs. */
interface MLMapElement extends HTMLElement {
  mapReady(): Promise<StoryMap>;
}

export const CHAPTER_EVENT = "ml-scrollytelling:chapter";
export const ACTION_EVENT = "ml-scrollytelling:action";

/**
 * The map half of a story as a map document for `<ml-map>`.
 *
 * @remarks
 * A story's map is its `config:` plus `layers:` (inline sources). Shared by
 * the server render (`config` prop) and the `src` loader so both paths hand
 * `<ml-map>` the same document.
 */
export function storyMapDocument(story: ScrollytellingBlock) {
  return {
    type: "map" as const,
    id: `${story.id}-map`,
    config: story.config,
    layers: story.layers ?? [],
  };
}

/** Escape text for interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
}

/**
 * Media URLs are schema-validated with zod's `.url()`, which accepts
 * `javascript:` and `data:` as well-formed. Relative and http(s) only.
 */
export function safeMediaSrc(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
  if (/^(\/|\.\.?\/|#|\?)/.test(cleaned)) return cleaned;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return /^[^/?#]*:/.test(cleaned) ? null : cleaned;
}

interface ActionContext {
  container: HTMLElement;
  chapterId: string;
  phase: "enter" | "exit";
}

/**
 * Run one chapter action against the map.
 *
 * @remarks
 * Layer actions skip a layer the map does not have (the style may still be
 * loading it, or the id is a typo -- warned once per call). Camera actions
 * take their camera from `options` (`center`, `zoom`, `bearing`, `pitch`,
 * `duration`, ...); `fitBounds` takes `bounds: [west, south, east, north]`.
 * `custom` runs nothing itself: it dispatches {@link ACTION_EVENT}.
 */
export function runChapterAction(map: StoryMap, action: ChapterAction, ctx: ActionContext): void {
  const options = (action.options ?? {}) as Record<string, unknown>;
  const needsLayer = (): boolean => {
    if (action.layer && map.getLayer(action.layer)) return true;
    console.warn(
      `[Scrollytelling] ${action.action} in chapter "${ctx.chapterId}": no layer "${action.layer ?? ""}" on the map`
    );
    return false;
  };

  switch (action.action) {
    case "setFilter":
      if (needsLayer()) map.setFilter(action.layer!, action.filter ?? null);
      break;
    case "setPaintProperty":
      if (needsLayer() && action.property) map.setPaintProperty(action.layer!, action.property, action.value);
      break;
    case "setLayoutProperty":
      if (needsLayer() && action.property) map.setLayoutProperty(action.layer!, action.property, action.value);
      break;
    case "flyTo":
      map.flyTo({ ...options });
      break;
    case "easeTo":
      map.easeTo({ ...options });
      break;
    case "fitBounds": {
      const b = action.bounds;
      if (!b || b.length !== 4) {
        console.warn(
          `[Scrollytelling] fitBounds in chapter "${ctx.chapterId}" needs bounds: [west, south, east, north]`
        );
        break;
      }
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        options
      );
      break;
    }
    case "custom":
      ctx.container.dispatchEvent(
        new CustomEvent(ACTION_EVENT, {
          bubbles: true,
          detail: { action, chapterId: ctx.chapterId, phase: ctx.phase, map },
        })
      );
      break;
  }
}

/** Seconds per ambient step (one quarter turn / 20° of longitude). */
const AMBIENT_STEP_MS = 8000;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The scroll-driven half: activates chapters, moves the camera, toggles
 * layers, runs actions. Returned for tests; the component wires it to an
 * IntersectionObserver.
 */
export function createStoryController(container: HTMLElement, story: ScrollytellingBlock, map: StoryMap) {
  const chapters: Chapter[] = story.chapters ?? [];
  let activeId: string | null = null;

  const startAmbient = (chapter: Chapter, jumped: boolean) => {
    if (!chapter.rotateAnimation && !chapter.spinGlobe) return;
    if (prefersReducedMotion()) return;
    const step = () => {
      if (activeId !== chapter.id) return; // a later chapter took over
      if (chapter.rotateAnimation) {
        map.rotateTo(map.getBearing() + 90, { duration: AMBIENT_STEP_MS, easing: (t: number) => t });
      } else {
        const c = map.getCenter();
        map.easeTo({ center: [c.lng - 20, c.lat], duration: AMBIENT_STEP_MS, easing: (t: number) => t });
      }
      map.once("moveend", step);
    };
    // After the chapter's own transition. jumpTo has already fired its
    // moveend synchronously, so there is nothing to wait for.
    if (jumped) step();
    else map.once("moveend", step);
  };

  function activate(chapterId: string): void {
    if (chapterId === activeId) return;
    const index = chapters.findIndex((c) => c.id === chapterId);
    const chapter = chapters[index];
    if (!chapter) return;
    const previousId = activeId;
    activeId = chapterId;
    container.dataset.activeChapter = chapterId;

    container.querySelectorAll<HTMLElement>(".scrolly-chapter").forEach((section) => {
      section.classList.toggle("is-active", section.dataset.chapterId === chapterId);
    });
    container.querySelectorAll<HTMLElement>(".chapter-marker").forEach((marker) => {
      marker.classList.toggle("active", marker.dataset.chapterId === chapterId);
    });

    const previous = chapters.find((c) => c.id === previousId);
    for (const action of previous?.onChapterExit ?? []) {
      runChapterAction(map, action, { container, chapterId: previous!.id, phase: "exit" });
    }

    const camera = {
      center: chapter.center,
      zoom: chapter.zoom,
      pitch: chapter.pitch ?? 0,
      bearing: chapter.bearing ?? 0,
    };
    const animation = chapter.animation ?? "flyTo";
    if (animation === "jumpTo") map.jumpTo(camera);
    else if (animation === "easeTo") map.easeTo(camera);
    else map.flyTo({ ...camera, speed: chapter.speed ?? 0.6, curve: chapter.curve ?? 1 });

    for (const id of chapter.layers?.show ?? []) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    }
    for (const id of chapter.layers?.hide ?? []) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }

    for (const action of chapter.onChapterEnter ?? []) {
      runChapterAction(map, action, { container, chapterId, phase: "enter" });
    }

    startAmbient(chapter, animation === "jumpTo");

    container.dispatchEvent(
      new CustomEvent(CHAPTER_EVENT, {
        bubbles: true,
        detail: {
          chapterId,
          previousChapterId: previousId,
          index,
          callback: chapter.callback ?? null,
          map,
        },
      })
    );
  }

  return {
    activate,
    get activeChapterId() {
      return activeId;
    },
  };
}

/** Build one chapter section -- the DOM Chapter.astro renders server-side. */
export function renderChapterElement(chapter: Chapter, theme: string, isActive: boolean): HTMLElement {
  const section = document.createElement("section");
  section.className = `scrolly-chapter align-${chapter.alignment ?? "center"} theme-${theme}`;
  if (chapter.hidden) section.classList.add("is-hidden");
  if (isActive) section.classList.add("is-active");
  section.dataset.chapterId = chapter.id;
  section.setAttribute("role", "region");
  section.setAttribute("aria-labelledby", `chapter-title-${chapter.id}`);
  if (chapter.hidden) return section;

  let html = "";
  const image = chapter.image ? safeMediaSrc(chapter.image) : null;
  if (image !== null) {
    html += `<div class="chapter-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(chapter.title)}" loading="lazy" decoding="async" /></div>`;
  }
  const video = chapter.video ? safeMediaSrc(chapter.video) : null;
  if (video !== null) {
    html += `<div class="chapter-media"><video src="${escapeHtml(video)}" controls playsinline preload="metadata">Your browser does not support the video element.</video></div>`;
  }
  html += `<h2 class="chapter-title" id="chapter-title-${escapeHtml(chapter.id)}">${escapeHtml(chapter.title)}</h2>`;
  if (chapter.description) {
    // NOT escaped: the schema documents this as "Chapter description
    // (HTML/markdown supported)" -- the same contract Chapter.astro's
    // set:html honours. Trust model tracked as ml-2l7.2.
    html += `<div class="chapter-description">${chapter.description}</div>`;
  }
  const content = document.createElement("div");
  content.className = "chapter-content";
  content.innerHTML = html;
  section.appendChild(content);
  return section;
}

function renderMarkerRail(container: HTMLElement, story: ScrollytellingBlock): void {
  if (!story.showMarkers) return;
  let rail = container.querySelector<HTMLElement>(".chapter-markers");
  if (!rail) {
    rail = document.createElement("div");
    rail.className = "chapter-markers";
    container.querySelector(".scrolly-map-container")?.appendChild(rail);
  }
  rail.replaceChildren(
    ...story.chapters.map((chapter: Chapter, index: number) => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "chapter-marker";
      marker.dataset.chapterId = chapter.id;
      marker.setAttribute("aria-label", `Go to chapter ${index + 1}: ${chapter.title}`);
      marker.style.background = story.markerColor ?? "#3FB1CE";
      marker.addEventListener("click", () => {
        container
          .querySelector(`.scrolly-chapter[data-chapter-id="${CSS.escape(chapter.id)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return marker;
    })
  );
}

function showLoadError(container: HTMLElement, title: string, lines: string[]): void {
  const target = container.querySelector(".scrolly-chapters");
  if (!target) return;
  target.innerHTML = `<div class="scrolly-error" role="alert"><h2>${escapeHtml(title)}</h2><ul>${lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("")}</ul></div>`;
}

/** Fetch, parse and validate a `src` story; render its chapters and map. */
async function loadSrcStory(container: HTMLElement, src: string): Promise<ScrollytellingBlock | null> {
  let text: string;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    text = await response.text();
  } catch (error) {
    showLoadError(container, "Could not load story", [`${src}: ${(error as Error).message}`]);
    console.error(`[Scrollytelling] failed to fetch ${src}`, error);
    return null;
  }

  // Lazy: only pages with a `src` story pay for the parser chunk.
  const { YAMLParser } = await import("@maplibre-yaml/core");
  const result = YAMLParser.safeParseScrollytellingBlock(text);
  if (!result.success || !result.data) {
    showLoadError(
      container,
      "Configuration Error",
      result.errors.map((e: { path?: string; message: string }) => (e.path ? `${e.path}: ${e.message}` : e.message))
    );
    console.error(`[Scrollytelling] ${src} failed validation`, result.errors);
    return null;
  }
  const story = result.data as ScrollytellingBlock;
  const theme = story.theme ?? "light";

  container.classList.remove("theme-light", "theme-dark");
  container.classList.add(`theme-${theme}`);
  applyBlockAttributes(container, story);

  const chaptersEl = container.querySelector<HTMLElement>(".scrolly-chapters")!;
  chaptersEl.querySelector(".chapters-loading")?.remove();
  const footer = chaptersEl.querySelector(".scrolly-footer");
  story.chapters.forEach((chapter: Chapter, index: number) => {
    chaptersEl.insertBefore(renderChapterElement(chapter, theme, index === 0), footer);
  });
  if (story.footer && !footer) {
    const el = document.createElement("footer");
    el.className = "scrolly-footer";
    // NOT escaped: schema documents this as "Footer content (HTML)" (ml-2l7.2).
    el.innerHTML = story.footer;
    chaptersEl.appendChild(el);
  }

  container.querySelector("ml-map")?.setAttribute("config", JSON.stringify(storyMapDocument(story)));
  return story;
}

/** The block's own `className` / `style` land on the container. */
function applyBlockAttributes(container: HTMLElement, story: ScrollytellingBlock): void {
  if (story.className) container.classList.add(...story.className.split(/\s+/).filter(Boolean));
  if (story.style) container.style.cssText += `;${story.style}`;
}

/** Bring one `.scrollytelling-container` to life. */
export async function initScrollytelling(container: HTMLElement): Promise<void> {
  if (container.dataset.storyInit) return;
  container.dataset.storyInit = "1";

  let story: ScrollytellingBlock | null = null;
  const inline = container.getAttribute("data-config");
  if (inline) {
    story = JSON.parse(inline) as ScrollytellingBlock;
  } else if (container.dataset.src) {
    story = await loadSrcStory(container, container.dataset.src);
  }
  if (!story) return;
  renderMarkerRail(container, story);

  const mapEl = container.querySelector<MLMapElement>("ml-map");
  if (!mapEl) return;
  let map: StoryMap;
  try {
    await customElements.whenDefined("ml-map");
    map = await mapEl.mapReady();
  } catch (error) {
    // <ml-map> shows its own error card; there is nothing to drive.
    console.warn("[Scrollytelling] map failed to load", error);
    return;
  }

  const controller = createStoryController(container, story, map);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.chapterId;
        if (entry.isIntersecting && id) controller.activate(id);
      }
    },
    { root: null, rootMargin: "-40% 0px -40% 0px", threshold: 0 }
  );
  container.querySelectorAll(".scrolly-chapter").forEach((section) => observer.observe(section));
}

/** Initialise every story on the page. */
export function initAllScrollytelling(root: ParentNode = document): void {
  root
    .querySelectorAll<HTMLElement>(".scrollytelling-container")
    .forEach((container) => void initScrollytelling(container));
}
