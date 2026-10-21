/**
 * The YAML `@example` blocks in core's source render in the TypeDoc
 * reference (/reference/api/), which `docs:validate-snippets` skips as
 * generated. So they are checked here, at the source (ml-aot.135), by the
 * docs validator's rules: a whole document (`type: map` / `type:
 * scrollytelling`, or a multi-page root with `pages:`) validates as written;
 * a fragment readers paste into a map (a list of layers, or a mapping of
 * map-block keys only) validates wrapped in a minimal map. Other YAML (a
 * `paint:` on its own, a single `source:`) is not a document and is skipped.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { YAMLParser } from "../../src/parser";

const SRC = join(__dirname, "../../src");

const MAP_BLOCK_KEYS = new Set([
  "config", "layers", "sources", "controls", "legend", "title", "description",
  "markers", "images", "terrain", "sky", "light", "projection", "params",
]);
const LAYER_TYPES = new Set([
  "circle", "line", "fill", "fill-extrusion", "symbol", "heatmap", "hillshade",
  "raster", "background", "color-relief",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : []
  );
}

/** The YAML to validate for an example, or undefined when it isn't a document or a map fragment. */
function asDocument(yaml: string): string | undefined {
  if (/^type:\s*["']?(map|scrollytelling)\b/m.test(yaml) || /^pages:/m.test(yaml)) return yaml;
  let value: unknown;
  try {
    value = parse(yaml);
  } catch {
    return undefined;
  }
  let block: Record<string, unknown>;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((l) => l && typeof l === "object" && "id" in l && LAYER_TYPES.has((l as { type?: string }).type ?? ""))
  ) {
    block = { layers: value };
  } else if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((k) => MAP_BLOCK_KEYS.has(k))
  ) {
    block = { ...(value as Record<string, unknown>) };
  } else {
    return undefined;
  }
  return stringify({
    type: "map",
    id: "snippet",
    ...block,
    config: {
      center: [0, 0],
      zoom: 1,
      mapStyle: "https://tiles.openfreemap.org/styles/liberty",
      ...((block["config"] as Record<string, unknown>) ?? {}),
    },
    layers: block["layers"] ?? [],
  });
}

const examples = sourceFiles(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/^\s*\* ```ya?ml\n([\s\S]*?)^\s*\* ```/gm)].map((m, i) => ({
    name: `${relative(SRC, file)} #${i}`,
    yaml: m[1]!
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n"),
  }))
);

describe("core JSDoc YAML examples validate (ml-aot.135)", () => {
  const documents = examples
    .map((e) => ({ ...e, doc: asDocument(e.yaml) }))
    .filter((e): e is typeof e & { doc: string } => e.doc !== undefined);

  it("finds the examples that are documents or map fragments", () => {
    expect(documents.length).toBeGreaterThan(20);
  });

  it.each(documents.map((e) => [e.name, e.doc] as const))("%s", (_name, doc) => {
    const { result } = YAMLParser.safeParseAny(doc);
    expect(result.errors).toEqual([]);
  });
});
