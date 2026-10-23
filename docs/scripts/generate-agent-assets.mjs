/**
 * @file Generate agent-facing docs assets at build time.
 *
 * Runs during the docs build (before `astro build`) so the hosted artifacts
 * can never go stale relative to the core schemas they document. Produces,
 * into `docs/public/` (all git-ignored, generate-on-build):
 *
 *  - `schema/latest/<block>.schema.json`   — stable schema URLs
 *  - `schema/v<major.minor>/<block>.schema.json` — versioned copies
 *  - `_redirects`                          — older `schema/v<major.minor>/`
 *                                            URLs → the CDN copy of that
 *                                            release's schemas, and moved docs
 *                                            pages (docs/redirects.mjs) → their
 *                                            new address (Cloudflare Pages)
 *  - `llms.txt`                            — agent index
 *  - `llms-full.txt`                       — self-contained agent reference
 *
 * Source of truth: the JSON Schemas emitted by @maplibre-yaml/core
 * (`packages/core/schemas/*.json`) and the canonical example configs in
 * `docs/public/configs/`. Build core first (`pnpm --filter
 * @maplibre-yaml/core build`) so the schemas exist.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflarePageRedirectLines } from '../redirects.mjs';
import { SHARE_PREFIX, SHARE_WARN_LENGTH } from '../src/playground/share.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '..');
const REPO_ROOT = join(DOCS_ROOT, '..');
const CORE_SCHEMAS_DIR = join(REPO_ROOT, 'packages', 'core', 'schemas');
const PUBLIC_DIR = join(DOCS_ROOT, 'public');
const CONFIGS_DIR = join(PUBLIC_DIR, 'configs');

const SITE = 'https://docs.maplibre-yaml.org';
/** Every schema core emits. All are served: editor modelines pin each one. */
const BLOCKS = ['map', 'scrollytelling', 'root', 'any'];
/**
 * The schemas llms.txt recommends and llms-full.txt prints. `root` (the
 * multi-page `pages:` document) stays served for the modelines that point at
 * it, but it is deprecated: such a document validates, nothing renders it,
 * and validation warns "has no effect". Agents aren't steered to it.
 */
export const RECOMMENDED_BLOCKS = ['map', 'scrollytelling', 'any'];

/**
 * The most instructive complete configs, in teaching order, each with what it
 * shows. All live in docs/public/configs/ and are the files the docs pages
 * draw; docs/test/agent-assets.test.mjs checks each exists and validates.
 */
export const CURATED_CONFIGS = [
  {
    file: 'earthquakes.yaml',
    shows: 'a live GeoJSON feed, circles sized by magnitude, a click popup',
  },
  {
    file: 'interactive-points.yaml',
    shows:
      'points written in the document, a category map with `classify:` `categories:`, hover highlight',
  },
  {
    file: 'classify/choropleth.yaml',
    shows:
      'a choropleth: `classify:` with quantile classes, a palette and the automatic legend',
  },
  {
    file: 'classify/rate.yaml',
    shows: 'a rate, not a count: `normalize:` and `multiply:`, Jenks classes',
  },
  {
    file: 'cloud-native-demo.yaml',
    shows: 'large data: PMTiles (raster and vector) and FlatGeobuf sources, `fitTo:`',
  },
  {
    file: 'earthquake-tracker.yaml',
    shows: 'live data polled every minute with `refresh:`',
  },
  {
    file: 'earthquake-story.yaml',
    shows:
      'a story map (`type: scrollytelling`): chapters, camera moves, a chapter action, a legend',
  },
];

function coreVersion() {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', 'core', 'package.json'), 'utf-8'),
  );
  return pkg.version;
}

