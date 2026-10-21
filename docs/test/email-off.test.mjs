/**
 * Cloudflare's Email Address Obfuscation must not touch the docs (ml-aot.35):
 * every built page's body is inside `<!--email_off-->` … `<!--/email_off-->`.
 *
 * The transform is checked directly; when a built site is present (docs/dist,
 * after `pnpm build`), its pages are checked too, including that the
 * `core@<minor>` CDN snippet sits inside the markers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wrapBodyEmailOff, EMAIL_OFF, EMAIL_ON } from "../scripts/email-off.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

test("wraps the body's contents, once", () => {
  const html = '<!doctype html><html><head><title>x</title></head><body class="a"><p>@maplibre-yaml/core@0.8</p></body></html>';
  const out = wrapBodyEmailOff(html);
  assert.equal(
    out,
    `<!doctype html><html><head><title>x</title></head><body class="a">${EMAIL_OFF}<p>@maplibre-yaml/core@0.8</p>${EMAIL_ON}</body></html>`
  );
  assert.equal(wrapBodyEmailOff(out), out);
});

test("leaves a fragment without a body alone", () => {
  assert.equal(wrapBodyEmailOff("<p>a@b.c</p>"), "<p>a@b.c</p>");
});

test("built pages carry the markers around the core CDN snippet", { skip: !existsSync(DIST) && "docs not built" }, () => {
  const page = readFileSync(join(DIST, "getting-started/quick-start/index.html"), "utf8");
  const start = page.indexOf(EMAIL_OFF);
  const end = page.lastIndexOf(EMAIL_ON);
  assert.ok(start > 0, "no <!--email_off--> marker");
  assert.ok(end > start, "no closing <!--/email_off--> marker");
  // The pin follows core's version (scripts/sync-cdn-pins.mjs), so match any minor.
  const at = page.search(/core@\d+\.\d+/);
  assert.ok(at > start && at < end, "the core@<version> snippet is outside the markers");
});
