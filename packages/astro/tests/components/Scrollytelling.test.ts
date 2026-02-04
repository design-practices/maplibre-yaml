/**
 * @file Tests for Scrollytelling component types and integration
 * @module @maplibre-yaml/astro/tests/components/Scrollytelling
 *
 * @description
 * Tests for the Scrollytelling component focusing on:
 * - Type validation for component props
 * - Integration with YAMLParser for config validation
 * - Chapter transitions and camera movements
 * - Layer visibility and actions
 *
 * Note: Cannot directly import .astro components in vitest, so tests focus
 * on type validation and integration with core library functionality.
 */

import { describe, it, expect } from "vitest";
import type { ScrollytellingProps } from "../../src/types";
import { YAMLParser } from "@maplibre-yaml/core";

describe("Scrollytelling Component Types", () => {
  describe("ScrollytellingProps interface", () => {
    it("should accept valid src prop", () => {
      const props: ScrollytellingProps = {
        src: "/stories/earthquake.yaml",
      };
      expect(props.src).toBe("/stories/earthquake.yaml");
    });

    it("should accept valid config prop", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "test-story",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "intro",
              title: "Introduction",
              center: [0, 0],
              zoom: 2,
            },
          ],
        },
      };
      expect(props.config).toBeDefined();
      expect(props.config?.chapters).toHaveLength(1);
    });

    it("should accept optional class prop", () => {
      const props: ScrollytellingProps = {
        src: "/stories/test.yaml",
        class: "custom-scrollytelling",
      };
      expect(props.class).toBe("custom-scrollytelling");
    });

    it("should accept optional debug prop", () => {
      const props: ScrollytellingProps = {
        src: "/stories/test.yaml",
        debug: true,
      };
      expect(props.debug).toBe(true);
    });

    it("should accept all props together", () => {
      const props: ScrollytellingProps = {
        src: "/stories/complete.yaml",
        class: "my-story",
        debug: true,
      };
      expect(props.src).toBeDefined();
      expect(props.class).toBe("my-story");
      expect(props.debug).toBe(true);
    });
  });

  describe("Integration with YAMLParser", () => {
    it("should validate scrollytelling configuration", () => {
      const validConfig = {
        version: "1.0",
        id: "earthquake-story",
        config: {
          style: "https://demotiles.maplibre.org/style.json",
          center: [-118.2437, 34.0522],
          zoom: 10,
        },
        chapters: [
          {
            id: "intro",
            title: "Los Angeles Earthquakes",
            center: [-118.2437, 34.0522],
            zoom: 10,
          },
          {
            id: "detail",
            title: "Major Fault Lines",
            center: [-118.0, 34.0],
            zoom: 12,
          },
        ],
      };

      const props: ScrollytellingProps = {
        config: validConfig,
      };
      expect(props.config).toBeDefined();
      expect(props.config?.chapters).toHaveLength(2);
      expect(props.config?.chapters[0].title).toBe("Los Angeles Earthquakes");
    });

    it("should handle validation errors from YAMLParser", () => {
      const invalidYaml = `version: "1.0"
id: "test"
config:
  style: "https://demotiles.maplibre.org/style.json"
  center: "invalid"
  zoom: "not a number"
chapters:
  - id: "intro"
    title: "Test"
    center: [0, 0]
    zoom: 2`;

      const result = YAMLParser.safeParseScrollytellingBlock(invalidYaml);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Chapter configurations", () => {
    it("should support chapters with camera positions", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "camera-story",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "ch1",
              title: "Chapter 1",
              center: [0, 0],
              zoom: 5,
              pitch: 60,
              bearing: 45,
            },
            {
              id: "ch2",
              title: "Chapter 2",
              center: [10, 10],
              zoom: 8,
              pitch: 0,
              bearing: 0,
            },
          ],
        },
      };

      expect(props.config?.chapters[0].pitch).toBe(60);
      expect(props.config?.chapters[0].bearing).toBe(45);
      expect(props.config?.chapters[1].center).toEqual([10, 10]);
    });

    it("should support chapters with animations", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "animation-story",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "fly",
              title: "Fly Animation",
              center: [0, 0],
              zoom: 5,
              animation: "flyTo",
              speed: 0.8,
              curve: 1.5,
            },
            {
              id: "ease",
              title: "Ease Animation",
              center: [5, 5],
              zoom: 6,
              animation: "easeTo",
            },
            {
              id: "jump",
              title: "Jump Animation",
              center: [10, 10],
              zoom: 7,
              animation: "jumpTo",
            },
          ],
        },
      };

      expect(props.config?.chapters[0].animation).toBe("flyTo");
      expect(props.config?.chapters[0].speed).toBe(0.8);
      expect(props.config?.chapters[0].curve).toBe(1.5);
      expect(props.config?.chapters[1].animation).toBe("easeTo");
      expect(props.config?.chapters[2].animation).toBe("jumpTo");
    });

    it("should support chapters with layer visibility", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "layers-story",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "ch1",
              title: "Show Earthquakes",
              center: [0, 0],
              zoom: 5,
              layers: {
                show: ["earthquakes"],
                hide: ["cities"],
              },
            },
            {
              id: "ch2",
              title: "Show Cities",
              center: [5, 5],
              zoom: 6,
              layers: {
                show: ["cities"],
                hide: ["earthquakes"],
              },
            },
          ],
        },
      };

      expect(props.config?.chapters[0].layers?.show).toContain("earthquakes");
      expect(props.config?.chapters[0].layers?.hide).toContain("cities");
      expect(props.config?.chapters[1].layers?.show).toContain("cities");
    });

    it("should support chapters with actions", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "actions-story",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "filter-chapter",
              title: "Filter Data",
              center: [0, 0],
              zoom: 5,
              onChapterEnter: [
                {
                  action: "setFilter",
                  layer: "earthquakes",
                  filter: [">=", "magnitude", 5.0],
                },
              ],
              onChapterExit: [
                {
                  action: "setFilter",
                  layer: "earthquakes",
                  filter: null,
                },
              ],
            },
          ],
        },
      };

      expect(props.config?.chapters[0].onChapterEnter).toHaveLength(1);
      expect(props.config?.chapters[0].onChapterEnter?.[0].action).toBe(
        "setFilter"
      );
      expect(props.config?.chapters[0].onChapterExit).toHaveLength(1);
    });
  });

  describe("Theme and appearance", () => {
    it("should support light theme", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "light-story",
          theme: "light",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "intro",
              title: "Intro",
              center: [0, 0],
              zoom: 2,
            },
          ],
        },
      };

      expect(props.config?.theme).toBe("light");
    });

    it("should support dark theme", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "dark-story",
          theme: "dark",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "intro",
              title: "Intro",
              center: [0, 0],
              zoom: 2,
            },
          ],
        },
      };

      expect(props.config?.theme).toBe("dark");
    });

    it("should support chapter markers", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "markers-story",
          showMarkers: true,
          markerColor: "#FF0000",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "intro",
              title: "Intro",
              center: [0, 0],
              zoom: 2,
            },
          ],
        },
      };

      expect(props.config?.showMarkers).toBe(true);
      expect(props.config?.markerColor).toBe("#FF0000");
    });

    it("should support footer content", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "footer-story",
          footer: "<p>Created by Data Team</p><p>&copy; 2024</p>",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          chapters: [
            {
              id: "intro",
              title: "Intro",
              center: [0, 0],
              zoom: 2,
            },
          ],
        },
      };

      expect(props.config?.footer).toContain("Data Team");
      expect(props.config?.footer).toContain("&copy; 2024");
    });
  });

  describe("Complete scrollytelling configurations", () => {
    it("should handle multi-chapter story with all features", () => {
      const props: ScrollytellingProps = {
        config: {
          version: "1.0",
          id: "complete-story",
          theme: "dark",
          showMarkers: true,
          markerColor: "#3FB1CE",
          footer: "<p>End of story</p>",
          config: {
            style: "https://demotiles.maplibre.org/style.json",
            center: [0, 0],
            zoom: 2,
          },
          sources: {
            data: {
              type: "geojson",
              data: "https://example.com/data.geojson",
            },
          },
          layers: [
            {
              id: "data-layer",
              type: "circle",
              source: "data",
              paint: {
                "circle-radius": 8,
                "circle-color": "#ff0000",
              },
            },
          ],
          chapters: [
            {
              id: "intro",
              title: "Introduction",
              description: "<p>Welcome to the story</p>",
              center: [0, 0],
              zoom: 2,
              alignment: "center",
            },
            {
              id: "detail",
              title: "Details",
              description: "<p>Here are the details</p>",
              image: "/images/detail.jpg",
              center: [10, 10],
              zoom: 8,
              pitch: 45,
              bearing: 30,
              animation: "flyTo",
              speed: 0.7,
              alignment: "left",
              layers: {
                show: ["data-layer"],
                hide: [],
              },
            },
            {
              id: "conclusion",
              title: "Conclusion",
              description: "<p>Thank you</p>",
              center: [0, 0],
              zoom: 2,
              alignment: "full",
            },
          ],
        },
      };

      expect(props.config?.chapters).toHaveLength(3);
      expect(props.config?.theme).toBe("dark");
      expect(props.config?.showMarkers).toBe(true);
      expect(props.config?.footer).toBeDefined();
      expect(props.config?.sources).toBeDefined();
      expect(props.config?.layers).toHaveLength(1);
    });
  });
});
