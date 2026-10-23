/**
 * llms.txt and llms-full.txt (docs/scripts/generate-agent-assets.mjs) are
 * what an agent reads before it writes a map document, so they must not
 * steer it wrong: they name the current core version, recommend only the
 * schemas of documents that render, carry only examples that validate with
 * no warnings, and link only addresses that exist on this site.
 * check-stable-urls.mjs checks the same links against a served build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { YAMLParser } from "@maplibre-yaml/core";
import {
  buildLlmsTxt,
  buildLlmsFullTxt,
  siteLinks,
  CURATED_CONFIGS,
  RECOMMENDED_BLOCKS,
} from "../scripts/generate-agent-assets.mjs";
import { safeSrc } from "../src/playground/share.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(DOCS, "..", "packages", "core");
const version = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).version;
const haveSchemas = existsSync(join(CORE, "schemas", "map.schema.json"));

const llms = buildLlmsTxt(version);
const full = buildLlmsFullTxt(version);

/** The ```<lang> fences of a text. */
function fences(text, lang) {
  return [...text.matchAll(new RegExp("^```" + lang + "\\n([\\s\\S]*?)^```$", "gm"))].map((m) => m[1]);
}

test("llms.txt names the current core version and its CDN release line", () => {
  assert.match(llms, new RegExp(`Core version: ${version.replace(/\./g, "\\.")}\\.`));
  const line = version.split(".").slice(0, 2).join(".");
  assert.ok(llms.includes(`@maplibre-yaml/core@${line}/register.js`), `CDN pin is @${line}`);
});

test("llms.txt recommends format v1 and doesn't recommend the root (pages:) schema", () => {
  assert.ok(!RECOMMENDED_BLOCKS.includes("root"));
  assert.ok(!llms.includes("/schema/latest/root.schema.json"), "no link to the deprecated root schema");
  assert.match(llms, /Write format v1, the default/);
  for (const b of RECOMMENDED_BLOCKS) {
    assert.ok(llms.includes(`https://docs.maplibre-yaml.org/schema/latest/${b}.schema.json`), b);
  }
  // root.schema.json is named only to say not to write it.
  const mentions = llms.split("\n").filter((l) => l.includes("root.schema.json"));
  assert.ok(mentions.every((l) => /pages:/.test(l)), mentions.join("\n"));
});

test("every curated config exists and opens in the playground", () => {
  for (const { file } of CURATED_CONFIGS) {
    assert.ok(existsSync(join(DOCS, "public", "configs", file)), file);
    assert.ok(safeSrc(`/configs/${file}`), `?src=/configs/${file} is accepted`);
  }
  assert.ok(
    CURATED_CONFIGS.some(({ file }) => YAMLParser.safeParseAny(readFileSync(join(DOCS, "public", "configs", file), "utf8")).blockType === "scrollytelling"),
    "a story map among the curated configs"
  );
});

test("every YAML example in llms.txt and llms-full.txt validates with no warnings", () => {
  const docs = fences(full, "yaml");
  assert.ok(docs.length >= fences(llms, "yaml").length + CURATED_CONFIGS.length);
  for (const text of docs) {
    const { result } = YAMLParser.safeParseAny(text);
    const id = text.match(/^id: (.+)$/m)?.[1];
    assert.ok(result.success, `${id}: ${JSON.stringify(result.errors ?? result.error)}`);
    assert.deepEqual((result.warnings ?? []).map((w) => `${w.path}: ${w.message}`), [], id);
  }
});

test("llms-full.txt prints the map and story schemas, not the deprecated root one", { skip: !haveSchemas && "core schemas not built" }, () => {
  assert.ok(full.includes("----- map.schema.json -----"));
  assert.ok(full.includes("----- scrollytelling.schema.json -----"));
  assert.ok(!full.includes("----- root.schema.json -----"));
});

/** The source file behind a site path, or null. */
function sourceOf(path) {
  const p = path.split(/[?#]/)[0];
  const generated = ["/llms.txt", "/llms-full.txt"];
  if (generated.includes(p) || p.startsWith("/schema/latest/")) return "generated";
  if (p.endsWith("/")) {
    const slug = p.slice(1, -1);
    const candidates = slug
      ? [`src/content/docs/${slug}.mdx`, `src/content/docs/${slug}.md`, `src/content/docs/${slug}/index.mdx`, `src/pages/${slug}.astro`]
      : ["src/content/docs/index.mdx"];
    return candidates.find((c) => existsSync(join(DOCS, c))) ?? null;
  }
  return existsSync(join(DOCS, "public", p)) ? `public${p}` : null;
}

test("every docs-site link in llms.txt and llms-full.txt has a page or file behind it", () => {
  const links = siteLinks(full);
  assert.ok(links.length > 20);
  const missing = links.filter((l) => !sourceOf(l));
  assert.deepEqual(missing, []);
});
