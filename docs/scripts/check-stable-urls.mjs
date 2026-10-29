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
 *  - REDIRECTED_ANCHORS: linked sections of pages that moved; each must land
 *    on an element with that id once the redirect is followed.
 *  - PAGE_REDIRECTS (docs/redirects.mjs): each old path must redirect to its
 *    new one, and public/_redirects must carry a 301 for it (Cloudflare Pages
 *    serves those; a meta-refresh page drops the #fragment, a 301 keeps it).
 *  - llms.txt and llms-full.txt as served: every docs.maplibre-yaml.org link
 *    an agent reads there must answer directly (no redirect), so the agent
 *    index never points at an old address.
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
import { siteLinks } from "./generate-agent-assets.mjs";

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
  // Core's shipped large-data hint text (LARGE_DATA_DOCS in
  // components/student-messages.ts) and `mlym prepare`'s output link these.
  "/guides/geoparquet/#large-files",
  "/guides/flatgeobuf/#large-files",
  "/guides/pmtiles/#from-a-large-file",
  "/guides/large-data/",
  "/guides/large-data/#which-format",
  "/guides/large-data/#mlym-prepare",
  "/guides/large-data/#parcel-fabrics-pmtiles",
  "/guides/large-data/#overview-geoparquet",
  "/guides/large-data/#class-breaks",
  "/guides/large-data/#mlt-tiles",
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
  // Reference topic pages (docs batch 6): anchors kept on the hubs, and the
  // linked sections of the pages that now redirect, which must still land.
  "/schema/overview/#three-kinds-of-document",
  "/schema/map-config/#complete-examples",
  "/schema/map-config/#what-goes-inside-config",
  "/schema/map-config/#mapstyle-forms",
  "/schema/map-config/#fit-to-bounds",
  "/schema/map-config/#fit-to-a-sources-data",
  "/schema/map-config/#interaction-settings",
  "/schema/map-config/#terrain-sky--projection",
  "/schema/map-config/#light",
  "/schema/map-config/#popups",
  "/schema/map-config/#legend",
  "/schema/map-config/#map-controls",
  "/schema/map-config/#typescript-types",
];

/**
 * Sections of pages that moved (PAGE_REDIRECTS) that other pages still link
 * to. The redirect keeps the #fragment (a Cloudflare 301 does), so the page
 * it lands on must carry the id.
 */
