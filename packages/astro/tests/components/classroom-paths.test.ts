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
import Scrollytelling from "../../src/components/Scrollytelling.astro";
import Chapter from "../../src/components/Chapter.astro";

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

const baseAttr = (html: string) => html.match(/<ml-map[^>]*\sbase="([^"]*)"/)?.[1];

describe("paths inside the document under the site's base (ml-aot.30)", () => {
  const config = {
    type: "map",
    id: "m",
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
    layers: [],
  };

  for (const [name, Component] of [
    ["Map", Map],
    ["FullPageMap", FullPageMap],
  ] as const) {
    for (const props of [{ src: "/configs/hero-map.yaml" }, { config }]) {
      const kind = "src" in props ? "src" : "config";
      it(`${name} (${kind}): <ml-map> gets base = BASE_URL`, async () => {
        vi.stubEnv("BASE_URL", "/my-repo");
        const html = await container.renderToString(Component as any, { props });
        expect(baseAttr(html)).toBe("/my-repo");
      });

      it(`${name} (${kind}): the default "/" is passed too, so paths are site-root paths on nested pages`, async () => {
        vi.stubEnv("BASE_URL", "/");
        const html = await container.renderToString(Component as any, { props });
        expect(baseAttr(html)).toBe("/");
      });
    }

    it(`${name}: a base prop overrides BASE_URL, and base={false} leaves it unset`, async () => {
      vi.stubEnv("BASE_URL", "/my-repo/");
      const custom = await container.renderToString(Component as any, {
        props: { config, base: "/other/" },
      });
      expect(baseAttr(custom)).toBe("/other/");
      const off = await container.renderToString(Component as any, { props: { config, base: false } });
      expect(off).toMatch(/<ml-map\b/);
      expect(baseAttr(off)).toBeUndefined();
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

describe("stories under the site's base (ml-aot.1 + ml-aot.30)", () => {
  const story = {
    type: "scrollytelling",
    id: "s",
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
    layers: [],
    chapters: [
      { id: "a", title: "A", image: "/images/hatch-atlas.png", video: "/videos/tutorial.mp4", center: [0, 0], zoom: 3 },
    ],
  };
  const attr = (html: string, tag: string, name: string) =>
    html.match(new RegExp(`<${tag}[^>]*?\\s${name}="([^"]*)"`))?.[1];

  it("Scrollytelling src: the URL gets the base; the element gets base", async () => {
    vi.stubEnv("BASE_URL", "/my-repo");
    const html = await container.renderToString(Scrollytelling as any, {
      props: { src: "/stories/tour.yaml" },
    });
    expect(attr(html, "ml-scrollytelling", "src")).toBe("/my-repo/stories/tour.yaml");
    expect(attr(html, "ml-scrollytelling", "base")).toBe("/my-repo");
  });

  it("Scrollytelling config: chapter media and the story's <ml-map> use the base", async () => {
    vi.stubEnv("BASE_URL", "/my-repo/");
    const html = await container.renderToString(Scrollytelling as any, { props: { config: story } });
    expect(attr(html, "img", "src")).toBe("/my-repo/images/hatch-atlas.png");
    expect(attr(html, "video", "src")).toBe("/my-repo/videos/tutorial.mp4");
    expect(baseAttr(html)).toBe("/my-repo/");
    expect(html).toMatch(/<ml-scrollytelling[^]*?\sbase="\/my-repo\/"/);
  });

  it('Scrollytelling: "/" by default, a base prop overrides, base={false} opts out', async () => {
    vi.stubEnv("BASE_URL", "/");
    expect(baseAttr(await container.renderToString(Scrollytelling as any, { props: { config: story } }))).toBe("/");
    const custom = await container.renderToString(Scrollytelling as any, { props: { config: story, base: "/other/" } });
    expect(attr(custom, "img", "src")).toBe("/other/images/hatch-atlas.png");
    const off = await container.renderToString(Scrollytelling as any, { props: { config: story, base: false } });
    expect(baseAttr(off)).toBeUndefined();
    expect(attr(off, "img", "src")).toBe("/images/hatch-atlas.png");
  });

  it("Chapter media use the base; a standalone Chapter renders active (ml-aot.28)", async () => {
    vi.stubEnv("BASE_URL", "/my-repo");
    const html = await container.renderToString(Chapter as any, {
      props: { id: "c", title: "C", image: "/images/hatch-atlas.png" },
    });
    expect(attr(html, "img", "src")).toBe("/my-repo/images/hatch-atlas.png");
    expect(html).toMatch(/class="scrolly-chapter[^"]*\bis-active\b/);
    const dim = await container.renderToString(Chapter as any, {
      props: { id: "c", title: "C", isActive: false },
    });
    expect(dim).not.toMatch(/\bis-active\b/);
  });
});

describe("view transitions (ml-aot.22)", () => {
  for (const file of ["Map.astro", "FullPageMap.astro", "Scrollytelling.astro"]) {
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
