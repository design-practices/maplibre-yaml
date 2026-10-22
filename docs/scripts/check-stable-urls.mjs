#!/usr/bin/env node
/**
 * check-stable-urls.mjs — do the docs addresses other people rely on still work?
 *
 * Run against a built site served by `astro preview` (or any server for
 * docs/dist). For every address on the lists below it fetches the page,
 * follows redirect pages, and for an address with a `#fragment` checks that
 * the element with that id exists on the page it ends on.
 *
 *  - NEVER_MOVE: addresses pinned outside this repo's control — core's
 *    shipped error text, editor modelines in users' files, published npm
 *    READMEs. They must answer directly, with no redirect.
 *  - PAGE_REDIRECTS (docs/redirects.mjs): each old path must redirect to its
 *    new one, and public/_redirects must carry a 301 for it (Cloudflare Pages
 *    serves those; a meta-refresh page drops the #fragment, a 301 keeps it).
 *  - `--readme <file>` (repeatable): every docs.maplibre-yaml.org link in a
 *    README, e.g. one unpacked from `npm pack @maplibre-yaml/core@0.9.0`.
 *  - `--anchors <file>` (repeatable): more addresses to check, one per line.
 *
 * A redirect is followed the way Cloudflare answers it: the 301's own
 * fragment wins, otherwise the browser keeps the one the link had.
 *
 * Usage:
 *   pnpm --filter docs build && pnpm --filter docs preview --port 4770 &
 *   node docs/scripts/check-stable-urls.mjs --base http://localhost:4770 \
 *     [--readme path/README.md ...] [--anchors list.txt ...]
 *
 * Exit code 0 when every address resolves, 1 otherwise.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_REDIRECTS } from "../redirects.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://docs.maplibre-yaml.org";

/** Addresses that must answer directly (no redirect), anchors included. */
export const NEVER_MOVE = [
  "/guides/data-sources/#csv-and-spreadsheets", // core's error text
  "/schema/latest/map.schema.json", // editor modelines
  "/schema/latest/scrollytelling.schema.json",
  "/schema/latest/root.schema.json",
  "/schema/latest/any.schema.json",
  "/guides/export-classes/", // linked from 3 READMEs
  "/getting-started/installation/#using-a-bundler-vite",
  "/getting-started/quick-start/",
  "/integrations/astro/",
  "/integrations/web-components/",
  "/integrations/vanilla-js/",
  "/integrations/react/",
  "/integrations/scrollytelling-html/",
  "/schema/overview/",
  "/schema/scrollytelling/",
  "/cli/getting-started/",
  "/cli/reference/",
  "/guides/live-data/",
  "/guides/cloud-native-data/",
  "/guides/editor-setup/",
  "/guides/effects/",
  "/reference/api/maplibre-yaml/core/",
];

/**
 * Sections extracted from pages that stay keep a heading with the same text
 * (a short stub linking the new page), so these anchors still land.
 */
