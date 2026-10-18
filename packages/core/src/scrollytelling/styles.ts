/**
 * @file The stylesheet for `<ml-scrollytelling>` and its chapters
 * @module @maplibre-yaml/core/scrollytelling
 *
 * @description
 * One stylesheet for every story, whichever way it is rendered: the element
 * injects it into the page (plain HTML needs no `<link>`), and the build
 * also writes it to `dist/scrollytelling.css` (`@maplibre-yaml/core/
 * scrollytelling.css`), which Astro's components import so a
 * server-rendered story is styled before any script runs.
 *
 * ## Layering
 *
 * The map is `position: sticky` at the top of the element, one map-height
 * tall (`--ml-scrolly-map-height`, default `100vh`; `--ml-scrolly-map-top`
 * sticks it below a fixed header); the chapter column is pulled up over it. The column lets pointer events through -- only the
 * chapter cards, the footer and the error card take them -- so the marker
 * rail, the legend, slots, markers and popups on the map stay clickable
 * (ml-07q). The wheel and touch still scroll the page over the map because
 * the story map's own gesture handlers are off (see
 * `STORY_GESTURE_DEFAULTS`).
 *
 * Narrow screens (<= 768px) put the cards in the lower part of each chapter;
 * the element offsets the camera by the same amount, so a chapter's
 * `center` is not hidden under its card (ml-aot.8).
 */

