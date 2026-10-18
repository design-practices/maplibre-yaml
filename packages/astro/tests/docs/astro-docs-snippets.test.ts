/**
 * @file The Astro docs' snippets, checked verbatim against the package
 *
 * @description
 * The Astro integration docs drifted from the package without anything
 * noticing. They imported `Chapter` from an entry that doesn't export it (a
 * build failure), and they shipped a "complete" scrollytelling story that
 * failed validation four ways. These tests read the fences straight out of the
 * `.mdx` and the package README at test time, so a renamed export or a schema
 * change fails here rather than in a reader's build.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { YAMLParser } from "@maplibre-yaml/core";
import * as rootEntry from "../../src/index";
import * as utilsEntry from "../../src/utils/index";
import * as componentsEntry from "../../src/components/index";
import Scrollytelling from "../../src/components/Scrollytelling.astro";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const DOCS = [
  "docs/src/content/docs/integrations/astro.mdx",
  "docs/src/content/docs/guides/collections-integration.mdx",
  "packages/astro/README.md",
];

interface Fence {
  file: string;
  lang: string;
  /** The fence's info string after the language, e.g. `title="…"`. */
  meta: string;
  body: string;
}

/** Every fenced block, dedented (fences inside <Steps> are indented). */
function fences(file: string): Fence[] {
  const text = readFileSync(join(REPO, file), "utf8");
  const out: Fence[] = [];
  const re = /^([ \t]*)```(\w*)([^\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
  for (const m of text.matchAll(re)) {
    const indent = m[1].length;
    const body = m[4]
      .split("\n")
      .map((line) => line.slice(Math.min(indent, line.search(/\S|$/))))
      .join("\n");
    out.push({ file, lang: m[2], meta: m[3], body });
  }
  return out;
}

const ALL = DOCS.flatMap(fences);
const ENTRIES: Record<string, Record<string, unknown>> = {
  "@maplibre-yaml/astro": rootEntry,
  "@maplibre-yaml/astro/utils": utilsEntry,
  "@maplibre-yaml/astro/components": componentsEntry,
};

describe("documented imports resolve to real exports", () => {
  const imports: Array<{ file: string; name: string; from: string }> = [];
  const importRe =
    /import\s+(type\s+)?\{([^}]+)\}\s*from\s*["'](@maplibre-yaml\/astro(?:\/utils|\/components)?)["']/g;
  for (const fence of ALL) {
    for (const m of fence.body.matchAll(importRe)) {
      if (m[1]) continue; // `import type { … }` — erased, nothing to resolve
      for (const raw of m[2].split(",")) {
        const spec = raw.trim();
        if (!spec || spec.startsWith("type ")) continue;
        imports.push({ file: fence.file, name: spec.split(/\s+as\s+/)[0], from: m[3] });
      }
    }
  }

  it("finds the snippets it is meant to guard", () => {
    expect(imports.length).toBeGreaterThan(40);
  });

  it.each(imports.map((i) => [`${i.name} from ${i.from} (${i.file})`, i]))(
    "%s",
    (_label, i) => {
      const entry = ENTRIES[(i as (typeof imports)[number]).from];
      expect(Object.keys(entry)).toContain((i as (typeof imports)[number]).name);
    }
  );
});

describe("the documented integration import resolves (ml-aot.24)", () => {
  it("`import maplibreYaml from \"@maplibre-yaml/astro/integration\"` is a real default export", async () => {
    const importRe = /import\s+(\w+)\s+from\s*["']@maplibre-yaml\/astro\/integration["']/;
    const documented = ALL.filter((f) => importRe.test(f.body));
    expect(documented.length).toBeGreaterThan(0);

    const pkg = JSON.parse(readFileSync(join(REPO, "packages/astro/package.json"), "utf8"));
    const target = pkg.exports["./integration"]?.default;
    expect(target, "package.json exports ./integration").toBe("./src/integration.mjs");
    const mod = await import("../../src/integration.mjs");
    expect(typeof mod.default).toBe("function");
    expect(mod.default().name).toBe("@maplibre-yaml/astro");
  });
});

describe("documented YAML documents validate", () => {
  const maps = ALL.filter((f) => f.lang === "yaml" && /^type: map$/m.test(f.body));
  const stories = ALL.filter(
    (f) => f.lang === "yaml" && /^type: scrollytelling$/m.test(f.body)
  );

  it("finds the map and story documents", () => {
    expect(maps.length).toBeGreaterThan(5);
    // The integration page's complete story. (The README used to carry a
    // second one; it is now an orientation that links to the docs instead.)
    expect(stories.length).toBeGreaterThanOrEqual(1);
  });

  it.each(maps.map((f, i) => [`${f.file} map #${i + 1}`, f]))("%s", (_l, f) => {
    const result = YAMLParser.safeParseMapBlock((f as Fence).body);
    expect(result.errors).toEqual([]);
  });

  it.each(stories.map((f, i) => [`${f.file} story #${i + 1}`, f]))(
    "%s parses with no errors and no unknown keys",
    (_l, f) => {
      const result = YAMLParser.safeParseScrollytellingBlock((f as Fence).body);
      expect(result.errors).toEqual([]);
      // An unknown key here is a field the reader expects to work and doesn't
      // (the old story's `sources:` left its layer pointing at nothing).
      expect(
        (result.warnings ?? []).filter((w) => /Unknown key/.test(w.message))
      ).toEqual([]);
    }
  );
});