export const STUB_ANCHORS = [
  "/integrations/astro/#deploying-to-github-pages-or-any-subpath",
  "/integrations/astro/#geojson-feature-references",
  "/integrations/astro/#map-component-api",
  "/integrations/astro/#editing-in-astro-dev",
  "/integrations/astro/#troubleshooting",
  "/integrations/astro/#supported-versions",
  "/integrations/astro/#scrollytelling-component",
  "/integrations/astro/#chapter-component",
  "/integrations/astro/#adding-geographic-data-to-content-collections",
  "/integrations/web-components/#sites-under-a-subpath-github-pages",
  "/integrations/web-components/#component-api-reference",
  "/integrations/web-components/#when-something-goes-wrong",
  "/cli/reference/#integration-examples",
  // Make a map guides (docs batch 2): renamed headings keep their ids, and
  // sections that moved to another page leave a same-text stub.
  "/guides/data-sources/#cors-considerations",
  "/guides/data-sources/#remote-url",
  "/guides/data-sources/#inline-data",
  "/guides/data-sources/#named-sources",
  "/guides/data-sources/#clustering",
  "/guides/data-sources/#caching",
  "/guides/data-sources/#loading-states",
  "/guides/data-sources/#handling-errors-programmatically",
  "/guides/cloud-native-data/#the-rule-type-is-what-maplibre-draws-the-url-is-what-the-file-is",
  "/guides/cloud-native-data/#pmtiles",
  "/guides/cloud-native-data/#pmtiles-inside-a-basemap-style",
  "/guides/cloud-native-data/#host-your-own-basemap",
  "/guides/cloud-native-data/#flatgeobuf",
  "/guides/cloud-native-data/#geoparquet",
  "/guides/cloud-native-data/#cloud-optimized-geotiff-cog",
  "/guides/cloud-native-data/#hosting-range-requests-and-cors",
  "/guides/cloud-native-data/#when-something-goes-wrong",
  "/guides/cloud-native-data/#exporting-with-mlym-emit",
  "/guides/cloud-native-data/#format-v2",
  "/guides/live-data/#update-strategies",
  "/guides/live-data/#reacting-to-updates",
  "/guides/live-data/#complete-example",
  "/guides/layers/#strings-starting-with--are-reserved",
  "/guides/layers/#in-the-legend",
  "/guides/layers/#layer-order",
  "/guides/thematic-maps/#the-legend",
  "/guides/thematic-maps/#checks",
  "/guides/thematic-maps/#format-v2-and-stories",
  "/guides/popups/#format-numbers",
  "/guides/popups/#add-map-controls",
  "/guides/popups/#respond-to-hover",
  "/guides/accessibility-languages/#number-formats",
  "/guides/accessibility-languages/#show-the-map-in-another-language",
  "/guides/accessibility-languages/#while-the-map-loads",
  "/guides/accessibility-languages/#your-own-chrome-in-the-maps-language",
  "/guides/reuse/#safety",
  // Start here pages: headings other pages link, kept (or kept by an
  // explicit id) through the rewrite.
  "/getting-started/introduction/#how-it-works",
  "/getting-started/quick-start/#3-run-a-local-server",
  "/getting-started/first-map/#map-structure",
  "/getting-started/first-map/#the-config-section",
  "/getting-started/first-map/#coordinates",
  "/getting-started/first-map/#map-styles",
  "/getting-started/first-map/#adding-a-simple-layer",
  "/getting-started/first-map/#using-your-own-data-file",
  "/getting-started/installation/#browser-usage-cdn",
  "/getting-started/installation/#versions-in-cdn-urls",
  "/getting-started/installation/#supported-maplibre-gl-versions",
  "/getting-started/installation/#hosting-the-files-yourself",
  "/getting-started/upgrading/#how-to-upgrade",
  "/getting-started/upgrading/#what-behaves-differently",
  "/getting-started/upgrading/#older-releases",
  "/troubleshooting/#reading-what-the-map-tells-you",
  "/troubleshooting/#when-are-author-hints-shown",
  "/troubleshooting/#the-map-has-no-height",
  "/troubleshooting/#ml-map-isnt-defined",
  "/troubleshooting/#blank-map-and-worker-failed-to-load",
  "/troubleshooting/#an-error-card-instead-of-the-map",
  "/troubleshooting/#the-basemap-draws-but-your-layer-doesnt",
];

