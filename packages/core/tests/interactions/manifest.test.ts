/**
 * @file Tests for `projectInteractions` — the declarative interactions manifest
 * @module @maplibre-yaml/core/tests/interactions
 *
 * @description
 * `projectInteractions` walks the model's runtime half into a declarative
 * projection `{ layers: { [id]: { source, interactive } } }`. These tests pin:
 *
 *   1. The security property (AE3, projection side): an untrusted policy DROPS
 *      `emit` blocks (fail-closed); a trusted policy keeps them. An absent
 *      policy defaults to untrusted and drops.
 *   2. The `source` id every `highlight` needs is carried on every entry, and
 *      derived the way `EventHandler`/`LayerManager` derive it (named source as
 *      is; inline source as `${id}-source`).
 *   3. The projection is pure declarative data — no functions anywhere — and a
 *      layer with no interactive config yields no entry.
 */

import { describe, it, expect } from "vitest";
import { projectInteractions } from "../../src/interactions/manifest";
import { normalizeMapBlock } from "../../src/model/normalize";
import type { V1MapInput } from "../../src/model/types";
import type { CapabilityPolicy } from "../../src/capabilities";

const trusted: CapabilityPolicy = { trust: "trusted" };
const untrusted: CapabilityPolicy = { trust: "untrusted" };

/** Build a model from a minimal v1 document with the given layers/sources. */
function model(
  layers: Record<string, unknown>[],
  sources: Record<string, unknown> = {}
) {
  const input = {
    id: "map-1",
    config: { center: [0, 0], zoom: 1 },
    layers,
    sources,
  } as unknown as V1MapInput;
  return normalizeMapBlock(input);
}

/** A layer with an inline geojson source and the given interactive config. */
function inlineLayer(id: string, interactive: unknown) {
  return {
    id,
    type: "circle",
    source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    interactive,
  };
}

/** Recursively assert no value in the tree is a function. */
function assertNoFunctions(value: unknown, path = "$"): void {
  expect(typeof value, `${path} is a function`).not.toBe("function");
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoFunctions(v, `${path}.${k}`);
    }
  }
}

describe("projectInteractions — the emit trust gate (AE3, projection side)", () => {
  const emitInteractive = {
    click: {
      popup: [{ p: [{ property: "name" }] }],
      emit: { event: "select", payload: { id: { property: "bbl" } } },
    },
  };

  it("drops the emit block under an untrusted policy (fail-closed)", () => {
    const projection = projectInteractions(
      model([inlineLayer("parcels", emitInteractive)]),
      untrusted
    );
    const click = projection.layers["parcels"]?.interactive.click as Record<
      string,
      unknown
    >;
    expect(click).toBeDefined();
    // The popup survives; only the host-hook seam is dropped.
    expect(click).toHaveProperty("popup");
    expect(click).not.toHaveProperty("emit");
  });

  it("drops the emit block under an absent policy (defaults to untrusted)", () => {
    const projection = projectInteractions(
      model([inlineLayer("parcels", emitInteractive)])
    );
    const click = projection.layers["parcels"]?.interactive.click as Record<
      string,
      unknown
    >;
    expect(click).not.toHaveProperty("emit");
  });

  it("keeps the emit block under a trusted policy", () => {
    const projection = projectInteractions(
      model([inlineLayer("parcels", emitInteractive)]),
      trusted
    );
    const click = projection.layers["parcels"]?.interactive.click as Record<
      string,
      unknown
    >;
    expect(click).toHaveProperty("emit");
    expect((click.emit as any).event).toBe("select");
  });

  it("does not mutate the model when dropping emit", () => {
    const m = model([inlineLayer("parcels", emitInteractive)]);
    projectInteractions(m, untrusted);
    // The model's own runtime half still carries emit — projection cloned it.
    const modelClick = (m.style.layers[0]?.runtime["interactive"] as any).click;
    expect(modelClick).toHaveProperty("emit");
  });
});

describe("projectInteractions — the source id highlight needs", () => {
  it("carries the derived `${id}-source` for an inline source", () => {
    const projection = projectInteractions(
      model([inlineLayer("hoverable", { hover: { highlight: true } })]),
      trusted
    );
    expect(projection.layers["hoverable"]?.source).toBe("hoverable-source");
  });

  it("carries a named source id verbatim", () => {
    const layer = {
      id: "hoverable",
      type: "circle",
      source: "shared-src",
      interactive: { hover: { highlight: true } },
    };
    const projection = projectInteractions(
      model([layer], { "shared-src": { type: "geojson", data: {} } }),
      trusted
    );
    expect(projection.layers["hoverable"]?.source).toBe("shared-src");
  });

  it("carries a source on every entry that configures highlight", () => {
    const projection = projectInteractions(
      model([
        inlineLayer("a", { hover: { highlight: true } }),
        { id: "b", type: "line", source: "named", interactive: { hover: { highlight: true } } },
      ], { named: { type: "geojson", data: {} } }),
      trusted
    );
    for (const entry of Object.values(projection.layers)) {
      if ((entry.interactive.hover as any)?.highlight) {
        expect(typeof entry.source).toBe("string");
        expect(entry.source.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("projectInteractions — declarative data only", () => {
  it("produces a projection with no functions anywhere", () => {
    const projection = projectInteractions(
      model([
        inlineLayer("parcels", {
          hover: { cursor: "pointer", highlight: true },
          click: {
            popup: [{ h3: [{ property: "name" }] }],
            zoomToFeature: { padding: 40 },
            emit: { event: "select" },
          },
        }),
      ]),
      trusted
    );
    assertNoFunctions(projection);
  });

  it("yields no entry for a layer with no interactive config", () => {
    const projection = projectInteractions(
      model([
        { id: "plain", type: "circle", source: { type: "geojson", data: {} } },
        inlineLayer("interactive", { click: { popup: [{ p: [{ str: "hi" }] }] } }),
      ]),
      trusted
    );
    expect(projection.layers).not.toHaveProperty("plain");
    expect(projection.layers).toHaveProperty("interactive");
  });

  it("keys entries by layer id", () => {
    const projection = projectInteractions(
      model([
        inlineLayer("one", { click: { popup: [{ p: [{ str: "a" }] }] } }),
        inlineLayer("two", { hover: { cursor: "pointer" } }),
      ]),
      trusted
    );
    expect(Object.keys(projection.layers).sort()).toEqual(["one", "two"]);
  });
});
