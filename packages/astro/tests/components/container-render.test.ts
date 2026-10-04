/**
 * @file Container-API behavioral render tests (ml-qxt)
 * @module @maplibre-yaml/astro/tests/components/container-render
 *
 * @description
 * The other component suites validate prop TYPES; nothing rendered an actual
 * component until this file. Astro's (experimental) Container API renders
 * each `.astro` component server-side against the CURRENT workspace core —
 * exactly the pairing a release ships — so a core change that breaks a
 * component's contract fails here instead of in a consumer's build.
 * (Enabled by routing vitest through `getViteConfig`; see vitest.config.ts.)
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import Map from "../../src/components/Map.astro";
import FullPageMap from "../../src/components/FullPageMap.astro";
import Scrollytelling from "../../src/components/Scrollytelling.astro";
import Chapter from "../../src/components/Chapter.astro";
import { buildPolygonMapConfig } from "../../src/utils/map-builders";

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const MAP_CONFIG = {
  type: "map",
  id: "test-map",
  config: {
    center: [0, 0] as [number, number],
    zoom: 2,
    mapStyle: "https://demotiles.maplibre.org/style.json",
  },
  layers: [
    {
      id: "pts",
      type: "circle",
      source: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
      paint: { "circle-radius": 5 },
    },
  ],
};

describe("Map", () => {
  it("renders an <ml-map> carrying the serialized config", async () => {
    const html = await container.renderToString(Map as any, {
      props: { config: MAP_CONFIG, height: "512px" },
    });

    expect(html).toContain("<ml-map");
    // The config attribute carries the whole document (attribute-escaped).
    expect(html).toContain("test-map");
    expect(html).toContain("circle-radius");
    // Height prop lands on the container element.
    expect(html).toContain("height: 512px");
  });

  it("renders the runtime-src variant with data-src and the loader script", async () => {
    const html = await container.renderToString(Map as any, {
      props: { src: "/configs/demo.yaml" },
    });

    expect(html).toContain('data-src="/configs/demo.yaml"');
    // The inline loader script is the runtime path's engine.
    expect(html).toContain("<script");
  });

  it("throws without either src or config", async () => {
    await expect(
      container.renderToString(Map as any, { props: {} })
    ).rejects.toThrow(/requires either 'src' or 'config'/);
  });
});

describe("FullPageMap", () => {
  /** The document the <ml-map config> attribute carries (entity-decoded). */
  function configAttr(html: string): any {
    const m = html.match(/<ml-map[^>]*\sconfig="([^"]*)"/);
    expect(m, "ml-map carries a config attribute").toBeTruthy();
    const json = m![1]
      .replace(/&#34;|&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    return JSON.parse(json);
  }

  it("puts the zoom/reset controls in <ml-map>'s top-right slot (U9)", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: { config: MAP_CONFIG },
    });

    // The controls are a slot child OF the element, not a sibling overlay —
    // the element's corner system places them.
    const inner = html.slice(html.indexOf("<ml-map"), html.indexOf("</ml-map>"));
    expect(inner).toContain('slot="top-right"');
    for (const action of ["zoom-in", "zoom-out", "reset"]) {
      expect(inner).toContain(`data-action="${action}"`);
    }
    // The dead pre-0.7 wiring (a `.map` read the element never had) is gone.
    expect(html).not.toContain("mapElement.map");
  });

  it("showControls={false} renders no controls slot", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: { config: MAP_CONFIG, showControls: false },
    });
    expect(html).not.toContain('slot="top-right"');
  });

  it("showLegend with no legend entries warns at build time (no empty box)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await container.renderToString(FullPageMap as any, { props: { config: MAP_CONFIG, showLegend: true } });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("no layer declares `legend:`"))).toBe(true);
    warn.mockClear();

    const withEntries = {
      ...MAP_CONFIG,
      layers: [{ ...MAP_CONFIG.layers[0], legend: { label: "Points", color: "#f00" } }],
    };
    await container.renderToString(FullPageMap as any, { props: { config: withEntries, showLegend: true } });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("no layer declares"))).toBe(false);
    warn.mockRestore();
  });

  it("showLegend adds core's legend at legendPosition when the document has none", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: { config: MAP_CONFIG, showLegend: true, legendPosition: "bottom-left" },
    });
    expect(configAttr(html).legend).toEqual({ position: "bottom-left" });
  });

  it("an authored legend wins over showLegend's default", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: {
        config: { ...MAP_CONFIG, legend: { position: "top-left", title: "Mine" } },
        showLegend: true,
      },
    });
    expect(configAttr(html).legend).toEqual({ position: "top-left", title: "Mine" });
  });

  it("showLegend targets runtime.legend on a format-v2 document", async () => {
    const v2 = { version: 2, type: "map", id: "v2", style: {}, runtime: {} };
    const html = await container.renderToString(FullPageMap as any, {
      props: { config: v2, showLegend: true },
    });
    const doc = configAttr(html);
    expect(doc.runtime.legend).toEqual({ position: "top-right" });
    expect(doc.legend).toBeUndefined();
  });

  it("the src variant hands the URL to <ml-map> itself", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: { src: "/configs/demo.yaml" },
    });
    expect(html).toMatch(/<ml-map[^>]*\ssrc="\/configs\/demo.yaml"/);
    expect(html).not.toContain("data-src=");
  });
});