function parseArgs(argv) {
  const opts = { base: "http://localhost:4770", readmes: [], anchors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") opts.base = argv[++i].replace(/\/$/, "");
    else if (a === "--readme") opts.readmes.push(argv[++i]);
    else if (a === "--anchors") opts.anchors.push(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** Docs links in a README, as site paths (fragment included). */
function readmeLinks(file) {
  const text = readFileSync(file, "utf8");
  const out = new Set();
  for (const m of text.matchAll(/https:\/\/docs\.maplibre-yaml\.org([^\s)>"'`\]]*)/g)) {
    out.add(m[1] || "/");
  }
  return [...out];
}

const pageCache = new Map();
async function fetchPage(base, path) {
  if (pageCache.has(path)) return pageCache.get(path);
  const res = await fetch(base + path, { redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  const page = { status: res.status, location: res.headers.get("location"), body };
  pageCache.set(path, page);
  return page;
}

/** The meta-refresh target of a redirect page Astro wrote, or null. */
function metaRefresh(html) {
  const m = html.match(/<meta http-equiv="refresh" content="\d+;url=([^"]+)"/i);
  return m ? m[1] : null;
}

function hasId(html, id) {
  const decoded = decodeURIComponent(id);
  const esc = decoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\sid=["']${esc}["']`).test(html);
}

/**
 * Follow an address to the page it ends on. Returns { finalPath, fragment,
 * hops, page } or { error }.
 */
async function resolve(base, address) {
  let [path, fragment = ""] = address.split("#");
  const hops = [];
  for (let i = 0; i < 5; i++) {
    const page = await fetchPage(base, path);
    let next = null;
    if (page.status >= 300 && page.status < 400 && page.location) next = page.location;
    else if (page.status === 200 && metaRefresh(page.body)) next = metaRefresh(page.body);
    else if (page.status !== 200) return { error: `HTTP ${page.status} for ${path}`, hops };
    if (!next) return { finalPath: path, fragment, hops, page };
    const [np, nf] = next.replace(base, "").replace(SITE, "").split("#");
    hops.push(`${path} → ${next}`);
    path = np;
    if (nf !== undefined) fragment = nf; // the redirect's own fragment wins
  }
  return { error: `too many redirects from ${address}`, hops };
}

async function check(base, address, { direct }) {
  const r = await resolve(base, address);
  if (r.error) return { ok: false, address, why: r.error };
  if (direct && r.hops.length) return { ok: false, address, why: `redirects (${r.hops.join(", ")}); this address must not move` };
  if (r.fragment && !hasId(r.page.body, r.fragment)) {
    return { ok: false, address, why: `no id="${r.fragment}" on ${r.finalPath}` };
  }
  const where = r.hops.length ? ` (→ ${r.finalPath}${r.fragment ? "#" + r.fragment : ""})` : "";
  return { ok: true, address, why: `ok${where}` };
}

/** public/_redirects as built: { from: { to, status } }. */
function builtRedirects() {
  const file = [join(DOCS, "dist", "_redirects"), join(DOCS, "public", "_redirects")].find(existsSync);
  const out = {};
  if (!file) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [from, to, status] = line.trim().split(/\s+/);
    out[from] = { to, status };
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [];
  const section = (title) => results.push({ title });

  section("Never move (must answer directly)");
  for (const a of NEVER_MOVE) results.push(await check(opts.base, a, { direct: true }));

  section("Anchors kept by same-text stubs");
  for (const a of STUB_ANCHORS) results.push(await check(opts.base, a, { direct: true }));

  section("Moved pages (Astro redirect page + Cloudflare 301)");
  const cf = builtRedirects();
  for (const [from, to] of Object.entries(PAGE_REDIRECTS)) {
    const r = await check(opts.base, from, { direct: false });
    const target = await check(opts.base, to, { direct: true });
    const forms = [from, from.replace(/\/$/, "")];
    const missing = forms.filter((f) => !(cf[f] && cf[f].to === to && cf[f].status === "301"));
    if (!target.ok) results.push({ ok: false, address: from, why: `target ${to}: ${target.why}` });
    else if (missing.length) results.push({ ok: false, address: from, why: `_redirects lacks a 301 for ${missing.join(", ")}` });
    else results.push(r);
  }

  for (const file of opts.readmes) {
    section(`README links: ${file}`);
    for (const a of readmeLinks(file)) results.push(await check(opts.base, a, { direct: false }));
  }
  for (const file of opts.anchors) {
    section(`Addresses from ${file}`);
    const list = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const a of list) results.push(await check(opts.base, a, { direct: false }));
  }

  let failed = 0;
  let total = 0;
  for (const r of results) {
    if (r.title) {
      console.log(`\n## ${r.title}`);
      continue;
    }
    total++;
    if (!r.ok) failed++;
    console.log(`${r.ok ? "✓" : "✗"} ${r.address}  ${r.why}`);
  }
  console.log(`\n${total - failed}/${total} addresses resolve${failed ? `; ${failed} FAILED` : ""}.`);
  process.exit(failed ? 1 : 0);
}

await main();
