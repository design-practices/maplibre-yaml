/**
 * @file Tests for v1 → v2 model normalization
 * @module @maplibre-yaml/core/tests/model
 *
 * @description
 * The model's contract is that it loses nothing and invents nothing. These
 * tests assert both directions: the split puts each key on the correct side,
 * and the round trip reconstructs the author's document exactly — including
 * which keys are *absent*, which is the property the renderer depends on.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeMapBlock,
  normalizeLayer,
  normalizeSource,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
} from "../../src/model";
import type { V1MapInput } from "../../src/model";

const minimalInput = (over: Partial<V1MapInput> = {}): V1MapInput =>
  ({
    id: "m",
    config: {
      center: [-74.006, 40.7128],
      zoom: 12,
      mapStyle: "https://demotiles.maplibre.org/style.json",
    },
    ...over,
  }) as V1MapInput;

describe("normalizeMapBlock — config: is cut, not moved", () => {
  it("routes camera keys to the style half", () => {
    const model = normalizeMapBlock(
      minimalInput({
        config: {
          center: [1, 2],
          zoom: 5,
          pitch: 45,
          bearing: 90,
          mapStyle: "https://x.test/s.json",
        },
      } as Partial<V1MapInput>)
    );
    expect(model.style.camera).toEqual({ center: [1, 2], zoom: 5, pitch: 45, bearing: 90 });
    expect(model.runtime.map).toEqual({});
  });

  it("routes constructor options to the runtime half", () => {
    const model = normalizeMapBlock(
      minimalInput({
        config: {
          center: [1, 2],
          zoom: 5,
          minZoom: 3,
          maxZoom: 18,
          scrollZoom: false,
          hash: true,
          renderWorldCopies: false,
        },
      } as Partial<V1MapInput>)
    );
    expect(model.runtime.map).toEqual({
      minZoom: 3,
      maxZoom: 18,
      scrollZoom: false,
      hash: true,
      renderWorldCopies: false,
    });
    expect(Object.keys(model.style.camera).sort()).toEqual(["center", "zoom"]);
  });

  it("renames mapStyle to basemap on the style side (R10)", () => {
    const model = normalizeMapBlock(minimalInput());
    expect(model.style.basemap).toBe("https://demotiles.maplibre.org/style.json");
    expect(model.runtime.map).not.toHaveProperty("mapStyle");
  });

  it("sends an unrecognized config key to the runtime half rather than dropping it", () => {
    const model = normalizeMapBlock(
      minimalInput({
        config: { center: [1, 2], zoom: 5, someFutureMapOption: true },
      } as Partial<V1MapInput>)
    );
    expect(model.runtime.map["someFutureMapOption"]).toBe(true);
  });
});

describe("normalizeMapBlock — key presence is preserved exactly", () => {
  /**
   * The licensing case. MapLibre merges constructor options over its defaults,
   * so `attributionControl: undefined` overwrites the default and the map ends
   * up with no attribution at all. A normalizer that enumerates known keys and
   * reassembles would reintroduce it; this asserts we partition the author's
   * own keys instead.
   */
  it("does not invent keys the author omitted", () => {
    const model = normalizeMapBlock(
      minimalInput({ config: { center: [1, 2], zoom: 5 } } as Partial<V1MapInput>)
    );
    const reassembled = denormalizeConfig(model) as unknown as Record<string, unknown>;

    expect(Object.keys(reassembled).sort()).toEqual(["center", "zoom"]);
    expect("attributionControl" in reassembled).toBe(false);
    expect("mapStyle" in reassembled).toBe(false);
    expect("pitch" in reassembled).toBe(false);
  });

  it("preserves an explicitly-false value rather than treating it as absent", () => {
    const model = normalizeMapBlock(
      minimalInput({
        config: { center: [1, 2], zoom: 5, attributionControl: false },
      } as Partial<V1MapInput>)
    );
    const reassembled = denormalizeConfig(model) as unknown as Record<string, unknown>;
    expect("attributionControl" in reassembled).toBe(true);
    expect(reassembled["attributionControl"]).toBe(false);
  });

  it("round-trips the author's config keys exactly", () => {
    const config = {
      center: [-74.006, 40.7128],
      zoom: 12,
      pitch: 45,
      mapStyle: "https://x.test/s.json",
      minZoom: 2,
      scrollZoom: false,
    };
    const model = normalizeMapBlock(minimalInput({ config } as Partial<V1MapInput>));
    const reassembled = denormalizeConfig(model) as unknown as Record<string, unknown>;
    expect(reassembled).toEqual(config);
    expect(Object.keys(reassembled).sort()).toEqual(Object.keys(config).sort());
  });
});

