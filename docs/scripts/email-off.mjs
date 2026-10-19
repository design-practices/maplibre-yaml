/**
 * Keep Cloudflare's Email Address Obfuscation off the docs' text (ml-aot.35).
 *
 * @remarks
 * docs.maplibre-yaml.org is proxied by Cloudflare with Scrape Shield's
 * "Email Address Obfuscation" on. It reads `@maplibre-yaml/core@0.8` as the
 * address `core@0.8` and serves `[email protected]` in its place, restored
 * only by a script: with JavaScript off, in reader views, to curl, and to the
 * AI assistants students paste docs links into, the CDN snippet reads
 * `https://unpkg.com/@maplibre-yaml/[email protected]/register.js`.
 *
 * The docs publish no email addresses, so every page's body is wrapped in
 * Cloudflare's documented opt-out markers, `<!--email_off-->` …
 * `<!--/email_off-->`, after the build (Astro's HTML compression would drop
 * comments written in a template). Turning the feature off for the zone in
 * the Cloudflare dashboard does the same; this keeps working either way.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMAIL_OFF = "<!--email_off-->";
export const EMAIL_ON = "<!--/email_off-->";

/** Wrap the contents of `<body>` in the opt-out markers (idempotent). */
export function wrapBodyEmailOff(html) {
  if (html.includes(EMAIL_OFF)) return html;
  const open = /<body\b[^>]*>/i.exec(html);
  const close = html.toLowerCase().lastIndexOf("</body>");
  if (!open || close < open.index) return html;
  const start = open.index + open[0].length;
  return html.slice(0, start) + EMAIL_OFF + html.slice(start, close) + EMAIL_ON + html.slice(close);
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

/** Astro integration: post-process every built HTML page. */
export const emailOff = {
  name: "maplibre-yaml-email-off",
  hooks: {
    "astro:build:done": async ({ dir, logger }) => {
      let count = 0;
      for await (const file of htmlFiles(fileURLToPath(dir))) {
        const html = await readFile(file, "utf8");
        const wrapped = wrapBodyEmailOff(html);
        if (wrapped !== html) {
          await writeFile(file, wrapped);
          count++;
        }
      }
      logger?.info?.(`email_off markers added to ${count} page(s)`);
    },
  },
};
