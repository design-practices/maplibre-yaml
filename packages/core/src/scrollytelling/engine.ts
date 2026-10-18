/**
 * @file The scrollytelling engine: chapter activation, camera, layers, actions
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @description
 * Everything that turns "chapter X became active" into map changes, shared by
 * `<ml-scrollytelling>` (plain HTML, CDN, bundlers) and Astro's
 * `<Scrollytelling>`, which renders that element. This used to live in
 * `@maplibre-yaml/astro` only, so a story outside Astro had no runtime at all.
 *
 * Nothing here touches the DOM at import time, so server renderers (Astro
 * frontmatter) can import {@link storyMapDocument} without a browser.
 *
 * ## Events (dispatched on the story element, bubbling)
 *
 * - `ml-scrollytelling:chapter` -- a chapter became active. `detail`:
 *   `{ chapterId, previousChapterId, index, callback, map }`. `callback` is
 *   the chapter's `callback:` name, for a page script to dispatch on.
 * - `ml-scrollytelling:action` -- a `custom` chapter action ran. `detail`:
 *   `{ action, chapterId, phase: "enter" | "exit", map }`.
 *
 * The element also carries `data-active-chapter` with the active id.
 */

import type {
  Chapter,
  ChapterAction,
  ScrollytellingBlock,
} from "../schemas/scrollytelling.schema";
import { STORY_MAP_KEYS } from "./keys";
import { suggest } from "../utils/suggest";

/** The slice of a maplibre `Map` the engine drives. */
export interface StoryMap {
  flyTo(options: Record<string, unknown>): unknown;
  easeTo(options: Record<string, unknown>): unknown;
  jumpTo(options: Record<string, unknown>): unknown;
  fitBounds(
    bounds: [[number, number], [number, number]],
    options?: Record<string, unknown>
  ): unknown;
  rotateTo(bearing: number, options?: Record<string, unknown>): unknown;
  getBearing(): number;
  getCenter(): { lng: number; lat: number };
  getLayer(id: string): unknown;
  setFilter(layer: string, filter: unknown): unknown;
  setPaintProperty(layer: string, property: string, value: unknown): unknown;
  setLayoutProperty(layer: string, property: string, value: unknown): unknown;
  once(type: string, listener: () => void): unknown;
}

/** Camera padding in pixels, MapLibre's `PaddingOptions`. */
export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const CHAPTER_EVENT = "ml-scrollytelling:chapter";
export const ACTION_EVENT = "ml-scrollytelling:action";

/**
 * Gesture handlers a story map starts with turned off.
 *
 * @remarks
 * A story's map is driven by the scroll position, and the reader's wheel and
 * finger must scroll the page. With these off, the chapter column can let
 * pointer events through to the map, so the marker rail, legend, params
 * panel, markers, popups and corner slots are all clickable while the wheel
 * and touch still scroll the story (ml-07q). A story that sets any of them
 * in its `config:` keeps its own value.
 */
export const STORY_GESTURE_DEFAULTS: Readonly<Record<string, boolean>> = {
  scrollZoom: false,
  dragPan: false,
  dragRotate: false,
  touchZoomRotate: false,
  touchPitch: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
};

/**
 * The map half of a story as a `type: map` document for `<ml-map>`.
 *
 * @remarks
 * A story's map is its `config:` (with {@link STORY_GESTURE_DEFAULTS} under
 * it), its `layers:`, and every map-level key it shares with a map document
 * (`sources:`, `markers:`, `legend:`, `state:`/`parameters:`, `images:`, ...
 * -- ml-t2x). Shared by the server render and the browser so both paths hand
 * `<ml-map>` the same document.
 */
export function storyMapDocument(story: ScrollytellingBlock): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    type: "map",
    id: `${story.id}-map`,
    config: { ...STORY_GESTURE_DEFAULTS, ...(story.config ?? {}) },
    layers: story.layers ?? [],
  };
  const source = story as Record<string, unknown>;
  for (const key of STORY_MAP_KEYS) {
    if (source[key] !== undefined) doc[key] = source[key];
  }
  return doc;
}

/** Whether the reader asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Context one chapter action runs in. */
export interface ActionContext {
  /** The story element; `custom` actions dispatch on it. */
  container: HTMLElement;
  chapterId: string;
  phase: "enter" | "exit";
  /**
   * The chapter the action belongs to. `fitBounds` takes its pitch and
   * bearing from it unless the action sets them (ml-aot.9).
   */
  chapter?: Chapter;
  /** Camera moves happen instantly (prefers-reduced-motion, ml-cxk). */
  reducedMotion?: boolean;
  /**
   * The chapter's camera padding (the part of the map its card covers).
   * `fitBounds` frames its bounds inside it.
   */
  padding?: CameraPadding;
  /** The map's size in CSS pixels, so padding never exceeds it. */
  mapSize?: { width: number; height: number };
  /** Report a problem the reader should see (a layer the map doesn't have). */
  onProblem?: (message: string) => void;
  /** The document's layer ids, for a did-you-mean. */
  layerIds?: string[];
}

