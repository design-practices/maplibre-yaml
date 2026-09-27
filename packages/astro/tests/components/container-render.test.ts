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

import { describe, it, expect, beforeAll } from "vitest";
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
  it("renders the map plus its chrome ids", async () => {
    const html = await container.renderToString(FullPageMap as any, {
      props: { config: MAP_CONFIG, showLegend: true },
    });

    expect(html).toContain("<ml-map");
    expect(html).toContain("controls-");
    expect(html).toContain("legend-");
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