describe("Scrollytelling", () => {
  const SCROLLY_CONFIG = {
    type: "scrollytelling",
    id: "story",
    config: {
      center: [0, 0] as [number, number],
      zoom: 2,
      mapStyle: "https://demotiles.maplibre.org/style.json",
    },
    theme: "light",
    showMarkers: true,
    markerColor: "#ff0000",
    layers: [],
    chapters: [
      { id: "c1", title: "First stop", center: [0, 0], zoom: 3 },
      { id: "c2", title: "Second stop", center: [10, 10], zoom: 4 },
    ],
    footer: "<p>The end</p>",
  };

  it("server-renders every chapter, the marker rail, and the raw-HTML footer", async () => {
    const html = await container.renderToString(Scrollytelling as any, {
      props: { config: SCROLLY_CONFIG },
    });

    expect(html).toContain("First stop");
    expect(html).toContain("Second stop");
    expect(html).toContain("chapter-markers");
    // footer is injected via set:html — the markup must arrive unescaped.
    expect(html).toContain("<p>The end</p>");
  });
});

describe("Chapter", () => {
  it("renders title and raw-HTML description", async () => {
    const html = await container.renderToString(Chapter as any, {
      props: {
        id: "solo",
        title: "A chapter",
        description: "<em>styled body</em>",
      },
    });

    expect(html).toContain("A chapter");
    expect(html).toContain("<em>styled body</em>");
  });
});

describe("builder output renders (regression: ml-qxt smoke find)", () => {
  it("buildPolygonMapConfig renders with an inline outline source, no bare-name ref", async () => {
    const config = buildPolygonMapConfig({
      region: {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      mapStyle: "https://demotiles.maplibre.org/style.json",
    } as any);

    // Structural: the outline layer must carry its own source object — the
    // old bare-name reference ("region-fill", a LAYER id) resolved against
    // nothing and the outline never rendered.
    const outline: any = (config as any).layers.find(
      (l: any) => l.id === "region-outline"
    );
    expect(outline).toBeDefined();
    expect(typeof outline.source).toBe("object");
    expect(outline.source.type).toBe("geojson");

    // Behavioral: the built config round-trips through the Map component.
    const html = await container.renderToString(Map as any, {
      props: { config },
    });
    expect(html).toContain("region-outline");
    expect(html).not.toContain("&quot;source&quot;:&quot;region-fill&quot;");
  });
});