/**
 * The card padding a `fitBounds` action may keep. MapLibre adds the map's
 * padding to the action's own, and refuses ("Map cannot fit within canvas")
 * when the two leave no room: a centred card's bottom padding (up to 75%)
 * plus `padding: 100` did exactly that, and the camera never moved. Shrink
 * the card padding on each axis so at least a fifth of the map is left for
 * the bounds after both paddings.
 */
function fitWithin(
  card: CameraPadding,
  own: unknown,
  size: { width: number; height: number } | undefined
): CameraPadding {
  if (!size || size.width <= 0 || size.height <= 0) return card;
  const fit =
    typeof own === "number"
      ? { top: own, right: own, bottom: own, left: own }
      : own && typeof own === "object"
        ? (own as Partial<CameraPadding>)
        : {};
  const axis = (a: number, b: number, fitA: number, fitB: number, length: number): number => {
    const room = Math.max(0, length * 0.8 - fitA - fitB);
    return a + b <= room ? 1 : a + b === 0 ? 1 : room / (a + b);
  };
  const v = axis(card.top, card.bottom, fit.top ?? 0, fit.bottom ?? 0, size.height);
  const h = axis(card.left, card.right, fit.left ?? 0, fit.right ?? 0, size.width);
  if (v === 1 && h === 1) return card;
  return {
    top: Math.floor(card.top * v),
    bottom: Math.floor(card.bottom * v),
    left: Math.floor(card.left * h),
    right: Math.floor(card.right * h),
  };
}

/**
 * Run one chapter action against the map.
 *
 * @remarks
 * Layer actions skip a layer the map does not have (the style may still be
 * loading it, or the id is a typo -- warned once per call). Camera actions
 * take their camera from `options` (`center`, `zoom`, `bearing`, `pitch`,
 * `duration`, ...); `fitBounds` takes `bounds: [west, south, east, north]`
 * and frames them top-down at the chapter's own pitch/bearing (default 0)
 * unless its options say otherwise. Under reduced motion every camera action
 * is instant unless its options set `essential: true`. `custom` runs nothing
 * itself: it dispatches {@link ACTION_EVENT}.
 */
export function runChapterAction(
  map: StoryMap | null,
  action: ChapterAction,
  ctx: ActionContext
): void {
  const options = (action.options ?? {}) as Record<string, unknown>;
  const instant = ctx.reducedMotion === true && options.essential !== true;

  if (action.action === "custom") {
    ctx.container.dispatchEvent(
      new CustomEvent(ACTION_EVENT, {
        bubbles: true,
        detail: { action, chapterId: ctx.chapterId, phase: ctx.phase, map },
      })
    );
    return;
  }
  if (!map) return;

  const needsLayer = (): boolean => {
    if (action.layer && map.getLayer(action.layer)) return true;
    console.warn(
      `[ml-scrollytelling] ${action.action} in chapter "${ctx.chapterId}": no layer "${action.layer ?? ""}" on the map`
    );
    const near = action.layer ? suggest(action.layer, ctx.layerIds ?? [], 3) : undefined;
    ctx.onProblem?.(
      `Chapter \`${ctx.chapterId}\`: its ${action.action} action names layer \`${action.layer ?? ""}\`, but the map has no layer by that name, so it did nothing.` +
        (near ? ` Did you mean \`${near}\`?` : "")
    );
    return false;
  };

  switch (action.action) {
    case "setFilter":
      if (needsLayer()) map.setFilter(action.layer!, action.filter ?? null);
      break;
    case "setPaintProperty":
      if (needsLayer() && action.property) {
        map.setPaintProperty(action.layer!, action.property, action.value);
      }
      break;
    case "setLayoutProperty":
      if (needsLayer() && action.property) {
        map.setLayoutProperty(action.layer!, action.property, action.value);
      }
      break;
    case "flyTo":
      if (instant) map.jumpTo({ ...options });
      else map.flyTo({ ...options });
      break;
    case "easeTo":
      if (instant) map.jumpTo({ ...options });
      else map.easeTo({ ...options });
      break;
    case "fitBounds": {
      const b = action.bounds;
      if (!b || b.length !== 4) {
        console.warn(
          `[ml-scrollytelling] fitBounds in chapter "${ctx.chapterId}" needs bounds: [west, south, east, north]`
        );
        break;
      }
      // fitBounds keeps the CURRENT pitch/bearing unless told otherwise, and
      // it interrupts the chapter's own camera move, so the chapter's
      // pitch 0 / bearing 0 never applied: a "top-down" framing stayed tilted
      // from the previous chapter (ml-aot.9).
      const [west, south, east, north] = b as [number, number, number, number];
      // The action interrupts the chapter's camera move mid-flight, padding
      // included: settle the padding first, so the bounds are framed in the
      // part of the map the chapter's card leaves visible.
      if (ctx.padding) map.jumpTo({ padding: fitWithin(ctx.padding, options.padding, ctx.mapSize) });
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          pitch: ctx.chapter?.pitch ?? 0,
          bearing: ctx.chapter?.bearing ?? 0,
          ...options,
          ...(instant ? { animate: false, duration: 0 } : {}),
        }
      );
      break;
    }
  }
}

