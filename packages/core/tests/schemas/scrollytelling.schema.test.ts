/**
 * @file Tests for scrollytelling schemas
 * @module @maplibre-yaml/core/tests/schemas/scrollytelling
 */

import { describe, it, expect } from "vitest";
import {
  ChapterActionSchema,
  ChapterLayersSchema,
  ChapterSchema,
  ScrollytellingBlockSchema,
} from "../../src/schemas/scrollytelling.schema";

describe("ChapterActionSchema", () => {
  it("accepts setFilter action", () => {
    const action = {
      action: "setFilter" as const,
      layer: "earthquakes",
      filter: [">=", ["get", "magnitude"], 5],
    };
    expect(ChapterActionSchema.parse(action)).toMatchObject(action);
  });

  it("accepts setPaintProperty action", () => {
    const action = {
      action: "setPaintProperty" as const,
      layer: "buildings",
      property: "fill-extrusion-height",
      value: ["get", "height"],
    };
    expect(ChapterActionSchema.parse(action)).toMatchObject(action);
  });

  it("accepts setLayoutProperty action", () => {
    const action = {
      action: "setLayoutProperty" as const,
      layer: "labels",
      property: "text-field",
      value: ["get", "name"],
    };
    expect(ChapterActionSchema.parse(action)).toMatchObject(action);
  });

  it("accepts fitBounds action", () => {
    const action = {
      action: "fitBounds" as const,
      bounds: [-74.3, 40.5, -73.7, 40.9],
      options: {
        padding: 50,
        duration: 1000,
      },
    };
    expect(ChapterActionSchema.parse(action)).toMatchObject(action);
  });

  it("accepts custom action", () => {
    const action = {
      action: "custom" as const,
      options: {
        customData: "value",
      },
    };
    expect(ChapterActionSchema.parse(action)).toMatchObject(action);
  });

  it("rejects invalid action type", () => {
    expect(() =>
      ChapterActionSchema.parse({
        action: "invalid",
      })
    ).toThrow();
  });
});

describe("ChapterLayersSchema", () => {
  it("accepts show and hide arrays", () => {
    const layers = {
      show: ["earthquakes", "fault-lines"],
      hide: ["buildings"],
    };
    expect(ChapterLayersSchema.parse(layers)).toMatchObject(layers);
  });

  it("applies default empty arrays", () => {
    const result = ChapterLayersSchema.parse({});
    expect(result.show).toEqual([]);
    expect(result.hide).toEqual([]);
  });

  it("accepts only show", () => {
    const layers = {
      show: ["layer1", "layer2"],
    };
    const result = ChapterLayersSchema.parse(layers);
    expect(result.show).toEqual(["layer1", "layer2"]);
    expect(result.hide).toEqual([]);
  });

  it("accepts only hide", () => {
    const layers = {
      hide: ["layer1"],
    };
    const result = ChapterLayersSchema.parse(layers);
    expect(result.show).toEqual([]);
    expect(result.hide).toEqual(["layer1"]);
  });
});

