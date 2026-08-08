/**
 * @file Tests for the extension registry
 * @module @maplibre-yaml/core/tests/extensions
 *
 * @description
 * The registry's contract is that an `x-*` block is a trust boundary: validated
 * before any consumer sees it, dropped rather than partially delivered when it
 * fails, and dropped when its namespace is unknown. The design target is
 * map-party's `x-map-party`, so the tests use a schema shaped like it —
 * including the bare-string shorthand it normalizes.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ExtensionRegistry } from "../../src/extensions";

/** A shape like map-party's per-layer block, with its shorthand. */
const mapPartyLayer = z.object({
  searchable: z.boolean().optional(),
  filterableProperties: z
    .array(z.union([z.string(), z.object({ property: z.string(), label: z.string() })]))
    .optional(),
});

/** Normalization: bare strings expand to {property, label}. */
const normalizeMapParty = (block: z.infer<typeof mapPartyLayer>) => ({
  ...block,
  filterableProperties: block.filterableProperties?.map((p) =>
    typeof p === "string" ? { property: p, label: p } : p
  ),
});

const withRegistered = () => {
  const registry = new ExtensionRegistry();
  registry.register("x-map-party", { schema: mapPartyLayer, normalize: normalizeMapParty });
  return registry;
};

describe("ExtensionRegistry — registration", () => {
  it("rejects a namespace that does not begin with x-", () => {
    const registry = new ExtensionRegistry();
    expect(() => registry.register("map-party", { schema: z.any() })).toThrow(/must begin with/);
  });

  it("rejects re-registering a namespace rather than shadowing it", () => {
    const registry = new ExtensionRegistry();
    registry.register("x-a", { schema: z.any() });
    expect(() => registry.register("x-a", { schema: z.any() })).toThrow(/already registered/);
  });
});

describe("ExtensionRegistry — extraction", () => {
  it("validates, normalizes, and delivers a registered block", () => {
    const doc = {
      type: "map",
      id: "m",
      layers: [
        {
          id: "a",
          type: "circle",
          source: "s",
          "x-map-party": { searchable: true, filterableProperties: ["boro", "dba"] },
        },
      ],
    };

    const { blocks, warnings } = withRegistered().extract(doc);

    expect(warnings).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.namespace).toBe("x-map-party");
    expect(blocks[0]!.path).toBe("layers[0]");
    // The bare-string shorthand expanded — the normalization every consumer
    // would otherwise reimplement.
    expect(blocks[0]!.value).toEqual({
      searchable: true,
      filterableProperties: [
        { property: "boro", label: "boro" },
        { property: "dba", label: "dba" },
      ],
    });
  });

  it("finds a root-level and a per-layer block in one document", () => {
    const registry = new ExtensionRegistry();
    registry.register("x-room", { schema: z.object({ allowLocalFilters: z.boolean() }) });
    registry.register("x-layer", { schema: z.object({ searchable: z.boolean() }) });

    const { blocks } = registry.extract({
      type: "map",
      id: "m",
      "x-room": { allowLocalFilters: true },
      layers: [{ id: "a", type: "circle", source: "s", "x-layer": { searchable: true } }],
    });

    const byNs = Object.fromEntries(blocks.map((b) => [b.namespace, b.path]));
    expect(byNs).toEqual({ "x-room": "", "x-layer": "layers[0]" });
  });

  it("drops an unregistered namespace with a warning, delivering nothing", () => {
    const { blocks, warnings } = withRegistered().extract({
      type: "map",
      id: "m",
      "x-unknown": { anything: true },
    });

    expect(blocks).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.namespace).toBe("x-unknown");
    expect(warnings[0]!.message).toMatch(/no registered schema/);
  });

  it("drops an invalid block entirely rather than partially delivering it", () => {
    const { blocks, warnings } = withRegistered().extract({
      type: "map",
      id: "m",
      layers: [
        { id: "a", type: "circle", source: "s", "x-map-party": { searchable: "yes please" } },
      ],
    });

    expect(blocks).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/failed its registered schema/);
  });

  it("does not treat an x- key inside feature data as an extension block", () => {
    const { blocks, warnings } = withRegistered().extract({
      type: "map",
      id: "m",
      sources: {
        s: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { "x-map-party": "just a property name" },
              },
            ],
          },
        },
      },
    });

    // The property is author data; the walk stopped at `data`.
    expect(blocks).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
