/**
 * @file Story markup as HTML strings, for the browser and for server renderers
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @description
 * One renderer for the chapter column, the marker rail and the error card:
 * `<ml-scrollytelling>` uses it in the browser and Astro's `<Scrollytelling>`
 * uses it at build time, so a server-rendered story and a client-rendered
 * one are the same markup. Pure string functions -- no DOM.
 */

import type { Chapter, ScrollytellingBlock } from "../schemas/scrollytelling.schema";
import { escapeHtml } from "../utils/html";
import { displayPath } from "../parser/validation-utils";
import { resolveDocumentUrl } from "../utils/document-base";
import { createStrings, defaultStrings, type Strings } from "../i18n/strings";

export { escapeHtml };

/**
 * A chapter's `image`/`video` source: relative and http(s) only.
 *
 * @remarks
 * Core's schema enforces the same rule (ml-aot.6), but a story handed over
 * as an object may never have been validated, so the sink still checks.
 */
export function safeMediaSrc(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
  if (/^(\/|\.\.?\/|#|\?)/.test(cleaned)) return cleaned;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return /^[^/?#]*:/.test(cleaned) ? null : cleaned;
}

/**
 * A color for an inline `style` attribute: anything that cannot leave the
 * declaration (no `;`, braces, quotes, angle brackets or backslashes), else
 * the default rail color.
 */
export function safeCssColor(value: unknown, fallback = "#3FB1CE"): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text && /^[^;{}<>"'\\]+$/.test(text) ? text : fallback;
}

/** Options for {@link chapterHTML}. */
export interface ChapterHTMLOptions {
  theme?: string;
  isActive?: boolean;
  /**
   * The site's base path (`<ml-scrollytelling base>`): `image` / `video`
   * paths resolve against it, as every path in the story's map document
   * does, so `/images/x.jpg` works on a site under a subpath (GitHub Pages).
   */
  base?: string | null;
  /** The story's UI strings (its `config.locale`); English by default. */
  strings?: Strings;
}

/** The story's UI strings: its `config.locale`, the table MapLibre reads. */
export function storyStrings(story: { config?: unknown }): Strings {
  return createStrings((story as { config?: { locale?: unknown } }).config?.locale);
}

/**
 * One chapter `<section>`.
 *
 * @remarks
 * `description` is inserted as HTML, NOT escaped: the schema documents it as
 * the chapter's HTML (the same contract `set:html` honours in Astro). Trust
 * model tracked as ml-2l7.2. Everything else is escaped.
 */
export function chapterHTML(chapter: Chapter, opts: ChapterHTMLOptions = {}): string {
  const theme = opts.theme ?? "light";
  const classes = [
    "scrolly-chapter",
    `align-${chapter.alignment ?? "center"}`,
    `theme-${theme}`,
    opts.isActive ? "is-active" : "",
    chapter.hidden ? "is-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const id = escapeHtml(chapter.id);

  if (chapter.hidden) {
    // A map-only step: nothing to read, nothing to label.
    return `<section class="${escapeHtml(classes)}" data-chapter-id="${id}" aria-hidden="true"></section>`;
  }

  let content = "";
  const image = chapter.image ? safeMediaSrc(resolveDocumentUrl(chapter.image, opts.base)) : null;
  if (image !== null) {
    content += `<div class="chapter-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(
      chapter.title
    )}" loading="lazy" decoding="async"></div>`;
  }
  const video = chapter.video ? safeMediaSrc(resolveDocumentUrl(chapter.video, opts.base)) : null;
  if (video !== null) {
    content += `<div class="chapter-media"><video src="${escapeHtml(
      video
    )}" controls playsinline preload="metadata">${escapeHtml(
      (opts.strings ?? defaultStrings)("maplibre-yaml.Story.VideoUnsupported")
    )}</video></div>`;
  }
  content += `<h2 class="chapter-title" id="chapter-title-${id}">${escapeHtml(chapter.title)}</h2>`;
  if (chapter.description) {
    content += `<div class="chapter-description">${chapter.description}</div>`;
  }

  return (
    `<section class="${escapeHtml(classes)}" data-chapter-id="${id}" role="region" ` +
    `aria-labelledby="chapter-title-${id}"><div class="chapter-content">${content}</div></section>`
  );
}

/** Every chapter section, the first one active; media resolved against `base`. */
export function chaptersHTML(story: ScrollytellingBlock, opts: { base?: string | null } = {}): string {
  const theme = story.theme ?? "light";
  const strings = storyStrings(story);
  return (story.chapters ?? [])
    .map((chapter: Chapter, index: number) =>
      chapterHTML(chapter, { theme, isActive: index === 0, base: opts.base, strings })
    )
    .join("");
}

/**
 * The footer, or `""`. NOT escaped: the schema documents `footer` as HTML
 * (ml-2l7.2).
 */
export function footerHTML(story: ScrollytellingBlock): string {
  return story.footer ? `<footer class="scrolly-footer">${story.footer}</footer>` : "";
}

/**
 * The chapter rail's buttons (`showMarkers: true`), the first one current.
 * Wrapped by the caller in `<nav class="chapter-markers">`.
 */
export function railButtonsHTML(story: ScrollytellingBlock): string {
  // No `markerColor`: the stylesheet's neutral two-tone dots (white with a
  // dark outline; the current one larger and dark), which stand out on any
  // basemap. A color, when set, fills the dots; the outline stays.
  const style = story.markerColor
    ? ` style="--ml-marker-color: ${escapeHtml(safeCssColor(story.markerColor))}"`
    : "";
  const t = storyStrings(story);
  return (story.chapters ?? [])
    .map(
      (chapter: Chapter, index: number) =>
        `<button type="button" class="chapter-marker${index === 0 ? " active" : ""}" ` +
        `data-chapter-id="${escapeHtml(chapter.id)}" ` +
        `aria-label="${escapeHtml(
          t("maplibre-yaml.Story.GoToChapter", { number: index + 1, title: chapter.title })
        )}"` +
        `${index === 0 ? ' aria-current="step"' : ""}${style}></button>`
    )
    .join("");
}

/** The rail, or `""` without `showMarkers`. */
export function railHTML(story: ScrollytellingBlock): string {
  if (!story.showMarkers) return "";
  return `<nav class="chapter-markers" aria-label="${escapeHtml(
    storyStrings(story)("maplibre-yaml.Story.Chapters")
  )}">${railButtonsHTML(story)}</nav>`;
}

/** One problem in a story, as the error card lists it. */
export interface StoryProblem {
  path?: string;
  message: string;
  line?: number;
  column?: number;
}

/** Options for {@link errorCardHTML}. */
export interface ErrorCardOptions {
  /** Heading. Default: "Story configuration error". */
  title?: string;
  /** Where the story came from (its `src` URL), shown under the heading. */
  source?: string;
  /** Unknown-key suggestions and other hints, listed after the errors. */
  warnings?: StoryProblem[];
  /** Show how to give the element a story (for "no story provided"). */
  showHelp?: boolean;
  /**
   * What to do next, one short paragraph -- the same field `<ml-map>`'s card
   * (`createErrorCard`) takes, so the two share failure messages.
   */
  hint?: string;
}

function problemLine(problem: StoryProblem): string {
  const where =
    problem.line !== undefined
      ? ` <span class="scrolly-error-line">(line ${problem.line}${
          problem.column !== undefined ? `, column ${problem.column}` : ""
        })</span>`
      : "";
  // Not "chapters.3.center" next to a message that already says "Chapter 4".
  const shown = displayPath(problem);
  const path = shown ? `<code>${escapeHtml(shown)}</code>: ` : "";
  return `<li>${path}${escapeHtml(problem.message)}${where}</li>`;
}

/**
 * The one error card a story shows when it cannot render (ml-aot.7): the
 * errors with their line numbers, then any did-you-mean hints -- the same
 * information `mlym validate` prints for the file.
 */
export function errorCardHTML(errors: StoryProblem[], opts: ErrorCardOptions = {}): string {
  const title = opts.title ?? "Story configuration error";
  const source = opts.source
    ? `<p class="scrolly-error-source">${escapeHtml(opts.source)}</p>`
    : "";
  const hints =
    opts.warnings && opts.warnings.length > 0
      ? `<p class="scrolly-error-hints-title">Also check:</p><ul class="scrolly-error-hints">${opts.warnings
          .map(problemLine)
          .join("")}</ul>`
      : "";
  const fix = opts.hint
    ? `<p class="scrolly-error-hint"><strong>How to fix it:</strong> ${escapeHtml(opts.hint)}</p>`
    : "";
  const help = opts.showHelp
    ? `<div class="scrolly-error-help"><strong>Give the story a document in one of these ways:</strong>` +
      `<pre>&lt;ml-scrollytelling src="story.yaml"&gt;&lt;/ml-scrollytelling&gt;</pre>` +
      `<pre>&lt;ml-scrollytelling&gt;\n  &lt;script type="text/yaml"&gt;\ntype: scrollytelling\n...\n  &lt;/script&gt;\n&lt;/ml-scrollytelling&gt;</pre>` +
      `<pre>document.querySelector("ml-scrollytelling").story = { type: "scrollytelling", ... }</pre></div>`
    : "";
  return (
    `<div class="scrolly-error" role="alert"><h2>${escapeHtml(title)}</h2>${source}` +
    `<ul class="scrolly-error-list">${errors.map(problemLine).join("")}</ul>${hints}${fix}${help}</div>`
  );
}
