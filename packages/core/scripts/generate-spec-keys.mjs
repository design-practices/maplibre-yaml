/**
 * Regenerate src/parser/spec-keys.generated.ts from the installed
 * @maplibre/maplibre-gl-style-spec.
 *
 * The curated zod paint/layout shapes drive typed DX and typo hints, but they
 * inevitably lag the style spec — and `mlym validate` promotes unknown-key
 * warnings to errors in CI, so a *correct* document using a newer spec key
 * failed strict validation (ml-chh.11). The warning walker consults these
 * generated sets instead of hand-maintained lists: any real spec key is never
 * "unknown". A unit test (tests/parser/spec-keys.test.ts) recomputes the sets
 * from the dependency and fails if this file is stale — bump the dep, rerun:
 *
 *   node scripts/generate-spec-keys.mjs
 */
import { latest } from "@maplibre/maplibre-gl-style-spec";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const paint = new Set();
const layout = new Set();
for (const type of Object.keys(latest.layer.type.values)) {
  for (const key of Object.keys(latest[`paint_${type}`] ?? {})) paint.add(key);
  for (const key of Object.keys(latest[`layout_${type}`] ?? {})) layout.add(key);
}

const fmt = (set) =>
  [...set]
    .sort()
    .map((k) => `  "${k}",`)
    .join("\n");

const out = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Every paint/layout property name in the MapLibre style spec (union across
 * all layer types), as of @maplibre/maplibre-gl-style-spec v${latest.$version}.
 * Regenerate with: node scripts/generate-spec-keys.mjs
 * Consumed by the unknown-key warning walker in validation-utils.ts — a key
 * in these sets rides .passthrough() to MapLibre without an "unknown key"
 * warning; anything else still warns (and hints against these pools).
 */

export const SPEC_VERSION = ${latest.$version};

export const SPEC_PAINT_KEYS: ReadonlySet<string> = new Set([
${fmt(paint)}
]);

export const SPEC_LAYOUT_KEYS: ReadonlySet<string> = new Set([
${fmt(layout)}
]);
`;

const dest = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/parser/spec-keys.generated.ts"
);
writeFileSync(dest, out);
console.log(
  `wrote ${dest}: ${paint.size} paint keys, ${layout.size} layout keys (spec v${latest.$version})`
);
