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
import { YAMLParser, parseDocumentText } from "@maplibre-yaml/core";
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

/** The lines of the section of llms.txt under a `## ` heading, up to the next one. */
function section(text, heading) {
  const start = text.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `llms.txt has a "${heading}" section`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test("llms.txt says JSON and TOML documents are accepted, and links the guide", () => {
  assert.match(llms, /JSON and TOML documents are accepted/);
  assert.ok(llms.includes("https://docs.maplibre-yaml.org/guides/json-and-toml/"));
});

test("llms.txt's \"Validate loop\" section mentions converting between formats", () => {
  const loop = section(llms, "Validate loop (the whole agent workflow)");
  assert.match(loop, /mlym convert/);
  assert.ok(loop.includes("npx maplibre-yaml@latest convert"), "shows the convert command");
  assert.match(loop, /--strict/);
  // convert's machine-readable output, after (not validate's) -f json.
  assert.match(loop, /mlym convert[\s\S]*`-f json`[\s\S]*losses/, "names convert -f json for machine-readable losses");
});

test("llms.txt's \"Don't write these\" carries the TOML rules", () => {
  const dont = section(llms, "Don't write these");
  // An agent must never write a TOML null, an unquoted dotted key outside
  // locale, or a bare # colour (R23).
  assert.ok(dont.includes("`filter = null`"), "filter = null");
  assert.match(dont, /unquoted dotted key outside `locale`/);
  assert.ok(dont.includes("`circle-color = #e74c3c`"), "bare # colour");
  assert.ok(dont.includes('`circle-color = "#e74c3c"`'), "the quoted fix");
  assert.ok(dont.includes("$html"), "!html as $html");
});

test("llms-full.txt summarises the TOML gaps", () => {
  const start = full.indexOf("# JSON AND TOML DOCUMENTS");
  assert.ok(start >= 0);
  const summary = full.slice(start, full.indexOf("# FULL JSON SCHEMA REFERENCE"));
  for (const gap of ["No null", "No anchors", "No tags", "Dotted bare keys nest", "unquoted date", "[layers.paint]", "[[layers.interactive.click.popup]]", "#:schema", "convert"]) {
    assert.ok(summary.includes(gap), gap);
  }
});

test("the JSON and TOML examples in llms-full.txt validate with no warnings", async () => {
  for (const format of ["json", "toml"]) {
    const docs = fences(full, format).filter((text) => /"type": "map"|^type = "map"/m.test(text));
    assert.equal(docs.length, 1, `one ${format} example`);
    const { result } = await parseDocumentText(docs[0], { format });
    assert.ok(result.success, `${format}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.warnings.map((w) => `${w.path}: ${w.message}`), [], format);
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
