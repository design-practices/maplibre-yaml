/**
 * @file Tests for page schemas
 * @module @maplibre-yaml/core/tests/schemas/page
 */

import { describe, it, expect } from "vitest";
import {
  MixedBlockSchema,
  BlockSchema,
  PageSchema,
  GlobalConfigSchema,
  RootSchema,
} from "../../src/schemas/page.schema";

describe("MixedBlockSchema", () => {
  it("accepts basic mixed block", () => {
    const block = {
      type: "mixed" as const,
      blocks: [
        {
          type: "content" as const,
          content: [{ h1: [{ str: "Title" }] }],
        },
      ],
    };
    const result = MixedBlockSchema.parse(block);
    expect(result.type).toBe("mixed");
    expect(result.layout).toBe("row"); // default
  });

  it("accepts all layout types", () => {
    const layouts = ["row", "column", "grid"] as const;
    layouts.forEach((layout) => {
      const block = {
        type: "mixed" as const,
        layout,
        blocks: [],
      };
      expect(MixedBlockSchema.parse(block).layout).toBe(layout);
    });
  });

  it("accepts styling", () => {
    const block = {
      type: "mixed" as const,
      id: "container",
      className: "flex-container",
      style: "gap: 20px;",
      blocks: [],
    };
    expect(MixedBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts gap property", () => {
    const block = {
      type: "mixed" as const,
      gap: "20px",
      blocks: [],
    };
    expect(MixedBlockSchema.parse(block).gap).toBe("20px");
  });

  it("accepts nested blocks", () => {
    const block = {
      type: "mixed" as const,
      layout: "row" as const,
      blocks: [
        {
          type: "content" as const,
          content: [{ p: [{ str: "Left" }] }],
        },
        {
          type: "map" as const,
          id: "map1",
          config: {
            center: [0, 0] as [number, number],
            zoom: 2,
            mapStyle: "https://example.com/style.json",
          },
        },
      ],
    };
    expect(MixedBlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts recursive nested mixed blocks", () => {
    const block = {
      type: "mixed" as const,
      layout: "column" as const,
      blocks: [
        {
          type: "content" as const,
          content: [{ h1: [{ str: "Header" }] }],
        },
        {
          type: "mixed" as const,
          layout: "row" as const,
          blocks: [
            {
              type: "map" as const,
              id: "left-map",
              config: {
                center: [0, 0] as [number, number],
                zoom: 2,
                mapStyle: "https://example.com/style.json",
              },
            },
            {
              type: "map" as const,
              id: "right-map",
              config: {
                center: [0, 0] as [number, number],
                zoom: 2,
                mapStyle: "https://example.com/style.json",
              },
            },
          ],
        },
      ],
    };
    expect(MixedBlockSchema.parse(block)).toMatchObject(block);
  });
});

describe("BlockSchema", () => {
  it("accepts content block", () => {
    const block = {
      type: "content" as const,
      content: [{ h1: [{ str: "Title" }] }],
    };
    expect(BlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map block", () => {
    const block = {
      type: "map" as const,
      id: "map",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
    };
    expect(BlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts map-fullpage block", () => {
    const block = {
      type: "map-fullpage" as const,
      id: "fullpage",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
    };
    expect(BlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts scrollytelling block", () => {
    const block = {
      type: "scrollytelling" as const,
      id: "story",
      config: {
        center: [0, 0] as [number, number],
        zoom: 2,
        mapStyle: "https://example.com/style.json",
      },
      chapters: [
        {
          id: "chapter1",
          title: "Chapter 1",
          center: [0, 0] as [number, number],
          zoom: 3,
        },
      ],
    };
    expect(BlockSchema.parse(block)).toMatchObject(block);
  });

  it("accepts mixed block", () => {
    const block = {
      type: "mixed" as const,
      blocks: [],
    };
    expect(BlockSchema.parse(block)).toMatchObject(block);
  });

  it("rejects invalid block type", () => {
    expect(() =>
      BlockSchema.parse({
        type: "invalid",
      })
    ).toThrow();
  });
});

describe("PageSchema", () => {
  it("accepts minimal page", () => {
    const page = {
      path: "/",
      title: "Home",
      blocks: [
        {
          type: "content" as const,
          content: [{ h1: [{ str: "Welcome" }] }],
        },
      ],
    };
    expect(PageSchema.parse(page)).toMatchObject(page);
  });

  it("accepts page with description", () => {
    const page = {
      path: "/about",
      title: "About",
      description: "About our application",
      blocks: [],
    };
    expect(PageSchema.parse(page)).toMatchObject(page);
  });

  it("accepts various path formats", () => {
    const paths = ["/", "/map", "/about", "/story/chapter1"];
    paths.forEach((path) => {
      const page = {
        path,
        title: "Test",
        blocks: [],
      };
      expect(PageSchema.parse(page).path).toBe(path);
    });
  });

  it("accepts page with multiple blocks", () => {
    const page = {
      path: "/",
      title: "Dashboard",
      blocks: [
        {
          type: "content" as const,
          content: [{ h1: [{ str: "Dashboard" }] }],
        },
        {
          type: "map" as const,
          id: "map1",
          config: {
            center: [0, 0] as [number, number],
            zoom: 2,
            mapStyle: "https://example.com/style.json",
          },
        },
        {
          type: "content" as const,
          content: [{ p: [{ str: "Footer" }] }],
        },
      ],
    };
    expect(PageSchema.parse(page)).toMatchObject(page);
  });

  it("requires path", () => {
    expect(() =>
      PageSchema.parse({
        title: "Test",
        blocks: [],
      })
    ).toThrow();
  });

  it("requires title", () => {
    expect(() =>
      PageSchema.parse({
        path: "/",
        blocks: [],
      })
    ).toThrow();
  });

  it("requires blocks", () => {
    expect(() =>
      PageSchema.parse({
        path: "/",
        title: "Test",
      })
    ).toThrow();
  });
});

describe("GlobalConfigSchema", () => {
  it("accepts minimal config", () => {
    const config = {};
    const result = GlobalConfigSchema.parse(config);
    expect(result.theme).toBe("light");
  });

  it("accepts full config", () => {
    const config = {
      title: "My App",
      description: "My mapping app",
      defaultMapStyle: "https://example.com/style.json",
      theme: "dark" as const,
    };
    expect(GlobalConfigSchema.parse(config)).toMatchObject(config);
  });

  it("accepts data fetching config", () => {
    const config = {
      dataFetching: {
        defaultStrategy: "build" as const,
        timeout: 15000,
        retryAttempts: 5,
      },
    };
    expect(GlobalConfigSchema.parse(config)).toMatchObject(config);
  });

  it("applies defaults to data fetching", () => {
    const config = {
      dataFetching: {},
    };
    const result = GlobalConfigSchema.parse(config);
    expect(result.dataFetching?.defaultStrategy).toBe("runtime");
    expect(result.dataFetching?.timeout).toBe(30000);
    expect(result.dataFetching?.retryAttempts).toBe(3);
  });

  it("accepts both themes", () => {
    expect(GlobalConfigSchema.parse({ theme: "light" }).theme).toBe("light");
    expect(GlobalConfigSchema.parse({ theme: "dark" }).theme).toBe("dark");
  });

  it("accepts defaultZoom", () => {
    const config = { defaultZoom: 10 };
    expect(GlobalConfigSchema.parse(config).defaultZoom).toBe(10);
  });

  it("accepts defaultCenter", () => {
    const config = { defaultCenter: [-74.006, 40.7128] };
    expect(GlobalConfigSchema.parse(config).defaultCenter).toEqual([
      -74.006, 40.7128,
    ]);
  });

  it("rejects defaultZoom out of range", () => {
    expect(() => GlobalConfigSchema.parse({ defaultZoom: -1 })).toThrow();
    expect(() => GlobalConfigSchema.parse({ defaultZoom: 25 })).toThrow();
  });

  it("accepts defaultZoom at boundaries", () => {
    expect(GlobalConfigSchema.parse({ defaultZoom: 0 }).defaultZoom).toBe(0);
    expect(GlobalConfigSchema.parse({ defaultZoom: 24 }).defaultZoom).toBe(24);
  });

  it("accepts full config with new fields", () => {
    const config = {
      title: "My App",
      defaultMapStyle: "https://example.com/style.json",
      theme: "dark" as const,
      defaultZoom: 12,
      defaultCenter: [-74.006, 40.7128],
    };
    const result = GlobalConfigSchema.parse(config);
    expect(result.defaultZoom).toBe(12);
    expect(result.defaultCenter).toEqual([-74.006, 40.7128]);
  });
});

describe("RootSchema", () => {
  describe("minimal configuration", () => {
    it("accepts minimal root config", () => {
      const root = {
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [
              {
                type: "content" as const,
                content: [{ h1: [{ str: "Welcome" }] }],
              },
            ],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });

    it("requires at least one page", () => {
      expect(() =>
        RootSchema.parse({
          pages: [],
        })
      ).toThrow(/At least one page is required/);
    });
  });

  describe("with global config", () => {
    it("accepts global config", () => {
      const root = {
        config: {
          title: "My App",
          defaultMapStyle: "https://example.com/style.json",
        },
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });
  });

  describe("with global layers", () => {
    it("accepts global layers", () => {
      const root = {
        layers: {
          bikeLayer: {
            id: "bikes",
            type: "line" as const,
            source: {
              type: "geojson" as const,
              url: "https://example.com/bikes.geojson",
            },
            paint: {
              "line-color": "#00ff00",
              "line-width": 2,
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });

    it("accepts multiple global layers", () => {
      const root = {
        layers: {
          layer1: {
            id: "layer1",
            type: "circle" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection", features: [] },
            },
          },
          layer2: {
            id: "layer2",
            type: "line" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection", features: [] },
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });
  });

  describe("with global sources", () => {
    it("accepts global sources", () => {
      const root = {
        sources: {
          earthquakeSource: {
            type: "geojson" as const,
            url: "https://earthquake.usgs.gov/feed.geojson",
            refreshInterval: 60000,
          },
        },
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });
  });

  describe("complete configuration", () => {
    it("accepts complete root config with all features", () => {
      const root = {
        config: {
          title: "Complete App",
          description: "Full featured app",
          defaultMapStyle: "https://example.com/style.json",
          theme: "dark" as const,
        },
        sources: {
          dataSource: {
            type: "geojson" as const,
            url: "https://example.com/data.geojson",
          },
        },
        layers: {
          dataLayer: {
            id: "data",
            type: "circle" as const,
            source: "dataSource",
            paint: {
              "circle-radius": 8,
              "circle-color": "#ff0000",
            },
          },
        },
        pages: [
          {
            path: "/",
            title: "Home",
            description: "Home page",
            blocks: [
              {
                type: "content" as const,
                content: [{ h1: [{ str: "Welcome" }] }],
              },
            ],
          },
          {
            path: "/map",
            title: "Map",
            blocks: [
              {
                type: "map" as const,
                id: "main-map",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
                layers: [{ $ref: "#/layers/dataLayer" }],
              },
            ],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });
  });

  describe("multi-page application", () => {
    it("accepts multiple pages", () => {
      const root = {
        pages: [
          {
            path: "/",
            title: "Home",
            blocks: [
              {
                type: "content" as const,
                content: [{ h1: [{ str: "Home" }] }],
              },
            ],
          },
          {
            path: "/about",
            title: "About",
            blocks: [
              {
                type: "content" as const,
                content: [{ h1: [{ str: "About" }] }],
              },
            ],
          },
          {
            path: "/map",
            title: "Map",
            blocks: [
              {
                type: "map" as const,
                id: "map",
                config: {
                  center: [0, 0] as [number, number],
                  zoom: 2,
                  mapStyle: "https://example.com/style.json",
                },
              },
            ],
          },
        ],
      };
      expect(RootSchema.parse(root)).toMatchObject(root);
    });
  });
});