export const REDIRECTED_ANCHORS = [
  "/schema/sources/#geojson-sugar",
  "/schema/sources/#files-on-your-own-site-relative-paths",
  "/schema/sources/#named-source-definitions",
  "/schema/layers/#popups",
  "/schema/layers/#classify",
  "/schema/layers/#number-formats",
  "/schema/interactivity/#emit",
  "/schema/interactivity/#custom-highlight-styling",
  // Tools & advanced pages (docs batch 5): headings other pages, the
  // troubleshooting table and the /cli/vscode/ redirect link, kept through
  // the rewrite (by text, an explicit id, or a stub under "Moved sections").
  "/cli/getting-started/#start-a-project",
  "/cli/getting-started/#validate-configuration",
  "/cli/getting-started/#preview-your-map",
  "/cli/getting-started/#installation",
  "/cli/getting-started/#short-alias",
  "/cli/getting-started/#output-formats",
  "/cli/getting-started/#exit-codes",
  "/cli/reference/#running-the-cli",
  "/cli/reference/#init",
  "/cli/reference/#validate",
  "/cli/reference/#output-formats",
  "/cli/reference/#preview",
  "/cli/reference/#emit",
  "/cli/reference/#schema",
  "/cli/reference/#bake",
  "/cli/reference/#configuration-file",
  "/cli/reference/#exit-codes",
  "/cli/reference/#aliases",
  "/cli/reference/#troubleshooting",
  "/cli/reference/#command-not-found",
  "/guides/editor-setup/#option-1-the-modeline-recommended",
  "/guides/editor-setup/#stable-schema-urls",
  "/guides/editor-setup/#option-2-vs-code-yamlschemas-settings",
  "/guides/editor-setup/#offline--air-gapped",
  "/guides/editor-setup/#validate-on-save-vs-code-task",
  "/guides/editor-setup/#errors-dont-appear-in-problems-panel",
  "/guides/ai-agents/#the-machine-error-contract",
  "/guides/ai-agents/#resources-an-agent-should-load",
  "/guides/format-v2/#the-headline-same-map-two-ways",
  "/guides/format-v2/#where-did-my-key-go",
  "/guides/format-v2/#style--what-compiles-to-stylejson",
  "/guides/format-v2/#runtime--what-degrades",
  "/guides/export/#the-export-guarantee",
  "/guides/export/#reattachment-attachinteractions",
  "/guides/export/#emit-a-host-event-and-what-it-truthfully-requires",
  "/guides/export/#large-data-files-in-an-exported-style",
  "/guides/export/#declarative-interactions-in-one-recap",
  "/guides/export-classes/#reading-the-emit-report",
  "/guides/export-classes/#every-construct-classified",
  "/guides/effects/#loading-the-package",
  "/guides/effects/#try-it",
  "/guides/parsing-and-validating/#documents-from-people-you-dont-control",
  // Docs batch 4: renamed or moved sections on the HTML, framework, JS API,
  // story and publishing pages that other pages link to.
  "/integrations/web-components/#slots-your-own-chrome-over-the-map",
  "/integrations/web-components/#method-1-external-yaml-file-recommended",
  "/integrations/web-components/#method-2-inline-yaml-script-tag",
  "/integrations/web-components/#method-3-json-attribute-programmatic",
  "/integrations/web-components/#accessing-the-maplibre-instance",
  "/integrations/web-components/#event-reference",
  "/integrations/web-components/#events-not-firing",
  "/integrations/web-components/#installation-options",
  "/integrations/web-components/#trust-and-attribution",
  "/integrations/react/#setting-up",
  "/integrations/react/#typescript-with-react",
  "/integrations/react/#nextjs",
  "/integrations/react/#vue",
  "/integrations/vanilla-js/#quick-start-javascript-api-more-control",
  "/integrations/vanilla-js/#yamlparser",
  "/integrations/vanilla-js/#maprenderer",
  "/integrations/vanilla-js/#template-literal-yaml-issues",
  "/integrations/vanilla-js/#full-event-list",
  "/integrations/scrollytelling-html/#styling",
  "/integrations/scrollytelling-html/#what-you-get",
  "/integrations/scrollytelling-html/#the-story-inline-in-one-file",
  "/schema/scrollytelling/#the-legend",
  "/schema/scrollytelling/#map-level-keys",
  "/schema/scrollytelling/#chapter-actions",
  "/schema/scrollytelling/#chapter-navigation-rail",
  "/schema/scrollytelling/#showing-a-story",
  "/schema/scrollytelling/#scrollytelling-properties",
  "/guides/publishing/#html-pages-the-base-attribute",
  "/guides/publishing/#large-files-range-requests-and-cors",
  "/guides/publishing/#hosting-maplibre-yamls-own-files",
  "/getting-started/installation/#hosting-the-files-yourself",
  "/reference/elements/#ml-map-events",
  "/reference/elements/#trust-and-attribution",
  // Renamed gallery headings keep their old anchors; the gallery index keeps
  // its group anchors (the examples index and gallery pages link them).
  "/examples/gallery/pmtiles-source-and-protocol/#the-yaml",
  "/examples/gallery/pmtiles-source-and-protocol/#registering-the-protocol-yourself-still-supported",
  "/examples/gallery/flatgeobuf-source/#the-yaml",
  "/examples/gallery/geoparquet-source/#the-yaml",
  "/examples/gallery/add-a-cog-raster-source/#the-yaml",
  "/examples/gallery/#cloud-native-data",
  "/examples/gallery/#map-basics",
  "/examples/gallery/#mapzen-classics",
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

  section("Sections of moved pages (land after the redirect)");
  for (const a of REDIRECTED_ANCHORS) results.push(await check(opts.base, a, { direct: false }));

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

  for (const file of ["/llms.txt", "/llms-full.txt"]) {
    section(`Links in ${file} (agent index)`);
    const page = await fetchPage(opts.base, file);
    if (page.status !== 200) {
      results.push({ ok: false, address: file, why: `HTTP ${page.status}` });
      continue;
    }
    // A playground #code/ fragment is a share-link prefix, not an element id.
    const links = siteLinks(page.body).map((a) => (a.startsWith("/playground/") ? a.split("#")[0] : a));
    for (const a of new Set(links)) results.push(await check(opts.base, a, { direct: true }));
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
