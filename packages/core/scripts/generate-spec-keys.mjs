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
import { latest, expressions, CompoundExpression } from "@maplibre/maplibre-gl-style-spec";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const paint = new Set();
const layout = new Set();
for (const type of Object.keys(latest.layer.type.values)) {
  for (const key of Object.keys(latest[`paint_${type}`] ?? {})) paint.add(key);
  for (const key of Object.keys(latest[`layout_${type}`] ?? {})) layout.add(key);
}

// Every expression operator the spec's parser registers. The `filter-*`
// entries are MapLibre-internal forms its legacy-filter conversion produces;
// nobody writes them, and they would only crowd did-you-mean hints.
const operators = new Set(Object.keys(expressions).filter((op) => !op.startsWith("filter-")));

// Operators with a zero-argument form (["zoom"], ["elevation"]): read from the
// compound expressions' overloads, where a zero-argument overload has no params.
const zeroArg = new Set();
for (const op of operators) {
  const def = CompoundExpression.definitions?.[op];
  if (!Array.isArray(def)) continue;
  const overloads = Array.isArray(def[1]) ? [def[1]] : (def[1]?.overloads ?? []).map((o) => o[0]);
  if (overloads.some((params) => Array.isArray(params) && params.length === 0)) zeroArg.add(op);
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

/**
 * Every expression operator in the style spec's expression registry (the
 * MapLibre-internal \`filter-*\` forms left out). The operator check in
 * validation-utils.ts consults this, so an operator MapLibre gained since a
 * hand list was written (split, join, elevation…) is never "unknown".
 */
export const SPEC_EXPRESSION_OPERATORS: ReadonlySet<string> = new Set([
${fmt(operators)}
]);

/** The operators that have a zero-argument form (\`["zoom"]\`, \`["elevation"]\`). */
export const SPEC_ZERO_ARG_OPERATORS: ReadonlySet<string> = new Set([
${fmt(zeroArg)}
]);
`;

const dest = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/parser/spec-keys.generated.ts"
);
writeFileSync(dest, out);
console.log(
  `wrote ${dest}: ${paint.size} paint keys, ${layout.size} layout keys, ${operators.size} expression operators (spec v${latest.$version})`
);
