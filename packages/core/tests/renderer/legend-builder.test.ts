import { describe, it, expect, beforeEach, vi } from "vitest";
import { LegendBuilder } from "../../src/renderer/legend-builder";

describe("LegendBuilder", () => {
  let builder: LegendBuilder;
  let container: HTMLElement;

  beforeEach(() => {
    builder = new LegendBuilder();
    container = document.createElement("div");
    container.id = "legend-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("build", () => {
    it("builds legend with explicit items", () => {
      const layers: any[] = [];
      const config = {
        items: [
          { shape: "circle" as const, color: "#ff0000", label: "Red Points" },
          { shape: "square" as const, color: "#00ff00", label: "Green Areas" },
        ],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("Red Points");
      expect(container.innerHTML).toContain("Green Areas");
      expect(container.innerHTML).toContain("#ff0000");
      expect(container.innerHTML).toContain("#00ff00");
    });

    it("extracts legend items from layers", () => {
      const layers = [
        {
          id: "layer1",
          type: "circle" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
          legend: {
            shape: "circle" as const,
            color: "#ff0000",
            label: "Layer 1",
          },
        },
        {
          id: "layer2",
          type: "fill" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
          legend: {
            shape: "square" as const,
            color: "#00ff00",
            label: "Layer 2",
          },
        },
      ];

      builder.build(container, layers as any);

      expect(container.innerHTML).toContain("Layer 1");
      expect(container.innerHTML).toContain("Layer 2");
    });

    it("adds title when provided", () => {
      const layers: any[] = [];
      const config = {
        title: "Map Legend",
        items: [{ shape: "circle" as const, color: "#ff0000", label: "Test" }],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("Map Legend");
      expect(container.innerHTML).toContain("legend-title");
    });

    it("starts open by default, as a toggleable <details>", () => {
      builder.build(container, [], {
        title: "Map Legend",
        items: [{ shape: "circle" as const, color: "#ff0000", label: "T" }],
      });

      const details = container.querySelector("details.maplibre-legend");
      expect(details).not.toBeNull();
      expect(details!.hasAttribute("open")).toBe(true);
      expect(container.querySelector("summary.legend-title")!.textContent).toBe(
        "Map Legend"
      );
    });

    it("collapsed: true starts closed (the field previously did nothing — ml-tfd.8)", () => {
      builder.build(container, [], {
        collapsed: true,
        items: [{ shape: "circle" as const, color: "#ff0000", label: "T" }],
      });

      const details = container.querySelector("details.maplibre-legend");
      expect(details).not.toBeNull();
      expect(details!.hasAttribute("open")).toBe(false);
    });

    it("no entries → no box, one warning naming what's missing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      builder.build(container, [{ id: "plain", type: "fill" } as any], { title: "Key" });

      expect(container.querySelector("details.maplibre-legend")).toBeNull();
      expect(container.hidden).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("legend:");
      warn.mockRestore();
    });

    it("a rebuild with entries shows the box again", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      builder.build(container, [], {});
      builder.build(container, [], { items: [{ shape: "square" as const, color: "#00f", label: "A" }] });
      expect(container.hidden).toBe(false);
      expect(container.querySelector("details.maplibre-legend")).not.toBeNull();
      warn.mockRestore();
    });

    it("an untitled legend still gets a clickable summary", () => {
      builder.build(container, [], {
        items: [{ shape: "circle" as const, color: "#ff0000", label: "T" }],
      });

      expect(container.querySelector("summary.legend-title")!.textContent).toBe(
        "Legend"
      );
    });

    it("renders circle symbols", () => {
      const layers: any[] = [];
      const config = {
        items: [
          { shape: "circle" as const, color: "#ff0000", label: "Circles" },
        ],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("legend-symbol circle");
      expect(container.innerHTML).toContain("background:#ff0000");
    });

    it("renders line symbols", () => {
      const layers: any[] = [];
      const config = {
        items: [{ shape: "line" as const, color: "#ff0000", label: "Lines" }],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("legend-symbol line");
    });

    it("renders square symbols (default)", () => {
      const layers: any[] = [];
      const config = {
        items: [
          { shape: "square" as const, color: "#ff0000", label: "Squares" },
        ],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("legend-symbol square");
    });

    it("renders icon symbols", () => {
      const layers: any[] = [];
      const config = {
        items: [
          {
            shape: "icon" as const,
            color: "#ff0000",
            label: "Icons",
            icon: "🗺️",
          },
        ],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).toContain("legend-symbol icon");
      expect(container.innerHTML).toContain("🗺️");
    });

    it("escapes HTML in labels", () => {
      const layers: any[] = [];
      const config = {
        items: [
          {
            shape: "circle" as const,
            color: "#ff0000",
            label: '<script>alert("xss")</script>',
          },
        ],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).not.toContain("<script>");
      expect(container.innerHTML).toContain("&lt;script&gt;");
    });

    it("escapes HTML in title", () => {
      const layers: any[] = [];
      const config = {
        title: '<script>alert("xss")</script>',
        items: [{ shape: "circle" as const, color: "#ff0000", label: "Test" }],
      };

      builder.build(container, layers, config);

      expect(container.innerHTML).not.toContain("<script>");
      expect(container.innerHTML).toContain("&lt;script&gt;");
    });

    it("handles string container ID", () => {
      builder.build("legend-container", [], {
        items: [{ shape: "circle" as const, color: "#ff0000", label: "Test" }],
      });

      expect(container.innerHTML).toContain("Test");
    });

    it("does nothing for non-existent container ID", () => {
      expect(() => {
        builder.build("non-existent", [], {
          items: [
            { shape: "circle" as const, color: "#ff0000", label: "Test" },
          ],
        });
      }).not.toThrow();
    });

    it("filters out layers without legend", () => {
      const layers = [
        {
          id: "layer1",
          type: "circle" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
          legend: {
            shape: "circle" as const,
            color: "#ff0000",
            label: "With Legend",
          },
        },
        {
          id: "layer2",
          type: "line" as const,
          source: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
          // No legend property
        },
      ];

      builder.build(container, layers as any);

      expect(container.innerHTML).toContain("With Legend");
      expect(container.querySelectorAll(".legend-item")).toHaveLength(1);
    });

    it("handles empty layers array", () => {
      expect(() => {
        builder.build(container, []);
      }).not.toThrow();
    });
  });
});
