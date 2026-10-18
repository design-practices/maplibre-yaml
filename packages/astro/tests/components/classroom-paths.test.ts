/**
 * @file Map/FullPageMap on a deployed student site: base path and view
 * transitions (ml-aot.21, ml-aot.22)
 *
 * @description
 * Container-API renders with Astro's `BASE_URL` stubbed the way
 * `base: '/my-repo'` (a GitHub Pages project site) sets it, plus source
 * checks on where each component imports MapLibre's CSS and how
 * FullPageMap wires its controls. The browser half -- soft navigations
 * under `<ClientRouter />` in dev and preview -- is the example site's
 * "view transitions" e2e test (examples/astro/site/e2e).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import Map from "../../src/components/Map.astro";
import FullPageMap from "../../src/components/FullPageMap.astro";

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const srcAttr = (html: string) => html.match(/<ml-map[^>]*\ssrc="([^"]*)"/)?.[1];

describe("src under a base path (ml-aot.21)", () => {
  for (const [name, Component] of [
    ["Map", Map],
    ["FullPageMap", FullPageMap],
  ] as const) {
    it(`${name}: a root-relative src gets the site's base`, async () => {
      vi.stubEnv("BASE_URL", "/my-repo");
      const html = await container.renderToString(Component as any, {
        props: { src: "/configs/hero-map.yaml" },
      });
      expect(srcAttr(html)).toBe("/my-repo/configs/hero-map.yaml");
    });

    it(`${name}: a src that already has the base, or is absolute, is left alone`, async () => {
      vi.stubEnv("BASE_URL", "/my-repo/");
      for (const src of [
        "/my-repo/configs/hero-map.yaml",
        "https://example.com/hero-map.yaml",
      ]) {
        const html = await container.renderToString(Component as any, { props: { src } });
        expect(srcAttr(html)).toBe(src);
      }
    });

    it(`${name}: without a base (the default "/") src is unchanged`, async () => {
      vi.stubEnv("BASE_URL", "/");
      const html = await container.renderToString(Component as any, {
        props: { src: "/configs/hero-map.yaml" },
      });
      expect(srcAttr(html)).toBe("/configs/hero-map.yaml");
    });
  }
});

/** A component's source split into frontmatter and its client <script>. */
function parts(file: string): { frontmatter: string; script: string } {
  const source = readFileSync(
    fileURLToPath(new URL(`../../src/components/${file}`, import.meta.url)),
    "utf8"
  );
  // The fences are whole `---` lines (doc-comment examples contain ` * ---`).
  const frontmatter = source.match(/^---$([\s\S]*?)^---$/m)?.[1] ?? "";
  const script = source.match(/^<script>$([\s\S]*?)^<\/script>$/m)?.[1] ?? "";
  expect(script, `${file} has a client <script>`).not.toBe("");
  return { frontmatter, script };
}

describe("view transitions (ml-aot.22)", () => {
  for (const file of ["Map.astro", "FullPageMap.astro"]) {
    it(`${file} imports MapLibre's CSS as page CSS (frontmatter), not from the client script`, () => {
      const { frontmatter, script } = parts(file);
      // From the script, astro dev injects it with JS and <ClientRouter />'s
      // head swap drops it after the first soft navigation.
      expect(frontmatter).toMatch(/^import "maplibre-gl\/dist\/maplibre-gl\.css";$/m);
      expect(script).not.toContain("maplibre-gl.css");
    });
  }

  it("FullPageMap wires its controls by delegation on document, not per element", () => {
    const { script } = parts("FullPageMap.astro");
    // The module runs once per full load; soft navigations swap in new
    // elements without re-running it, so per-element listeners went dead.
    expect(script).toMatch(/document\.addEventListener\("click"/);
    expect(script).toMatch(/document\.addEventListener\("ml-map:load"/);
    expect(script).not.toMatch(/controls\.addEventListener/);
  });
});