/** Milliseconds per ambient step (one quarter turn / 20 degrees of longitude). */
const AMBIENT_STEP_MS = 8000;

/** Options for {@link createStoryController}. */
export interface StoryControllerOptions {
  /**
   * Camera padding for a chapter -- the part of the map its card covers, so
   * the chapter's `center` lands in the visible part (ml-aot.8). Called on
   * every activation, so it can follow the layout. Default: none.
   */
  padding?: (chapter: Chapter) => CameraPadding | undefined;
  /** The map's size, so a `fitBounds` action's padding fits in it. */
  mapSize?: () => { width: number; height: number } | undefined;
  /**
   * A problem the reader should see on the page: a chapter showing, hiding
   * or acting on a layer the map doesn't have (ml-aot.51). Reported once
   * per message.
   */
  onProblem?: (message: string) => void;
  /** Whether camera moves should be instant. Default: the OS setting. */
  reducedMotion?: () => boolean;
}

/** The handle {@link createStoryController} returns. */
export interface StoryController {
  /** Make a chapter active (no-op when it already is, or is unknown). */
  activate(chapterId: string): void;
  /**
   * Hand the controller its map once it has loaded. The active chapter (if
   * any) is applied to it at once, without animation. `null` marks the map
   * as failed: chapters keep activating and announcing, with `map: null`.
   */
  setMap(map: StoryMap | null): void;
  /** Stop ambient animation and ignore later calls. */
  destroy(): void;
  readonly activeChapterId: string | null;
}

/**
 * The scroll-driven half of a story: activates chapters, moves the camera,
 * toggles layers, runs actions. The element wires it to an
 * IntersectionObserver; tests drive it directly.
 *
 * @remarks
 * Works before the map exists: until {@link StoryController.setMap}, an
 * activation only updates the DOM (`is-active`, the rail, the element's
 * `data-active-chapter`). The map half -- camera, layers, enter actions and
 * the chapter event -- runs when the map arrives, so a reader who scrolls
 * while the map is still loading lands on the right chapter, not on the
 * document's initial camera.
 */
