/**
 * Conformance: the specs we hand to MapLibre are valid MapLibre.
 *
 * @remarks
 * The rest of the renderer suite asserts against a mocked map, which proves we
 * *called* `addLayer`/`addSource` with a given object — not that MapLibre would
 * accept it. A malformed paint expression or source spec passes every one of
 * those tests and then throws at runtime, leaving the feature dead. That is the
 * exact defect class the schema-truthfulness work exists to remove, so the
 * generated specs are validated here against MapLibre's own style-spec
 * validator rather than against our expectations of it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createPropertyExpression,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { LayerManager } from "../../src/renderer/layer-manager";
import { EventHandler } from "../../src/renderer/event-handler";

vi.mock("maplibre-gl", () => {
  const Popup = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));
  return { default: { Popup }, Popup, Map: vi.fn() };
});

/** Paint spec for a data-driven colour, as the style spec defines it. */
const COLOR_PROPERTY_SPEC = {
  type: "color",
  "property-type": "data-driven",
  expression: {
    interpolated: true,
    parameters: ["zoom", "feature", "feature-state"],
  },
} as any;

/** Wrap generated layers/sources in a minimal style the validator accepts. */
function styleWith(sources: any, layers: any[]) {
  return {
    version: 8 as const,
    name: "conformance",
    sources,
    layers,
  };
}

describe("generated MapLibre specs are spec-valid", () => {
  let mockMap: any;
  let manager: LayerManager;
  let addedSources: Record<string, any>;
  let addedLayers: any[];

  beforeEach(() => {
    addedSources = {};
    addedLayers = [];
    mockMap = {
      addSource: vi.fn((id: string, spec: any) => {
        addedSources[id] = spec;
      }),
      addLayer: vi.fn((spec: any) => {
        addedLayers.push(spec);
      }),
      getSource: vi.fn(() => undefined),
      getLayer: vi.fn(() => undefined),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
    manager = new LayerManager(mockMap);
  });

  describe("hover.highlight paint rewrite", () => {
    it("produces an expression MapLibre actually accepts", async () => {
      await manager.addLayer({
        id: "pts",
        type: "circle",
        visible: true,
        toggleable: false,
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
        paint: { "circle-color": "#ff0000" },
        interactive: { hover: { highlight: true } },
      } as any);

      const generated = addedLayers[0].paint["circle-color"];

      // The real compiler, not a shape assertion: a malformed `case`, a bad
      // ["boolean", ...] arity, or a non-colour branch fails here.
      const compiled = createPropertyExpression(generated, COLOR_PROPERTY_SPEC);
      expect(
        compiled.result === "error"
          ? (compiled as any).value.map((e: any) => e.message).join("; ")
          : "success"
      ).toBe("success");
    });

    it("evaluates to the highlight colour only when hover state is set", async () => {
      await manager.addLayer({
        id: "pts",
        type: "circle",
        visible: true,
        toggleable: false,
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
        paint: { "circle-color": "#ff0000" },
        interactive: { hover: { highlight: true } },
      } as any);

      const compiled = createPropertyExpression(
        addedLayers[0].paint["circle-color"],
        COLOR_PROPERTY_SPEC
      ) as any;
      expect(compiled.result).toBe("success");

      const evaluate = (featureState: Record<string, unknown>) =>
        compiled.value.evaluate({ zoom: 10 }, { properties: {} }, featureState);

      // The actual behavioural claim: hovering changes the rendered colour,
      // and not hovering leaves the authored colour intact.
      const base = evaluate({});
      const hovered = evaluate({ hover: true });
      expect(base.toString()).not.toEqual(hovered.toString());
      expect(base.toString()).toContain("255,0,0"); // authored #ff0000
    });

    it("keeps the whole layer valid against the style spec", async () => {
      await manager.addLayer({
        id: "pts",
        type: "circle",
        visible: true,
        toggleable: false,
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
        paint: { "circle-color": "#ff0000" },
        interactive: { hover: { highlight: true } },
      } as any);

      const errors = validateStyleMin(
        styleWith(
          { "pts-source": addedSources["pts-source"] },
          addedLayers
        ) as any
      );
      expect(errors.map((e: any) => `${e.message}`)).toEqual([]);
    });
  });

  describe("the two halves of highlight actually meet", () => {
    it("renders the highlight colour for the state EventHandler really writes", async () => {
      // The failure this exists to catch: LayerManager reads feature-state key
      // K while EventHandler writes key K'. Both halves stay individually
      // valid — the expression compiles, the state write succeeds — and
      // highlighting silently does nothing. Neither module's own tests can see
      // it, so the contract is only observable by crossing them here.
      await manager.addLayer({
        id: "pts",
        type: "circle",
        visible: true,
        toggleable: false,
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "id",
        },
        paint: { "circle-color": "#ff0000" },
        interactive: { hover: { highlight: true } },
      } as any);

      const compiled = createPropertyExpression(
        addedLayers[0].paint["circle-color"],
        COLOR_PROPERTY_SPEC
      ) as any;
      expect(compiled.result).toBe("success");

      // Drive a real EventHandler and capture what it writes, rather than
      // hand-writing { hover: true } and testing our own assumption.
      const hoverMap: any = {
        on: vi.fn(),
        off: vi.fn(),
        setFeatureState: vi.fn(),
        getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
      };
      const handler = new EventHandler(hoverMap);
      handler.attachEvents({
        id: "pts",
        type: "circle",
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
        interactive: { hover: { highlight: true } },
      } as any);

      const move = hoverMap.on.mock.calls.find((c: any[]) => c[0] === "mousemove");
      move?.[2]?.({ features: [{ id: 1, properties: {} }], lngLat: { lng: 0, lat: 0 } });

      const [, writtenState] = hoverMap.setFeatureState.mock.calls[0];
      expect(writtenState).toBeDefined();

      const unhovered = compiled.value
        .evaluate({ zoom: 10 }, { properties: {} }, {})
        .toString();
      const hovered = compiled.value
        .evaluate({ zoom: 10 }, { properties: {} }, writtenState)
        .toString();

      expect(hovered).not.toEqual(unhovered);
    });
  });

  describe("generated geojson source", () => {
    it("is spec-valid with generateId enabled for highlight", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await manager.addLayer({
        id: "pts",
        type: "circle",
        visible: true,
        toggleable: false,
        source: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
        interactive: { hover: { highlight: true } },
      } as any);
      warn.mockRestore();

      expect(addedSources["pts-source"].generateId).toBe(true);
      const errors = validateStyleMin(
        styleWith({ "pts-source": addedSources["pts-source"] }, addedLayers) as any
      );
      expect(errors.map((e: any) => `${e.message}`)).toEqual([]);
    });
  });
});

