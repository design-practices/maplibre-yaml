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
  body: string;
}

/** Every fenced block, dedented (fences inside <Steps> are indented). */
function fences(file: string): Fence[] {
  const text = readFileSync(join(REPO, file), "utf8");
  const out: Fence[] = [];
  const re = /^([ \t]*)```(\w*)[^\n]*\n([\s\S]*?)^\1```[ \t]*$/gm;
  for (const m of text.matchAll(re)) {
    const indent = m[1].length;
    const body = m[3]
      .split("\n")
      .map((line) => line.slice(Math.min(indent, line.search(/\S|$/))))
      .join("\n");
    out.push({ file, lang: m[2], body });
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

describe("documented YAML documents validate", () => {
  const maps = ALL.filter((f) => f.lang === "yaml" && /^type: map$/m.test(f.body));
  const stories = ALL.filter(
    (f) => f.lang === "yaml" && /^type: scrollytelling$/m.test(f.body)
  );

  it("finds the map and story documents", () => {
    expect(maps.length).toBeGreaterThan(5);
    expect(stories.length).toBeGreaterThanOrEqual(2);
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

    // Every chapter is in the page, and the controller reads the map through
    // the element's real API (`.map` never existed on <ml-map>).
    for (const chapter of parsed.data!.chapters) {
      expect(html).toContain(`data-chapter-id="${chapter.id}"`);
    }
    expect(html).toContain("mapReady()");
    expect(html).not.toMatch(/mapEl\.map\b/);
  });
});