export function createStoryController(
  container: HTMLElement,
  story: ScrollytellingBlock,
  initialMap: StoryMap | null = null,
  options: StoryControllerOptions = {}
): StoryController {
  const chapters: Chapter[] = story.chapters ?? [];
  const reduced = options.reducedMotion ?? prefersReducedMotion;
  const layerIds = ((story.layers ?? []) as Array<{ id: string }>).map((l) => l.id);
  const reported = new Set<string>();
  const problem = (message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    options.onProblem?.(message);
  };
  let map: StoryMap | null = initialMap;
  /** The map is settled: loaded (`map` set) or failed (`map` null). */
  let mapSettled = initialMap !== null;
  let activeId: string | null = null;
  /** The chapter whose map half last ran (exit actions run for it). */
  let appliedId: string | null = null;
  let destroyed = false;

  const startAmbient = (chapter: Chapter, jumped: boolean) => {
    if (!map) return;
    if (!chapter.rotateAnimation && !chapter.spinGlobe) return;
    if (reduced()) return;
    const m = map;
    const step = () => {
      if (destroyed || activeId !== chapter.id) return; // a later chapter took over
      if (chapter.rotateAnimation) {
        m.rotateTo(m.getBearing() + 90, { duration: AMBIENT_STEP_MS, easing: (t: number) => t });
      } else {
        const c = m.getCenter();
        m.easeTo({ center: [c.lng - 20, c.lat], duration: AMBIENT_STEP_MS, easing: (t: number) => t });
      }
      m.once("moveend", step);
    };
    // After the chapter's own transition. jumpTo has already fired its
    // moveend synchronously, so there is nothing to wait for.
    if (jumped) step();
    else m.once("moveend", step);
  };

  /** The DOM half: classes, the rail, `data-active-chapter`. */
  function markActive(chapterId: string): void {
    container.dataset.activeChapter = chapterId;
    container.querySelectorAll<HTMLElement>(".scrolly-chapter").forEach((section) => {
      section.classList.toggle("is-active", section.dataset.chapterId === chapterId);
    });
    container.querySelectorAll<HTMLElement>(".chapter-marker").forEach((marker) => {
      const on = marker.dataset.chapterId === chapterId;
      marker.classList.toggle("active", on);
      if (on) marker.setAttribute("aria-current", "step");
      else marker.removeAttribute("aria-current");
    });
  }

  /** The map half: exit actions, camera, layers, enter actions, event. */
  function applyChapter(chapter: Chapter, index: number, instant: boolean): void {
    const previousId = appliedId;
    appliedId = chapter.id;
    const reduce = reduced();

    const previous = chapters.find((c) => c.id === previousId);
    for (const action of previous?.onChapterExit ?? []) {
      runChapterAction(map, action, {
        container,
        chapterId: previous!.id,
        phase: "exit",
        chapter: previous,
        reducedMotion: reduce,
        onProblem: problem,
        layerIds,
      });
    }

    let jumped = true;
    const padding = map ? options.padding?.(chapter) : undefined;
    if (map) {
      const camera: Record<string, unknown> = {
        center: chapter.center,
        zoom: chapter.zoom,
        pitch: chapter.pitch ?? 0,
        bearing: chapter.bearing ?? 0,
        ...(padding ? { padding } : {}),
      };
      // Reduced motion is explicit (ml-cxk): MapLibre's own flyTo/easeTo
      // honour the OS setting on recent majors, but the engine does not rely
      // on every supported major doing so.
      const animation = instant || reduce ? "jumpTo" : (chapter.animation ?? "flyTo");
      jumped = animation === "jumpTo";
      if (animation === "jumpTo") map.jumpTo(camera);
      else if (animation === "easeTo") map.easeTo(camera);
      else map.flyTo({ ...camera, speed: chapter.speed ?? 0.6, curve: chapter.curve ?? 1 });

      for (const [verb, visibility] of [
        ["show", "visible"],
        ["hide", "none"],
      ] as const) {
        for (const id of chapter.layers?.[verb] ?? []) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visibility);
            continue;
          }
          // Silently skipped before (ml-aot.51): the route never appeared and
          // nothing said why.
          const near = suggest(id, layerIds, 3);
          problem(
            `Chapter \`${chapter.id}\` ${verb === "show" ? "shows" : "hides"} layer \`${id}\`, but the map has no layer by that name.` +
              (near ? ` Did you mean \`${near}\`?` : "")
          );
        }
      }
    }

    for (const action of chapter.onChapterEnter ?? []) {
      runChapterAction(map, action, {
        container,
        chapterId: chapter.id,
        phase: "enter",
        chapter,
        reducedMotion: reduce || instant,
        padding,
        mapSize: options.mapSize?.(),
        onProblem: problem,
        layerIds,
      });
    }

    startAmbient(chapter, jumped);

    container.dispatchEvent(
      new CustomEvent(CHAPTER_EVENT, {
        bubbles: true,
        detail: {
          chapterId: chapter.id,
          previousChapterId: previousId,
          index,
          callback: chapter.callback ?? null,
          map,
        },
      })
    );
  }

  function activate(chapterId: string): void {
    if (destroyed || chapterId === activeId) return;
    const index = chapters.findIndex((c) => c.id === chapterId);
    const chapter = chapters[index];
    if (!chapter) return;
    activeId = chapterId;
    markActive(chapterId);
    if (mapSettled) applyChapter(chapter, index, false);
  }

  function setMap(next: StoryMap | null): void {
    if (destroyed) return;
    map = next;
    mapSettled = true;
    if (activeId === null) return;
    const index = chapters.findIndex((c) => c.id === activeId);
    const chapter = chapters[index];
    // The map just loaded at the document's initial camera: land on the
    // active chapter at once rather than flying there from somewhere else.
    if (chapter) applyChapter(chapter, index, true);
  }

  return {
    activate,
    setMap,
    destroy() {
      destroyed = true;
    },
    get activeChapterId() {
      return activeId;
    },
  };
}