/**
 * The style-spec floor, asserted rather than assumed.
 *
 * @remarks
 * `state` and the `global-state` expression arrived in style-spec 21 / maplibre-gl
 * 5.6.0. This package was pinned at style-spec ^20.4.0, whose `$root` carries
 * neither — so a style the emitter produced for a `state:`-bearing document would
 * have been rejected by this very suite. These tests pin the capability the bump
 * exists to unlock, so a future downgrade fails here with an obvious reason
 * instead of surfacing as an inexplicable emitter failure.
 */
describe("style-spec floor", () => {
  const baseStyle = {
    version: 8 as const,
    sources: {},
    layers: [],
  };

  it("accepts a `state` root property", () => {
    const errors = validateStyleMin({
      ...baseStyle,
      state: { scenario: { default: "built" } },
    } as any);
    expect(errors).toEqual([]);
  });

  it("accepts a `global-state` expression reading a declared state key", () => {
    const errors = validateStyleMin({
      ...baseStyle,
      state: { scenario: { default: "built" } },
      sources: {
        parcels: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        {
          id: "massing",
          type: "fill",
          source: "parcels",
          paint: {
            "fill-opacity": [
              "case",
              ["==", ["global-state", "scenario"], "built"],
              1,
              0.3,
            ],
          },
        },
      ],
    } as any);
    expect(errors).toEqual([]);
  });

  it("still rejects a genuinely invalid layer", () => {
    const errors = validateStyleMin({
      ...baseStyle,
      layers: [{ id: "bad", type: "not-a-layer-type" }],
    } as any);
    expect(errors.length).toBeGreaterThan(0);
  });
});