describe("normalizeSource — the 0.4.0 scrub list, declared", () => {
  it("splits live-data keys from spec keys", () => {
    const model = normalizeSource({
      type: "geojson",
      url: "/data/x.geojson",
      promoteId: "bbl",
      cluster: true,
      refresh: { refreshInterval: 5000 },
      cache: { enabled: true },
    } as never);

    expect(model.spec).toEqual({
      type: "geojson",
      url: "/data/x.geojson",
      promoteId: "bbl",
      cluster: true,
    });
    expect(model.runtime).toEqual({
      refresh: { refreshInterval: 5000 },
      cache: { enabled: true },
    });
  });

  it("treats the legacy top-level refresh fields as runtime", () => {
    const model = normalizeSource({
      type: "geojson",
      url: "/x.geojson",
      refreshInterval: 5000,
      updateStrategy: "merge",
      updateKey: "id",
    } as never);
    expect(Object.keys(model.spec).sort()).toEqual(["type", "url"]);
    expect(Object.keys(model.runtime).sort()).toEqual([
      "refreshInterval",
      "updateKey",
      "updateStrategy",
    ]);
  });

  it("keeps an unrecognized source key on the spec side", () => {
    const model = normalizeSource({ type: "geojson", url: "/x.geojson", buffer: 64 } as never);
    expect(model.spec["buffer"]).toBe(64);
    expect(model.runtime).toEqual({});
  });
});

describe("normalizeLayer — experience keys split from cartography", () => {
  it("splits interactions, legend, label and toggle from the spec", () => {
    const model = normalizeLayer({
      id: "pts",
      type: "circle",
      source: "s",
      paint: { "circle-color": "#111" },
      interactive: { hover: { highlight: true } },
      legend: { color: "#111", label: "Points" },
      label: "Points",
      toggleable: true,
    } as never);

    expect(Object.keys(model.spec).sort()).toEqual(["id", "paint", "source", "type"]);
    expect(Object.keys(model.runtime).sort()).toEqual([
      "interactive",
      "label",
      "legend",
      "toggleable",
    ]);
  });

  it("keeps `metadata` on the spec side so it reaches the emitted style", () => {
    // Deliberate: `metadata` is a legal style-spec layer property that MapLibre
    // carries through, and downstream tools read it. The trade is that it rides
    // into any redistributed artifact, so it is documented rather than dropped.
    const model = normalizeLayer({
      id: "pts",
      type: "circle",
      source: "s",
      metadata: { owner: "planning-dept" },
    } as never);
    expect(model.spec["metadata"]).toEqual({ owner: "planning-dept" });
    expect(model.runtime).not.toHaveProperty("metadata");
  });

  it("keeps `visible` on the spec side — it erases to layout.visibility", () => {
    const model = normalizeLayer({
      id: "pts",
      type: "circle",
      source: "s",
      visible: false,
    } as never);
    expect(model.spec["visible"]).toBe(false);
    expect(model.runtime).not.toHaveProperty("visible");
  });
});

describe("round trip — the fidelity proof", () => {
  it("reconstructs layers exactly", () => {
    const layers = [
      {
        id: "a",
        type: "circle",
        source: "s",
        paint: { "circle-color": "#111" },
        interactive: { hover: { highlight: true } },
      },
      { id: "b", type: "line", source: "s", visible: false },
    ];
    const model = normalizeMapBlock(minimalInput({ layers } as never));
    expect(denormalizeLayers(model)).toEqual(layers);
  });

  it("reconstructs named sources exactly", () => {
    const sources = {
      parcels: { type: "geojson", url: "/x.geojson", refresh: { refreshInterval: 5000 } },
    };
    const model = normalizeMapBlock(minimalInput({ sources } as never));
    expect(denormalizeSources(model)).toEqual(sources);
  });

  it("carries controls and legend through the runtime half", () => {
    const controls = { navigation: true } as never;
    const legend = { title: "Legend" } as never;
    const model = normalizeMapBlock(minimalInput({ controls, legend }));
    expect(model.runtime.controls).toEqual(controls);
    expect(denormalizeOptions(model)).toEqual({ controls, legend });
  });

  it("omits controls and legend from options when the author set neither", () => {
    const model = normalizeMapBlock(minimalInput());
    expect(denormalizeOptions(model)).toEqual({});
  });

  it("does not invent empty runtime containers", () => {
    const model = normalizeMapBlock(minimalInput());
    expect(model.runtime.container).toBeUndefined();
    expect(model.runtime.parameters).toBeUndefined();
    expect(model.style.state).toBeUndefined();
  });
});

describe("state: accepted early (R13, AE6)", () => {
  it("puts state on the style side and parameter metadata on the runtime side", () => {
    const model = normalizeMapBlock(
      minimalInput({
        state: { scenario: "built" },
        parameters: { scenario: { label: "Scenario", type: "enum" } },
      } as Partial<V1MapInput>)
    );
    expect(model.style.state).toEqual({ scenario: "built" });
    expect(model.runtime.parameters).toEqual({
      scenario: { label: "Scenario", type: "enum" },
    });
    expect(model.runtime.map).not.toHaveProperty("state");
  });

  it("does not leak state or parameters into MapLibre constructor options", () => {
    const model = normalizeMapBlock(
      minimalInput({
        state: { scenario: "built" },
        parameters: { scenario: { label: "Scenario" } },
      } as Partial<V1MapInput>)
    );
    const reassembled = denormalizeConfig(model) as unknown as Record<string, unknown>;
    expect("state" in reassembled).toBe(false);
    expect("parameters" in reassembled).toBe(false);
  });
});