describe("ChapterSchema", () => {
  describe("required fields", () => {
    it("accepts minimal chapter", () => {
      const chapter = {
        id: "intro",
        title: "Introduction",
        center: [-74.006, 40.7128] as [number, number],
        zoom: 12,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("requires id", () => {
      expect(() =>
        ChapterSchema.parse({
          title: "Test",
          center: [0, 0],
          zoom: 12,
        })
      ).toThrow();
    });

    it("requires title", () => {
      expect(() =>
        ChapterSchema.parse({
          id: "test",
          center: [0, 0],
          zoom: 12,
        })
      ).toThrow();
    });

    it("requires center", () => {
      expect(() =>
        ChapterSchema.parse({
          id: "test",
          title: "Test",
          zoom: 12,
        })
      ).toThrow();
    });

    it("requires zoom", () => {
      expect(() =>
        ChapterSchema.parse({
          id: "test",
          title: "Test",
          center: [0, 0],
        })
      ).toThrow();
    });
  });

  describe("defaults", () => {
    it("applies default pitch and bearing", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      const result = ChapterSchema.parse(chapter);
      expect(result.pitch).toBe(0);
      expect(result.bearing).toBe(0);
    });

    it("applies default animation settings", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      const result = ChapterSchema.parse(chapter);
      expect(result.speed).toBe(0.6);
      expect(result.curve).toBe(1);
      expect(result.animation).toBe("flyTo");
    });

    it("applies default alignment and hidden", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      const result = ChapterSchema.parse(chapter);
      expect(result.alignment).toBe("center");
      expect(result.hidden).toBe(false);
    });

    it("applies default empty action arrays", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      const result = ChapterSchema.parse(chapter);
      expect(result.onChapterEnter).toEqual([]);
      expect(result.onChapterExit).toEqual([]);
    });
  });

  describe("content", () => {
    it("accepts description", () => {
      const chapter = {
        id: "test",
        title: "Test",
        description: "This is a test chapter.",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("accepts image", () => {
      const chapter = {
        id: "test",
        title: "Test",
        image: "https://example.com/image.jpg",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("accepts video", () => {
      const chapter = {
        id: "test",
        title: "Test",
        video: "https://example.com/video.mp4",
        center: [0, 0] as [number, number],
        zoom: 12,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });
  });

  describe("camera settings", () => {
    it("accepts 3D view with pitch and bearing", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        pitch: 60,
        bearing: 30,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("accepts custom animation settings", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        speed: 1.5,
        curve: 1.5,
        animation: "easeTo" as const,
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("rejects pitch out of range", () => {
      expect(() =>
        ChapterSchema.parse({
          id: "test",
          title: "Test",
          center: [0, 0],
          zoom: 12,
          pitch: 90,
        })
      ).toThrow();
    });

    it("rejects bearing out of range", () => {
      expect(() =>
        ChapterSchema.parse({
          id: "test",
          title: "Test",
          center: [0, 0],
          zoom: 12,
          bearing: 200,
        })
      ).toThrow();
    });
  });

  describe("layout", () => {
    it("accepts all alignment options", () => {
      const alignments = ["left", "right", "center", "full"] as const;
      alignments.forEach((alignment) => {
        const chapter = {
          id: "test",
          title: "Test",
          center: [0, 0] as [number, number],
          zoom: 12,
          alignment,
        };
        expect(ChapterSchema.parse(chapter).alignment).toBe(alignment);
      });
    });

    it("accepts hidden flag", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        hidden: true,
      };
      expect(ChapterSchema.parse(chapter).hidden).toBe(true);
    });
  });

  describe("layers", () => {
    it("accepts layer visibility config", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        layers: {
          show: ["layer1", "layer2"],
          hide: ["layer3"],
        },
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });
  });

  describe("actions", () => {
    it("accepts onChapterEnter actions", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        onChapterEnter: [
          {
            action: "setFilter" as const,
            layer: "earthquakes",
            filter: [">=", ["get", "magnitude"], 5],
          },
        ],
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("accepts onChapterExit actions", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        onChapterExit: [
          {
            action: "setFilter" as const,
            layer: "earthquakes",
            filter: null,
          },
        ],
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });

    it("accepts multiple actions", () => {
      const chapter = {
        id: "test",
        title: "Test",
        center: [0, 0] as [number, number],
        zoom: 12,
        onChapterEnter: [
          {
            action: "setFilter" as const,
            layer: "layer1",
            filter: ["==", ["get", "type"], "A"],
          },
          {
            action: "setPaintProperty" as const,
            layer: "layer2",
            property: "fill-color",
            value: "#ff0000",
          },
        ],
      };
      expect(ChapterSchema.parse(chapter)).toMatchObject(chapter);
    });
  });
});

describe("ScrollytellingBlockSchema", () => {
  describe("minimal scrollytelling", () => {
    it("accepts basic scrollytelling block", () => {
      const block = {
        type: "scrollytelling" as const,
        id: "story",
        config: {
          center: [0, 0] as [number, number],
          zoom: 2,
          mapStyle: "https://demotiles.maplibre.org/style.json",
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
      expect(ScrollytellingBlockSchema.parse(block)).toMatchObject(block);
    });

    it("requires at least one chapter", () => {
      expect(() =>
        ScrollytellingBlockSchema.parse({
          type: "scrollytelling",
          id: "story",
          config: {
            center: [0, 0],
            zoom: 2,
            mapStyle: "https://example.com/style.json",
          },
          chapters: [],
        })
      ).toThrow(/At least one chapter is required/);
    });

    it("applies default theme", () => {
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
      const result = ScrollytellingBlockSchema.parse(block);
      expect(result.theme).toBe("light");
      expect(result.showMarkers).toBe(false);
      expect(result.markerColor).toBe("#3FB1CE");
    });
  });

  describe("theme options", () => {
    it("accepts dark theme", () => {
      const block = {
        type: "scrollytelling" as const,
        id: "story",
        theme: "dark" as const,
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
      expect(ScrollytellingBlockSchema.parse(block).theme).toBe("dark");
    });

    it("accepts marker configuration", () => {
      const block = {
        type: "scrollytelling" as const,
        id: "story",
        showMarkers: true,
        markerColor: "#ff0000",
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
      const result = ScrollytellingBlockSchema.parse(block);
      expect(result.showMarkers).toBe(true);
      expect(result.markerColor).toBe("#ff0000");
    });
  });

  describe("layers", () => {
    it("accepts persistent layers", () => {
      const block = {
        type: "scrollytelling" as const,
        id: "story",
        config: {
          center: [0, 0] as [number, number],
          zoom: 2,
          mapStyle: "https://example.com/style.json",
        },
        layers: [
          {
            id: "base-layer",
            type: "circle" as const,
            source: {
              type: "geojson" as const,
              data: { type: "FeatureCollection", features: [] },
            },
            paint: {
              "circle-radius": 6,
              "circle-color": "#888888",
            },
          },
        ],
        chapters: [
          {
            id: "chapter1",
            title: "Chapter 1",
            center: [0, 0] as [number, number],
            zoom: 3,
          },
        ],
      };
      expect(ScrollytellingBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts layer references", () => {
      const block = {
        type: "scrollytelling" as const,
        id: "story",
        config: {
          center: [0, 0] as [number, number],
          zoom: 2,
          mapStyle: "https://example.com/style.json",
        },
        layers: [{ $ref: "#/layers/sharedLayer" }],
        chapters: [
          {
            id: "chapter1",
            title: "Chapter 1",
            center: [0, 0] as [number, number],
            zoom: 3,
          },
        ],
      };
      expect(ScrollytellingBlockSchema.parse(block)).toMatchObject(block);
    });

    it("applies default empty layers array", () => {
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
      const result = ScrollytellingBlockSchema.parse(block);
      expect(result.layers).toEqual([]);
    });
  });

  describe("multiple chapters", () => {
    it("accepts multiple chapters", () => {
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
          {
            id: "chapter2",
            title: "Chapter 2",
            center: [10, 10] as [number, number],
            zoom: 5,
          },
          {
            id: "chapter3",
            title: "Chapter 3",
            center: [-10, -10] as [number, number],
            zoom: 7,
          },
        ],
      };
      expect(ScrollytellingBlockSchema.parse(block)).toMatchObject(block);
    });
  });

  describe("footer", () => {
    it("accepts footer content", () => {
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
        footer: "<p>Data sources: ...</p>",
      };
      expect(ScrollytellingBlockSchema.parse(block)).toMatchObject(block);
    });
  });

  describe("validation", () => {
    it('requires type to be "scrollytelling"', () => {
      expect(() =>
        ScrollytellingBlockSchema.parse({
          type: "invalid",
          id: "story",
          config: {
            center: [0, 0],
            zoom: 2,
            mapStyle: "https://example.com/style.json",
          },
          chapters: [
            {
              id: "chapter1",
              title: "Chapter 1",
              center: [0, 0],
              zoom: 3,
            },
          ],
        })
      ).toThrow();
    });

    it("requires id", () => {
      expect(() =>
        ScrollytellingBlockSchema.parse({
          type: "scrollytelling",
          config: {
            center: [0, 0],
            zoom: 2,
            mapStyle: "https://example.com/style.json",
          },
          chapters: [
            {
              id: "chapter1",
              title: "Chapter 1",
              center: [0, 0],
              zoom: 3,
            },
          ],
        })
      ).toThrow();
    });

    it("requires config", () => {
      expect(() =>
        ScrollytellingBlockSchema.parse({
          type: "scrollytelling",
          id: "story",
          chapters: [
            {
              id: "chapter1",
              title: "Chapter 1",
              center: [0, 0],
              zoom: 3,
            },
          ],
        })
      ).toThrow();
    });
  });
});