/** "0.3.4" -> "0.3" */
function majorMinor(version) {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

function readSchema(block) {
  const file = join(CORE_SCHEMAS_DIR, `${block}.schema.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/** Copy schemas to public/schema/latest and public/schema/v<major.minor>. */
function writeSchemas(version) {
  const latestDir = join(PUBLIC_DIR, 'schema', 'latest');
  const versionDir = join(PUBLIC_DIR, 'schema', `v${majorMinor(version)}`);
  mkdirSync(latestDir, { recursive: true });
  mkdirSync(versionDir, { recursive: true });

  let count = 0;
  for (const block of BLOCKS) {
    const schema = readSchema(block);
    if (!schema) continue;
    count++;
    // latest: keep $id as emitted (points at /schema/latest/...).
    writeFileSync(
      join(latestDir, `${block}.schema.json`),
      JSON.stringify(schema, null, 2) + '\n',
      'utf-8',
    );
    // versioned: rewrite $id to the versioned URL so tooling pins correctly.
    const versioned = {
      ...schema,
      $id: `${SITE}/schema/v${majorMinor(version)}/${block}.schema.json`,
    };
    writeFileSync(
      join(versionDir, `${block}.schema.json`),
      JSON.stringify(versioned, null, 2) + '\n',
      'utf-8',
    );
  }
  return count;
}

/**
 * The first release whose npm package ships `schemas/*.schema.json`. Every
 * minor from here up to (not including) the current one gets a redirect.
 */
const FIRST_SCHEMA_MINOR = { major: 0, minor: 4 };

/**
 * Keep older pinned schema URLs working.
 *
 * @remarks
 * The site is a single deploy, so `schema/v<major.minor>/` only ever holds the
 * release the docs were built from: when 0.7 shipped, `/schema/v0.6/…` (which
 * editor-setup told readers to pin) started returning 404, and an editor
 * pointed at it silently stopped completing. Each release's npm package ships
 * the same schemas, so a Cloudflare Pages `_redirects` rule sends an older
 * minor to that copy on jsDelivr (CORS-enabled, immutable per version).
 */
function writeSchemaRedirects(version) {
  const [major, minor] = version.split('.').map(Number);
  const lines = [
    '# Generated by docs/scripts/generate-agent-assets.mjs. Do not edit.',
    '# Older pinned schema URLs -> the schemas inside that release on npm.',
  ];
  if (major !== FIRST_SCHEMA_MINOR.major) {
    // A 1.x site would also need the 0.x lines; extend this when it happens.
    throw new Error(
      `writeSchemaRedirects: core ${version} is past the 0.x line; list the older minors explicitly.`,
    );
  }
  for (let m = FIRST_SCHEMA_MINOR.minor; m < minor; m++) {
    lines.push(
      `/schema/v${major}.${m}/* https://cdn.jsdelivr.net/npm/@maplibre-yaml/core@${major}.${m}/schemas/:splat 302`,
    );
  }
  const schemaLines = lines.length - 2;
  // Pages that moved (docs/redirects.mjs): HTTP 301s keep a link's #fragment,
  // which the meta-refresh pages Astro writes for the same paths drop.
  lines.push('# Docs pages that moved -> their new address (docs/redirects.mjs).');
  lines.push(...cloudflarePageRedirectLines());
  writeFileSync(join(PUBLIC_DIR, '_redirects'), lines.join('\n') + '\n', 'utf-8');
  return schemaLines;
}

/**
 * Every docs-site address in a text, as a site path with its query and
 * fragment (`/guides/pmtiles/`, `/playground/#code/`). Trailing sentence
 * punctuation is dropped. docs/test/agent-assets.test.mjs and
 * check-stable-urls.mjs check that each one resolves.
 */
export function siteLinks(text) {
  const out = new Set();
  for (const m of text.matchAll(/https:\/\/docs\.maplibre-yaml\.org([^\s)>"'`<\]]*)/g)) {
    out.add(m[1].replace(/[.,;:]+$/, '') || '/');
  }
  return [...out];
}

export function readConfig(name) {
  const file = join(CONFIGS_DIR, name);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8');
}

/*
 * The worked examples in llms.txt. Each is a complete map document, so an
 * agent can copy one whole; docs/test/agent-assets.test.mjs validates every
 * ```yaml fence in the generated files. Basemap and data follow the docs'
 * running example (docs/STYLE.md): OpenFreeMap, the USGS feed, the sample
 * tracts.
 */
const MODELINE = `# yaml-language-server: $schema=${SITE}/schema/latest/map.schema.json`;
const QUAKES_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';

/** 1. The shape of a map document. */
const SHAPE_EXAMPLE = `${MODELINE}
type: map
id: quakes
title: Earthquakes this week        # the map's name for screen readers
config:                             # the camera and the basemap
  center: [-120, 37]                # [longitude, latitude]
  zoom: 4
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"`;

/** 2 and 3. A named source referenced by its bare name, with a popup. */
const NAMED_SOURCE_EXAMPLE = `${MODELINE}
type: map
id: quakes
config:
  center: [-120, 37]
  zoom: 4
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
sources:
  quakes:
    type: geojson
    url: "${QUAKES_URL}"
layers:
  - id: quake-points
    type: circle
    source: quakes                  # the name, not an inline object
    paint:
      circle-radius: 6
      circle-color: "#e55e5e"
    interactive:
      hover:
        cursor: pointer
      click:
        popup:                      # a list of elements, not HTML
          - h3:
              - property: title
          - p:
              - str: "Magnitude "
              - property: mag
                format: { max-fraction-digits: 1 }`;

/** 4. Large-data files keep MapLibre's source type. */
const LARGE_DATA_EXAMPLE = `${MODELINE}
type: map
id: city
config:
  center: [-73.98, 40.71]
  zoom: 13
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
sources:
  buildings:
    type: vector                    # not type: pmtiles
    url: data/buildings.pmtiles
  parcels:
    type: geojson                   # not type: flatgeobuf
    url: data/parcels.fgb
layers:
  - id: buildings
    type: fill
    source: buildings
    source-layer: buildings
    paint:
      fill-color: "#d9d9d9"
  - id: parcels
    type: line
    source: parcels
    paint:
      line-color: "#1d3557"`;

/** 5. A choropleth with classify: and its automatic legend. */
const CLASSIFY_EXAMPLE = `${MODELINE}
type: map
id: income
config:
  center: [-75.19, 39.936]
  zoom: 12
  mapStyle: "https://tiles.openfreemap.org/styles/positron"
sources:
  tracts:
    type: geojson
    url: "${SITE}/data/classify/sample-tracts.geojson"
layers:
  - id: income
    type: fill
    source: tracts
    label: Median household income  # the legend's heading
    classify:
      field: median_income
      method: quantile              # or equal, jenks; or breaks: [...]
      classes: 5
      palette: Blues
    paint:
      fill-opacity: 0.85`;

/** The CDN page that shows a map document, pinned to core's release line. */
function htmlPage(version) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Earthquakes this week</title>
    <link href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css" rel="stylesheet" />
    <script type="importmap">
      { "imports": { "maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs" } }
    </script>
    <script type="module" src="https://unpkg.com/@maplibre-yaml/core@${majorMinor(version)}/register.js"></script>
    <style>
      body { margin: 0; }
      ml-map { display: block; height: 100vh; }
    </style>
  </head>
  <body>
    <ml-map src="./map.yaml"></ml-map>
  </body>
</html>`;
}

const SCHEMA_ROLES = {
  map: 'a map document (`type: map`)',
  scrollytelling: 'a story map (`type: scrollytelling`)',
  any: 'either kind; use it when one setting covers a folder of both',
};

export function buildLlmsTxt(version) {
  const schemaUrls = RECOMMENDED_BLOCKS.map(
    (b) => `- ${SCHEMA_ROLES[b]}: ${SITE}/schema/latest/${b}.schema.json`,
  ).join('\n');

  const curated = CURATED_CONFIGS.filter(({ file }) => readConfig(file) !== null)
    .map(({ file, shows }) => `- ${SITE}/configs/${file} — ${shows}`)
    .join('\n');

  return `# maplibre-yaml

> Declarative, interactive web maps defined entirely in YAML, validated by Zod
> and rendered with MapLibre GL. A map document is the product: write it,
> validate it, ship it. Core version: ${version}.

maplibre-yaml turns a YAML document into a map. A document is a
\`type: map\` map document (rendered by \`<ml-map src>\`) or a
\`type: scrollytelling\` story map (rendered by \`<ml-scrollytelling src>\`).
The web components and the \`mlym\` CLI both dispatch on the top-level
\`type\` field.

**Write format v1, the default.** Every schema, example and guide uses it.
Format v2 (\`version: 2\`, split into \`style:\` and \`runtime:\`) is an opt-in
layout of the same map; story maps are v1 only. Don't write v2 unless asked,
and never mix the two.

## Read these first — the mistakes agents make most

1. **A map document is \`type: map\` with a \`config:\` block.** The camera and
   the basemap go under \`config:\`, not at the top level; every other key
   (\`sources:\`, \`layers:\`, \`controls:\`, \`legend:\`, \`title:\`) sits beside
   \`config:\`. \`center\` is \`[longitude, latitude]\`.

\`\`\`yaml
${SHAPE_EXAMPLE}
\`\`\`

2. **A named source is referenced by its bare name, and must exist.** Declare
   it once under \`sources:\`, then set a layer's \`source:\` to that name as a
   plain string. A \`source:\` (or \`$ref\`) naming a source the document
   doesn't define fails validation; the message names the sources that are.

\`\`\`yaml
${NAMED_SOURCE_EXAMPLE}
\`\`\`

3. **Popups are a list of elements**, not an HTML string and not a
   \`{ title, description }\` object: \`popup:\` is a list of single-key
   \`{ tag: [items] }\` objects (\`h3\`, \`p\`, \`a\`, \`img\`, ...). Each item is
   \`{ str: "fixed text" }\` or \`{ property: fieldName }\`, optionally with
   \`else:\` (a fallback) and \`format:\` (number format options), as in the
   example above.

4. **A file format is not a source type.** \`type: pmtiles\`,
   \`type: flatgeobuf\`, \`type: geoparquet\` and \`type: cog\` are errors. Keep
   the type MapLibre draws and point \`url:\` at the file: the file name says
   how to read it. PMTiles → \`vector\` (or \`raster\`, \`raster-dem\`);
   \`.fgb\` and \`.parquet\` → \`geojson\`; a COG \`.tif\` → \`raster\` (or
   \`raster-dem\`). \`format:\` names the format when the URL has no extension.

\`\`\`yaml
${LARGE_DATA_EXAMPLE}
\`\`\`

5. **Use \`classify:\` for a choropleth, graduated circles or a category map**,
   not a hand-written \`step\` or \`match\` expression. It writes the colour
   expression and the legend from one block: \`method:\` (\`quantile\`,
   \`equal\`, \`jenks\`) or your own \`breaks:\`, or \`categories:\`; a named
   \`palette:\`; \`normalize:\` for rates. The legend appears by itself.

\`\`\`yaml
${CLASSIFY_EXAMPLE}
\`\`\`

## Show it on a page

Save the document as \`map.yaml\` next to this \`index.html\`, and serve the
folder over HTTP (\`npx serve .\`; a \`file://\` page can't fetch the YAML):

\`\`\`html
${htmlPage(version)}
\`\`\`

- Step by step: ${SITE}/getting-started/quick-start/
- In an Astro site: ${SITE}/integrations/astro/
- In React: ${SITE}/integrations/react/
- A story map on a page: ${SITE}/integrations/scrollytelling-html/

## What it can do

- Thematic maps: \`classify:\` (breaks, quantile, equal-interval, Jenks,
  categories, palettes, graduated \`radius:\`), \`normalize:\` for rates, and a
  legend generated for it. ${SITE}/guides/thematic-maps/
- Large data from a static host, no tile server: PMTiles, FlatGeobuf,
  GeoParquet and Cloud Optimized GeoTIFF (COG).
  ${SITE}/guides/cloud-native-data/, then one page per format:
  ${SITE}/guides/pmtiles/, ${SITE}/guides/flatgeobuf/,
  ${SITE}/guides/geoparquet/, ${SITE}/guides/cog/
- A whole basemap from one Protomaps \`.pmtiles\` file, no API key:
  \`mapStyle: data/city.pmtiles\`, or \`mapStyle: { pmtiles: data/city.pmtiles,
  flavor: dark }\`. ${SITE}/guides/host-your-own-basemap/
- Story maps: chapters that move the camera, show and hide layers and run
  actions (\`onChapterEnter\`, \`onChapterExit\`) as the reader scrolls, with a
  legend and a chapter rail. ${SITE}/schema/scrollytelling/
- Accessibility and languages: \`title:\` and \`description:\` name and describe
  the map for screen readers (\`description\` is its alt text); \`locale:\`
  under \`config:\` translates the map's controls and messages.
  ${SITE}/guides/accessibility-languages/
- Live data: \`refresh:\` polls a URL, \`stream:\` listens to server-sent events
  or a WebSocket. ${SITE}/guides/live-data/
- Sources, layers, named sources and \`$ref\`: ${SITE}/schema/sources-and-layers/
- Popups, hover and controls: ${SITE}/guides/popups/
- Export to a MapLibre style.json with \`mlym emit\`: ${SITE}/guides/export/

## Hand the user a map: the playground

${SITE}/playground/ edits a document in the browser, validates it as you
type and draws the map. A share link carries the document itself, so it
needs no server: \`${SITE}/playground/${SHARE_PREFIX}\` followed by the document
compressed with lz-string's \`compressToEncodedURIComponent\`. With Node.js
and \`npm install lz-string\`:

    node -e 'const lz=require("lz-string");console.log("${SITE}/playground/${SHARE_PREFIX}"+lz.compressToEncodedURIComponent(require("fs").readFileSync("map.yaml","utf8")))'

Links over about ${SHARE_WARN_LENGTH.toLocaleString('en-US')} characters get cut by some chat apps and mail
clients. To open a config from this site instead, name it with \`?src=\`:
${SITE}/playground/?src=/configs/earthquake-story.yaml (any file listed under
"Most instructive complete configs" works).

## JSON Schema (authoring assistance)

Put the modeline as the first line of a document for autocomplete, hover
docs and inline validation in any editor with \`yaml-language-server\`:

    ${MODELINE}

${schemaUrls}

The JSON Schema is advisory. \`mlym validate\` (Zod) is the source of truth and
enforces cross-field rules the JSON Schema cannot express, such as a layer
naming an undefined source. \`mlym schema <map|scrollytelling|any>\` prints the
schema of the installed core version.

## Validate loop (the whole agent workflow)

Generate a document, then repair it against structured validator output:

    npx maplibre-yaml@latest validate map.yaml -f json

\`-f json\` emits \`{ valid, files: [{ file, errors: [{ path, message, line,
column }], warnings: [...] }] }\`. Fix each \`path\`/\`message\` and re-run
until \`valid: true\`. Exit code 0 means valid, 1 errors (or warnings in strict
mode, which is on when \`CI\` is set), 2 a file that wasn't found. Fix warnings
too: they name things that validate but don't do what the author meant.

## Don't write these

They validate, but do nothing or have a newer form, and validation warns:

- Multi-page \`pages:\` documents (\`root.schema.json\`): nothing renders them.
  Write a \`type: map\` or \`type: scrollytelling\` document instead. (Their
  root \`theme:\` and \`dataFetching:\` do nothing; a story's own \`theme:\`
  works.)
- On a source: \`loading:\` and \`fetchStrategy:\` (no effect; delete them);
  top-level \`refreshInterval\`, \`updateStrategy\`, \`updateKey\` (move them
  into \`refresh:\`).
- \`interactive.mouseenter\` / \`mouseleave\`: use \`hover:\`.
- Schema descriptions that start "No effect (deprecated)" or "Deprecated"
  mark the rest.

## Most instructive complete configs

${curated}

Paths that start with \`/\` in these files (\`/data/…\`, \`/gallery-assets/…\`)
are files on this site: copy them into your own site at the same path.

## More

- Full reference (schemas + example configs inline): ${SITE}/llms-full.txt
- Using maplibre-yaml with an AI agent: ${SITE}/guides/ai-agents/
- Format overview: ${SITE}/schema/overview/
- What changed in 0.9: ${SITE}/getting-started/upgrading/
- Human docs: ${SITE}/
`;
}

export function buildLlmsFullTxt(version) {
  const parts = [];
  parts.push(buildLlmsTxt(version));
  parts.push('\n\n' + '='.repeat(78));
  parts.push('# FULL JSON SCHEMA REFERENCE');
  parts.push('='.repeat(78) + '\n');
  parts.push(
    'The authoritative, machine-readable field reference for the two kinds of ' +
      'document follows: the same files the schema URLs above serve. ' +
      'Keys whose description starts "No effect ' +
      '(deprecated)" or "Deprecated" are accepted for old documents; don\'t ' +
      'write them. root.schema.json (multi-page `pages:` documents) is ' +
      'deprecated and not printed here.\n',
  );
  for (const block of RECOMMENDED_BLOCKS.filter((b) => b !== 'any')) {
    const schema = readSchema(block);
    if (!schema) continue;
    parts.push(`\n----- ${block}.schema.json -----\n`);
    parts.push('```json');
    parts.push(JSON.stringify(schema, null, 2));
    parts.push('```');
  }

  parts.push('\n\n' + '='.repeat(78));
  parts.push('# CANONICAL EXAMPLE CONFIGS');
  parts.push('='.repeat(78) + '\n');
  parts.push(
    'Each is the file a docs page draws. Paths that start with `/` are files ' +
      `on ${SITE}: copy them into your own site at the same path.\n`,
  );
  for (const { file, shows } of CURATED_CONFIGS) {
    const content = readConfig(file);
    if (!content) continue;
    parts.push(`\n----- ${file} (${SITE}/configs/${file}) -----\n`);
    parts.push(`Shows ${shows}.\n`);
    parts.push('```yaml');
    parts.push(content.trimEnd());
    parts.push('```');
  }
  return parts.join('\n') + '\n';
}

export function generateAgentAssets({ quiet = false } = {}) {
  if (!existsSync(CORE_SCHEMAS_DIR)) {
    const msg =
      '[agent-assets] core schemas not found at ' +
      CORE_SCHEMAS_DIR +
      ' — run `pnpm --filter @maplibre-yaml/core build` first. Skipping.';
    if (!quiet) console.warn(msg);
    return { skipped: true };
  }
  const version = coreVersion();
  const schemaCount = writeSchemas(version);

  mkdirSync(PUBLIC_DIR, { recursive: true });
  const redirectCount = writeSchemaRedirects(version);
  writeFileSync(join(PUBLIC_DIR, 'llms.txt'), buildLlmsTxt(version), 'utf-8');
  writeFileSync(
    join(PUBLIC_DIR, 'llms-full.txt'),
    buildLlmsFullTxt(version),
    'utf-8',
  );

  if (!quiet) {
    console.log(
      `[agent-assets] wrote ${schemaCount} schemas to public/schema/{latest,v${majorMinor(
        version,
      )}}/ + ${redirectCount} older-version redirect(s) + llms.txt + llms-full.txt`,
    );
  }
  return { skipped: false, version, schemaCount, redirectCount };
}

// Run directly: `node docs/scripts/generate-agent-assets.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAgentAssets();
}
