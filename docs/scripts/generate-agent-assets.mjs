/**
 * @file Generate agent-facing docs assets at build time.
 *
 * Runs during the docs build (before `astro build`) so the hosted artifacts
 * can never go stale relative to the core schemas they document. Produces,
 * into `docs/public/` (all git-ignored, generate-on-build):
 *
 *  - `schema/latest/<block>.schema.json`   — stable schema URLs
 *  - `schema/v<major.minor>/<block>.schema.json` — versioned copies
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '..');
const REPO_ROOT = join(DOCS_ROOT, '..');
const CORE_SCHEMAS_DIR = join(REPO_ROOT, 'packages', 'core', 'schemas');
const PUBLIC_DIR = join(DOCS_ROOT, 'public');
const CONFIGS_DIR = join(PUBLIC_DIR, 'configs');

const SITE = 'https://docs.maplibre-yaml.org';
const BLOCKS = ['map', 'scrollytelling', 'root', 'any'];

/** The five most instructive complete configs, in teaching order. */
const CURATED_CONFIGS = [
  'complete-example.yaml',
  'interactive-points.yaml',
  'clustering.yaml',
  'earthquake-tracker.yaml',
  'quickstart-interactive.yaml',
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

function readConfig(name) {
  const file = join(CONFIGS_DIR, name);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8');
}

/** A complete, canonical map block demonstrating the popup tag-array DSL. */
const POPUP_EXAMPLE = `# yaml-language-server: $schema=${SITE}/schema/latest/map.schema.json
type: map
id: places
config:
  center: [-122.4, 37.77]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: locations
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - type: Feature
            geometry: { type: Point, coordinates: [-122.4194, 37.7749] }
            properties: { name: "City Hall", rating: 4.2 }
    paint:
      circle-radius: 12
      circle-color: "#6366f1"
    interactive:
      click:
        # Popups use the tag-array DSL: an array of single-key { tag: [items] }
        # objects. Each item is { str } (literal), { property } (feature field),
        # optionally with { else } (fallback) and { format } (number format).
        popup:
          - h3:
              - property: name
          - p:
              - str: "Rating: "
              - property: rating
                format: ".1f"
              - str: " / 5"`;

/** A complete map block showing a block-level named source used by bare name. */
const NAMED_SOURCE_EXAMPLE = `# yaml-language-server: $schema=${SITE}/schema/latest/map.schema.json
type: map
id: quakes
config:
  center: [-120, 37]
  zoom: 4
  mapStyle: "https://demotiles.maplibre.org/style.json"
# Define named sources once at the block level...
sources:
  quakes:
    type: geojson
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
layers:
  - id: quake-points
    type: circle
    # ...then reference by BARE NAME (a string), not an inline object:
    source: quakes
    paint:
      circle-radius: 6
      circle-color: "#e55e5e"`;

function buildLlmsTxt(version) {
  const schemaUrls = BLOCKS.map(
    (b) => `- ${b}:            ${SITE}/schema/latest/${b}.schema.json`,
  ).join('\n');

  const curated = CURATED_CONFIGS.filter((c) => readConfig(c) !== null)
    .map((c) => `- ${SITE}/configs/${c}`)
    .join('\n');

  return `# maplibre-yaml

> Declarative, interactive web maps defined entirely in YAML, validated by Zod
> and rendered with MapLibre GL. A config is the product: author it, validate
> it, ship it. Core version: ${version}.

maplibre-yaml turns a YAML document into a map. Three document shapes exist:
a \`type: map\` block, a \`type: scrollytelling\` block, and a root document with
a top-level \`pages:\` array (a multi-page app). The \`<ml-map src>\` web
component and the \`mlym\` CLI both dispatch on the top-level \`type\` field.

## Read these first — the three things agents get wrong

1. \`<ml-map src="...">\` expects a **\`type: map\` block**, NOT a \`pages:\` root
   document. A single map file starts with \`type: map\`. Only use a top-level
   \`pages:\` array when you are building a multi-page app rendered by a
   framework integration — never as the \`src\` of \`<ml-map>\`.

2. Popups use the **tag-array DSL**: \`popup\` is an array of single-key
   \`{ tag: [items] }\` objects (\`h3\`, \`p\`, \`a\`, \`img\`, ...). Each item is
   \`{ str: "literal" }\` or \`{ property: "fieldName" }\` (optionally with
   \`else\` and \`format\`). It is NOT an HTML string and NOT a \`{ title, description }\`
   object. Complete example:

\`\`\`yaml
${POPUP_EXAMPLE}
\`\`\`

3. **Named sources are referenced by bare name.** Define sources once under a
   block-level \`sources:\` map, then set a layer's \`source:\` to the source's
   name as a plain string. Complete example:

\`\`\`yaml
${NAMED_SOURCE_EXAMPLE}
\`\`\`

## JSON Schema (authoring assistance)

Point your editor's \`yaml-language-server\` at these URLs (add as the first
line of any config) for autocomplete, hover docs, and inline validation:

${schemaUrls}

Modeline (first line of a map config):

    # yaml-language-server: $schema=${SITE}/schema/latest/map.schema.json

The JSON Schema is advisory. \`mlym validate\` (Zod) is the source of truth and
enforces cross-field rules the JSON Schema cannot express.

## Validate loop (the whole agent workflow)

Generate a config, then repair it against structured validator output:

    npx @maplibre-yaml/cli validate my-map.yaml -f json

\`-f json\` emits \`{ valid, files: [{ file, errors: [{ path, message, line,
column }] }] }\`. Fix each \`path\`/\`message\`, re-run until \`valid: true\`.
\`mlym schema <map|scrollytelling|root|any>\` prints the exact JSON Schema for
the installed core version.

## Most instructive complete configs

${curated}

## More

- Full reference (schemas + examples inline): ${SITE}/llms-full.txt
- Human docs: ${SITE}
- Using maplibre-yaml with an AI agent: ${SITE}/guides/ai-agents/
`;
}

function buildLlmsFullTxt(version) {
  const parts = [];
  parts.push(buildLlmsTxt(version));
  parts.push('\n\n' + '='.repeat(78));
  parts.push('# FULL JSON SCHEMA REFERENCE');
  parts.push('='.repeat(78) + '\n');
  parts.push(
    'The authoritative, machine-readable field reference for each document ' +
      'shape follows. These are the same schemas served at ' +
      `${SITE}/schema/latest/.\n`,
  );
  for (const block of ['map', 'scrollytelling', 'root']) {
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
  for (const name of CURATED_CONFIGS) {
    const content = readConfig(name);
    if (!content) continue;
    parts.push(`\n----- ${name} (${SITE}/configs/${name}) -----\n`);
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
      )}}/ + llms.txt + llms-full.txt`,
    );
  }
  return { skipped: false, version, schemaCount };
}

// Run directly: `node docs/scripts/generate-agent-assets.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAgentAssets();
}