export const SCROLLYTELLING_CSS = `
ml-scrollytelling {
  --ml-scrolly-map-height: 100vh;
  display: block;
  position: relative;
  width: 100%;
}

ml-scrollytelling > script[type="text/yaml"],
ml-scrollytelling > script[type="application/yaml"],
ml-scrollytelling > [slot] {
  display: none;
}

/* Sticky map */
ml-scrollytelling > .scrolly-map-container {
  position: sticky;
  top: var(--ml-scrolly-map-top, 0px);
  width: 100%;
  height: var(--ml-scrolly-map-height, 100vh);
  z-index: 0;
}

ml-scrollytelling > .scrolly-map-container > ml-map {
  display: block;
  width: 100%;
  height: 100%;
}

/* Chapter column, pulled up over the map. Transparent to the pointer except
   for what a reader clicks: cards, footer, loading and error states. */
ml-scrollytelling > .scrolly-chapters {
  position: relative;
  z-index: 1;
  margin-top: calc(-1 * var(--ml-scrolly-map-height, 100vh));
  pointer-events: none;
}

ml-scrollytelling > .scrolly-chapters .chapter-content,
ml-scrollytelling > .scrolly-chapters > .scrolly-footer,
ml-scrollytelling > .scrolly-chapters > .chapters-loading,
ml-scrollytelling > .scrolly-chapters > .scrolly-error {
  pointer-events: auto;
}

/* Loading state (a src story before it arrives) */
ml-scrollytelling .chapters-loading {
  min-height: var(--ml-scrolly-map-height, 100vh);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #64748b;
}

ml-scrollytelling .loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: ml-scrolly-spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes ml-scrolly-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Chapter marker rail */
ml-scrollytelling .chapter-markers {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 10;
}

ml-scrollytelling .chapter-marker {
  /* A 24px hit target around a 12px dot. */
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

ml-scrollytelling .chapter-marker::before {
  content: "";
  display: block;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--ml-marker-color, #3fb1ce);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

ml-scrollytelling .chapter-marker:hover::before {
  transform: scale(1.3);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
}

ml-scrollytelling .chapter-marker.active::before {
  transform: scale(1.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}

ml-scrollytelling .chapter-marker:focus-visible {
  outline: 2px solid var(--ml-marker-color, #3fb1ce);
  outline-offset: 1px;
}

/* Footer */
ml-scrollytelling .scrolly-footer {
  position: relative;
  min-height: 50vh;
  padding: 40px 20px;
  background: var(--footer-bg, #f8fafc);
  color: var(--footer-text, #1f2937);
  text-align: center;
}

ml-scrollytelling.theme-dark .scrolly-footer {
  --footer-bg: #1f2937;
  --footer-text: #f9fafb;
}

/* The one error card a story shows when it cannot render */
ml-scrollytelling .scrolly-error {
  box-sizing: border-box;
  max-width: 760px;
  margin: 24px auto;
  padding: 24px 28px;
  border: 1px solid #fecaca;
  border-radius: 10px;
  background: #fef2f2;
  color: #991b1b;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  text-align: left;
}

ml-scrollytelling .scrolly-error h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  color: #b91c1c;
}

ml-scrollytelling .scrolly-error ul {
  margin: 8px 0;
  padding-left: 1.25rem;
}

ml-scrollytelling .scrolly-error code {
  font-weight: 600;
}

ml-scrollytelling .scrolly-error-source,
ml-scrollytelling .scrolly-error-line {
  color: #7f1d1d;
  opacity: 0.85;
}

ml-scrollytelling .scrolly-error-source {
  margin: 0 0 8px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  word-break: break-all;
}

ml-scrollytelling .scrolly-error-hints-title {
  margin: 12px 0 0;
  font-weight: 600;
}

ml-scrollytelling .scrolly-error-hint {
  margin: 12px 0 0;
  padding: 12px 16px;
  border-radius: 6px;
  background: #fff7ed;
  color: #7c2d12;
}

ml-scrollytelling .scrolly-error-help {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 6px;
  background: #fef3c7;
  color: #92400e;
}

ml-scrollytelling .scrolly-error-help pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  font-size: 12px;
}

/* Debug mode */
ml-scrollytelling.debug .scrolly-chapter,
ml-scrollytelling[debug] .scrolly-chapter {
  outline: 2px dashed rgba(255, 0, 0, 0.5);
  outline-offset: -2px;
}

ml-scrollytelling.debug .scrolly-chapter.is-active,
ml-scrollytelling[debug] .scrolly-chapter.is-active {
  outline-color: rgba(0, 255, 0, 0.8);
}

/* Chapters. Anchored on .scrolly-chapter (not the element) so a chapter
   rendered on its own -- Astro's <Chapter> -- is styled too. */
.scrolly-chapter {
  box-sizing: border-box;
  min-height: 100vh;
  display: flex;
  align-items: center;
  padding: 20vh 5vw;
  position: relative;
}

.scrolly-chapter.is-hidden {
  min-height: 50vh;
  padding: 10vh 0;
}

.scrolly-chapter.align-left {
  justify-content: flex-start;
}

.scrolly-chapter.align-right {
  justify-content: flex-end;
}

.scrolly-chapter.align-center,
.scrolly-chapter.align-full {
  justify-content: center;
}

.scrolly-chapter.align-full .chapter-content {
  max-width: none;
  width: 100%;
  text-align: center;
}

.scrolly-chapter .chapter-content {
  box-sizing: border-box;
  background: var(--chapter-bg, rgba(255, 255, 255, 0.95));
  color: var(--chapter-text, #1f2937);
  padding: 32px;
  border-radius: 12px;
  max-width: 450px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  position: relative;
  z-index: 10;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.scrolly-chapter.theme-dark .chapter-content {
  --chapter-bg: rgba(31, 41, 55, 0.95);
  --chapter-text: #f9fafb;
}

.scrolly-chapter.theme-light .chapter-content {
  --chapter-bg: rgba(255, 255, 255, 0.95);
  --chapter-text: #1f2937;
}

.scrolly-chapter:not(.is-active) .chapter-content {
  opacity: 0.4;
  transform: scale(0.98);
}

.scrolly-chapter.is-active .chapter-content {
  opacity: 1;
  transform: scale(1);
}

.scrolly-chapter .chapter-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0 0 16px 0;
  line-height: 1.2;
  color: inherit;
}

.scrolly-chapter .chapter-description {
  font-size: 1rem;
  line-height: 1.6;
  color: inherit;
}

.scrolly-chapter .chapter-description p {
  margin: 0 0 12px 0;
}

.scrolly-chapter .chapter-description p:last-child {
  margin-bottom: 0;
}

.scrolly-chapter .chapter-description a {
  color: var(--chapter-link, #2563eb);
  text-decoration: underline;
}

.scrolly-chapter .chapter-description a:hover {
  color: var(--chapter-link-hover, #1d4ed8);
}

.scrolly-chapter.theme-dark .chapter-description a {
  --chapter-link: #93c5fd;
  --chapter-link-hover: #bfdbfe;
}

.scrolly-chapter .chapter-media {
  margin-bottom: 20px;
  border-radius: 8px;
  overflow: hidden;
}

.scrolly-chapter .chapter-media img,
.scrolly-chapter .chapter-media video {
  width: 100%;
  height: auto;
  display: block;
}

.scrolly-chapter .chapter-media video {
  background: #000;
}

/* Map chrome (legend, slots, params panel) stays out from under the cards:
   the element sets --ml-scrolly-chrome-bottom / -top on a corner a card
   would cover (ml-aot.39, ml-aot.50), and the corner never comes closer to
   the edge than ChromeLayout's own inset (--ml-chrome-inset), which clears
   MapLibre's scale bar and attribution. !important: ChromeLayout's offset is
   an inline style. No transition: the chrome moves with the scroll. */
ml-scrollytelling > .scrolly-map-container .ml-map-chrome-bottom-left,
ml-scrollytelling > .scrolly-map-container .ml-map-chrome-bottom-right {
  bottom: max(var(--ml-chrome-inset, 10px), var(--ml-scrolly-chrome-bottom, 0px)) !important;
}

ml-scrollytelling > .scrolly-map-container .ml-map-chrome-top-left,
ml-scrollytelling > .scrolly-map-container .ml-map-chrome-top-right {
  top: max(var(--ml-chrome-inset, 10px), var(--ml-scrolly-chrome-top, 0px)) !important;
}

ml-scrollytelling > .scrolly-map-container .ml-map-chrome-top-left,
ml-scrollytelling > .scrolly-map-container .ml-map-chrome-bottom-left {
  left: max(10px, var(--ml-scrolly-chrome-x, 0px)) !important;
}

ml-scrollytelling > .scrolly-map-container .ml-map-chrome-top-right,
ml-scrollytelling > .scrolly-map-container .ml-map-chrome-bottom-right {
  right: max(10px, var(--ml-scrolly-chrome-x, 0px)) !important;
}

/* A chapter photo or video never fills the map (ml-aot.50): a full-width
   card scaled its photo to the whole width, taller than the screen. */
.scrolly-chapter .chapter-media img {
  width: auto;
  max-width: 100%;
  max-height: 40vh;
  margin: 0 auto;
}

.scrolly-chapter .chapter-media video {
  max-height: 40vh;
}

/* A chapter image or video that didn't load says so (ml-aot.51). */
.scrolly-chapter .chapter-media-missing {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed currentColor;
  border-radius: 6px;
  font-size: 0.875rem;
  line-height: 1.4;
  opacity: 0.85;
}

/* Phones. (A phone on its side has its own block below.) */
@media (max-width: 768px) {
  /* Cards sit low in their chapter; the camera is offset to match, so the
     chapter's subject shows above the card instead of under it. */
  .scrolly-chapter {
    align-items: flex-end;
    padding: 15vh 4vw 10vh;
  }

  .scrolly-chapter.is-hidden {
    min-height: 40vh;
    padding: 8vh 0;
  }

  .scrolly-chapter .chapter-content {
    padding: 24px;
    max-width: 100%;
  }

  .scrolly-chapter .chapter-title {
    font-size: 1.5rem;
  }

  .scrolly-chapter .chapter-description {
    font-size: 1rem;
  }

  /* A gutter for the rail, so it never sits on a card. */
  ml-scrollytelling.has-markers .scrolly-chapter {
    padding-right: 44px;
  }

  ml-scrollytelling .chapter-markers {
    right: 8px;
  }
}

/* A phone on its side (ml-aot.50; touch screens only -- a short desktop
   window keeps the author's alignment): wider than 768px but only ~400px tall,
   where desktop cards were taller than the screen and a centred one sat on
   the chapter's subject. Cards stay beside the map's centre -- a narrow,
   short card on one side (centred and full-width ones go left) -- so the
   camera keeps the subject on the other side, and the photo is shorter. */
@media (max-height: 500px) and (max-width: 1000px) and (min-width: 769px) and (pointer: coarse) {
  .scrolly-chapter {
    padding: 8vh 3vw;
  }

  .scrolly-chapter.align-center,
  .scrolly-chapter.align-full {
    justify-content: flex-start;
  }

  .scrolly-chapter .chapter-content,
  .scrolly-chapter.align-full .chapter-content {
    max-width: min(46%, 420px);
    padding: 14px 18px;
    text-align: left;
  }

  ml-scrollytelling.has-markers .scrolly-chapter {
    padding-right: 44px;
  }

  .scrolly-chapter .chapter-media img,
  .scrolly-chapter .chapter-media video {
    max-height: 30vh;
  }

  .scrolly-chapter .chapter-media {
    margin-bottom: 10px;
  }

  .scrolly-chapter .chapter-title {
    font-size: 1.25rem;
    margin-bottom: 8px;
  }
}

@media (max-width: 480px) {
  .scrolly-chapter {
    padding: 12vh 3vw 8vh;
  }

  .scrolly-chapter .chapter-content {
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }

  .scrolly-chapter .chapter-title {
    font-size: 1.375rem;
    margin-bottom: 12px;
  }

  .scrolly-chapter .chapter-description {
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .scrolly-chapter .chapter-media {
    margin-bottom: 16px;
  }

  ml-scrollytelling.has-markers .scrolly-chapter {
    padding-right: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scrolly-chapter .chapter-content {
    transition: opacity 0.5s ease;
    transform: none !important;
  }

  ml-scrollytelling .chapter-marker::before {
    transition: none;
  }

  ml-scrollytelling .loading-spinner {
    animation-duration: 3s;
  }
}

@media (prefers-contrast: more) {
  .scrolly-chapter .chapter-content {
    border: 2px solid currentColor;
  }

  .scrolly-chapter.theme-dark .chapter-content {
    --chapter-bg: rgba(0, 0, 0, 0.95);
  }

  .scrolly-chapter.theme-light .chapter-content {
    --chapter-bg: rgba(255, 255, 255, 1);
  }
}
`;

const STYLE_ID = "ml-scrollytelling-styles";

/**
 * Add {@link SCROLLYTELLING_CSS} to a document once.
 *
 * @remarks
 * Prepended to `<head>`, so the page's own stylesheets come later in the
 * cascade and override it at equal specificity.
 */
export function injectScrollytellingStyles(doc: Document = document): void {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SCROLLYTELLING_CSS;
  doc.head.prepend(style);
}
