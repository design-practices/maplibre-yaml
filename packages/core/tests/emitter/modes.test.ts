/**
 * @file Tests for compilation modes and the runtime gate
 * @module @maplibre-yaml/core/tests/emitter
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { projectStyle, applyRuntimeGate, EmitError } from "../../src/emitter";
import { normalizeMapBlock } from "../../src/model";
import { supportsState, meetsVersion, allowsHtml, allowsOrigin } from "../../src/capabilities";
import type { V1MapInput } from "../../src/model";

const emptyGeojson = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

const stateDoc = {
  id: "m",
  config: { center: [0, 0], zoom: 5 },
  state: { scenario: { default: "built" } },
  sources: { s: emptyGeojson },
  layers: [
    {
      id: "massing",
      type: "fill",
      source: "s",
      paint: {
        "fill-opacity": ["case", ["==", ["global-state", "scenario"], "built"], 1, 0.3],
      },
    },
  ],
};

const project = (input: unknown, mode?: "strict" | "with-fallbacks") =>
  projectStyle(normalizeMapBlock(input as V1MapInput), mode);

describe("runtime gate on state:", () => {
  it("compiles state through on a supporting runtime", () => {
    const gated = applyRuntimeGate(project(stateDoc), { trust: "trusted", target: "5.6.0" });

    expect(gated.style["state"]).toEqual({ scenario: { default: "built" } });
    const layers = gated.style["layers"] as Record<string, unknown>[];
    expect(JSON.stringify(layers[0]!["paint"])).toContain("global-state");
    expect(validateStyleMin(gated.style as never)).toEqual([]);
  });

  it("inlines defaults and drops state below the floor (AE6)", () => {
    const gated = applyRuntimeGate(project(stateDoc), { trust: "trusted", target: "5.4.0" });

    expect(gated.style).not.toHaveProperty("state");
    const layers = gated.style["layers"] as Record<string, unknown>[];
    // The `case` collapses to a comparison against the literal default.
    expect(layers[0]!["paint"]).toEqual({
      "fill-opacity": ["case", ["==", "built", "built"], 1, 0.3],
    });
    expect(gated.warnings.map((w) => w.message).join(" ")).toMatch(/5\.6\.0/);
    expect(validateStyleMin(gated.style as never)).toEqual([]);
  });

  it("inlines state when inlineState is set, even on a supporting runtime", () => {
    const gated = applyRuntimeGate(project(stateDoc), {
      trust: "trusted",
      target: "6.0.0",
      inlineState: true,
    });
    expect(gated.style).not.toHaveProperty("state");
    expect(validateStyleMin(gated.style as never)).toEqual([]);
  });

  it("treats an undeclared target as not meeting the floor", () => {
    // A caller who has not said which runtime they target has not made a claim
    // about it; guessing generously ships a style that renders blank.
    const gated = applyRuntimeGate(project(stateDoc), { trust: "untrusted" });
    expect(gated.style).not.toHaveProperty("state");
  });

  it("is a no-op for a document that declares no state", () => {
    const result = project({
      id: "m",
      config: { center: [0, 0], zoom: 5 },
      sources: { s: emptyGeojson },
      layers: [{ id: "a", type: "circle", source: "s" }],
    });
    const gated = applyRuntimeGate(result, { trust: "untrusted" });
    expect(gated.warnings).toEqual(result.warnings);
  });

  it("warns when an expression reads a state key that is not declared", () => {
    const gated = applyRuntimeGate(
      project({
        ...stateDoc,
        state: { other: { default: 1 } },
      }),
      { trust: "trusted", target: "5.0.0" }
    );
    expect(gated.warnings.map((w) => w.message).join(" ")).toMatch(/does not declare/);
  });

  it("does not rewrite expression-shaped author data", () => {
    const gated = applyRuntimeGate(
      project({
        ...stateDoc,
        sources: {
          s: {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [0, 0] },
                  properties: { note: ["global-state", "scenario"] },
                },
              ],
            },
          },
        },
      }),
      { trust: "trusted", target: "5.0.0" }
    );

    const sources = gated.style["sources"] as Record<string, Record<string, unknown>>;
    const data = sources["s"]!["data"] as Record<string, unknown>;
    const props = (data["features"] as Record<string, unknown>[])[0]!["properties"] as Record<
      string,
      unknown
    >;
    expect(props["note"]).toEqual(["global-state", "scenario"]);
  });
});

describe("--strict means no lossy degradation, not no runtime content", () => {
  it("accepts a document whose runtime content simply erases (AE3)", () => {
    // Dropping runtime: is the contract. Erroring on it would reject
    // essentially every document ever written in this format.
    const { style, warnings } = project(
      {
        id: "m",
        config: { center: [0, 0], zoom: 5, scrollZoom: false },
        controls: { navigation: true },
        sources: { s: emptyGeojson },
        layers: [
          { id: "a", type: "circle", source: "s", interactive: { hover: { highlight: true } } },
        ],
      },
      "strict"
    );

    expect(validateStyleMin(style as never)).toEqual([]);
    expect(warnings.every((w) => w.kind === "contract")).toBe(true);
  });

  it("errors when a live source has no compile-time data to fall back on", () => {
    expect(() =>
      project(
        {
          id: "m",
          config: { center: [0, 0], zoom: 5 },
          sources: {
            s: { type: "geojson", url: "/live.geojson", refresh: { refreshInterval: 5000 } },
          },
          layers: [{ id: "a", type: "circle", source: "s" }],
        },
        "strict"
      )
    ).toThrow(EmitError);
  });

  it("degrades that same document under with-fallbacks", () => {
    const { warnings } = project({
      id: "m",
      config: { center: [0, 0], zoom: 5 },
      sources: {
        s: { type: "geojson", url: "/live.geojson", refresh: { refreshInterval: 5000 } },
      },
      layers: [{ id: "a", type: "circle", source: "s" }],
    });
    expect(warnings.some((w) => w.kind === "lossy")).toBe(true);
  });
});

describe("capability policy", () => {
  it("compares versions", () => {
    expect(meetsVersion("5.6.0", "5.6.0")).toBe(true);
    expect(meetsVersion("5.7.1", "5.6.0")).toBe(true);
    expect(meetsVersion("5.5.9", "5.6.0")).toBe(false);
    expect(meetsVersion("6.0.0", "5.6.0")).toBe(true);
    expect(meetsVersion("^5.6.0", "5.6.0")).toBe(true);
    expect(meetsVersion(undefined, "5.6.0")).toBe(false);
  });

  it("gates state on the floor", () => {
    expect(supportsState({ trust: "trusted", target: "5.6.0" })).toBe(true);
    expect(supportsState({ trust: "trusted", target: "4.7.1" })).toBe(false);
  });

  it("inlineState forces state off even on a supporting runtime", () => {
    // Native portability: state is JS-only, so a caller targeting cross-renderer
    // output opts into inlining regardless of the JS version.
    expect(supportsState({ trust: "trusted", target: "5.6.0", inlineState: true })).toBe(false);
    expect(supportsState({ trust: "trusted", target: "6.0.0", inlineState: true })).toBe(false);
  });

  it("denies raw markup by default in an untrusted context", () => {
    expect(allowsHtml({ trust: "untrusted" })).toBe(false);
    expect(allowsHtml({ trust: "trusted" })).toBe(true);
    // An explicit opt-in is honored — a host with its own sanitizer may say so.
    expect(allowsHtml({ trust: "untrusted", allowHtml: true })).toBe(true);
  });

  it("restricts live-data origins when an allowlist is given", () => {
    const policy = { trust: "untrusted" as const, allowedOrigins: ["https://data.test"] };
    expect(allowsOrigin(policy, "https://data.test/x.geojson")).toBe(true);
    expect(allowsOrigin(policy, "https://attacker.test/x.geojson")).toBe(false);
    // Relative URLs resolve against the host's own page, so they are
    // same-origin by construction.
    expect(allowsOrigin(policy, "/data/x.geojson")).toBe(true);
    expect(allowsOrigin({ trust: "untrusted" }, "https://anywhere.test/x")).toBe(true);
  });
});