describe("the documented story renders through <Scrollytelling config>", () => {
  let container: AstroContainer;
  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  it("puts a valid map document on <ml-map>", async () => {
    const story = ALL.find(
      (f) =>
        f.file.endsWith("astro.mdx") &&
        f.lang === "yaml" &&
        /^type: scrollytelling$/m.test(f.body)
    );
    expect(story).toBeDefined();
    const parsed = YAMLParser.safeParseScrollytellingBlock(story!.body);
    expect(parsed.success).toBe(true);

    const html = await container.renderToString(Scrollytelling as any, {
      props: { config: parsed.data },
    });

    // The controller used to wait for a `config` attribute that nothing ever
    // set before it waited; the map must arrive server-rendered.
    const attr = html.match(/<ml-map[^>]*\sconfig="([^"]*)"/);
    expect(attr).not.toBeNull();
    const decoded = attr![1]
      .replace(/&#34;|&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    const mapDoc = YAMLParser.safeParseMapBlockValue(JSON.parse(decoded));
    expect(mapDoc.errors).toEqual([]);
    expect(mapDoc.data?.layers?.map((l: any) => l.id)).toContain(
      "earthquake-circles"
    );

    // Every chapter is in the page, and the engine (core's
    // <ml-scrollytelling>, which this component renders) reads the map
    // through <ml-map>'s real API (`.map` never existed on <ml-map>).
    for (const chapter of parsed.data!.chapters) {
      expect(html).toContain(`data-chapter-id="${chapter.id}"`);
    }
    expect(html).toContain("<ml-scrollytelling");
    const controller = readFileSync(
      join(REPO, "packages/core/src/components/ml-scrollytelling.ts"),
      "utf8"
    );
    expect(controller).toContain("mapReady()");
    expect(controller).not.toMatch(/mapEl\.map\b/);
  });
});

describe("full-page snippets work on a phone (ml-aot.33)", () => {
  // Without <meta name="viewport"> a phone lays the page out ~980px wide and
  // shrinks it: a FullPageMap or story map comes out tiny, its controls and
  // chapter text unreadable. Every complete page the docs show must carry one,
  // and the FullPageMap / Scrollytelling "Basic Usage" snippets — the ones
  // readers copy first — must be complete pages.
  const astroDoc = readFileSync(join(REPO, "docs/src/content/docs/integrations/astro.mdx"), "utf8");
  const pages = ALL.filter((f) => f.lang === "astro" && /<html[\s>]/.test(f.body));

  it("finds the full-page snippets", () => {
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it.each(pages.map((f, i) => [`${f.file} page #${i + 1}`, f]))("%s has a viewport meta", (_l, f) => {
    expect((f as Fence).body).toMatch(/<meta\s+name="viewport"\s+content="width=device-width/);
  });

  /** The astro fences in `### Basic Usage` under the given `## …` section. */
  function basicUsage(section: string): string[] {
    const start = astroDoc.indexOf(`## ${section}`);
    const from = astroDoc.indexOf("### Basic Usage", start);
    const to = astroDoc.indexOf("\n### ", from + 1);
    const slice = astroDoc.slice(from, to);
    return [...slice.matchAll(/```astro[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  }

  it.each([["FullPageMap Component"], ["Scrollytelling Component"]])(
    "%s: Basic Usage is a complete page with a viewport meta and no body margin",
    (section) => {
      const snippets = basicUsage(section).filter((s) => /<(FullPageMap|Scrollytelling)\b/.test(s));
      expect(snippets.length).toBeGreaterThan(0);
      const complete = snippets.filter((s) => /<html[\s>]/.test(s));
      expect(complete.length).toBeGreaterThan(0);
      for (const s of complete) {
        expect(s).toMatch(/<meta\s+name="viewport"/);
        expect(s).toMatch(/margin:\s*0/);
      }
    }
  );
});

describe("snippets titled with an example-site file are copied from it", () => {
  // A fence like ```astro title="examples/astro/site/src/pages/index.astro"
  // claims to come from the example site, which CI builds and drives in a
  // browser on every supported Astro major. Hold it to that: its lines
  // (indentation aside) must appear in the file, contiguously and in order.
  const titled = ALL.map((f) => ({
    ...f,
    source: f.meta.match(/title="(examples\/astro\/site\/[^"]+)"/)?.[1],
  })).filter((f) => f.source);

  it("finds the example-site excerpts", () => {
    expect(titled.length).toBeGreaterThanOrEqual(4);
  });

  it.each(titled.map((f) => [`${f.file}: ${f.source}`, f]))("%s", (_l, f) => {
    const fence = f as (typeof titled)[number];
    const norm = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const excerpt = norm(fence.body);
    const file = norm(readFileSync(join(REPO, fence.source!), "utf8"));
    const at = file.findIndex((_, i) => excerpt.every((line, j) => file[i + j] === line));
    expect(at, `excerpt not found verbatim in ${fence.source}`).toBeGreaterThanOrEqual(0);
  });
});
