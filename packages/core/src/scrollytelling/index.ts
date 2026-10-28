/**
 * @file The scrollytelling engine, without the element
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @description
 * The DOM-free half of `<ml-scrollytelling>`: the chapter controller, the
 * action runner, the story's map document, the markup renderers and the
 * stylesheet. Safe to import on a server (Astro frontmatter) -- nothing here
 * defines a custom element or touches `document` at import time.
 *
 * For the element itself import `@maplibre-yaml/core/register` (or
 * `registerMLScrollytelling` from `@maplibre-yaml/core/components`).
 */

export {
  CHAPTER_EVENT,
  ACTION_EVENT,
  STORY_GESTURE_DEFAULTS,
  storyMapDocument,
  runChapterAction,
  createStoryController,
  watchMapUpdates,
  prefersReducedMotion,
} from "./engine";
export type {
  StoryMap,
  CameraPadding,
  ActionContext,
  StoryController,
  StoryControllerOptions,
} from "./engine";
export {
  chapterHTML,
  chaptersHTML,
  footerHTML,
  railHTML,
  railButtonsHTML,
  errorCardHTML,
  safeMediaSrc,
  safeCssColor,
  escapeHtml,
} from "./render";
export type { ChapterHTMLOptions, StoryProblem, ErrorCardOptions } from "./render";
export { SCROLLYTELLING_CSS, injectScrollytellingStyles } from "./styles";
export { STORY_MAP_KEYS } from "./keys";
