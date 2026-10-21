/**
 * Pages that moved, old path → new path. The one list both redirect layers
 * read, so they cannot disagree:
 *
 *  - astro.config.mjs `redirects`: Astro writes a small meta-refresh page at
 *    each old path. It works on any host (and under `astro preview`), but a
 *    meta refresh drops the `#fragment` of the address it was opened with.
 *  - public/_redirects (written by scripts/generate-agent-assets.mjs): the
 *    site is served by Cloudflare Pages, which answers these paths with an
 *    HTTP 301 before it looks for the meta-refresh page. A browser keeps the
 *    `#fragment` across an HTTP redirect, so deep links into a renamed page
 *    (published READMEs pin many) still land on their section.
 *
 * A destination with its own `#fragment` replaces the incoming one, so use it
 * only when the old page became one section of the new page.
 *
 * Some addresses must never move at all, redirect or not: core's error text
 * links /guides/data-sources/#csv-and-spreadsheets, editor modelines in
 * users' files point at /schema/latest/*.json, and published READMEs link the
 * integration, CLI and guide pages. docs/scripts/check-stable-urls.mjs
 * checks the built site against that list.
 */
export const PAGE_REDIRECTS = {
  // 0.7 renamed "eject" to "export" (to style.json).
  "/guides/eject-classes/": "/guides/export-classes/",
  // 0.9 docs reorganization.
  "/guides/collections-integration/": "/integrations/astro-collections/",
  "/guides/interactions/": "/guides/export/",
  "/cli/vscode/": "/guides/editor-setup/#validate-on-save-vs-code-task",
};

/**
 * The `_redirects` lines for PAGE_REDIRECTS: a 301 for each old path, with
 * and without its trailing slash (Cloudflare matches them separately).
 */
export function cloudflarePageRedirectLines() {
  const lines = [];
  for (const [from, to] of Object.entries(PAGE_REDIRECTS)) {
    lines.push(`${from} ${to} 301`);
    if (from.endsWith("/") && from.length > 1) lines.push(`${from.slice(0, -1)} ${to} 301`);
  }
  return lines;
}
