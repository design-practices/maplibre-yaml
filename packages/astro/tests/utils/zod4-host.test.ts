/**
 * @file The collection schema helpers on a zod-4 host (Astro 6 and 7)
 *
 * @description
 * Astro 6+ bundles zod 4 and re-exports it as `astro/zod`; this workspace
 * develops against Astro 4 (zod 3). Mocking `astro/zod` with `zod/v4` runs
 * the helpers exactly as an Astro 6/7 site does: built from the host's zod,
 * nestable inside the host's `z.object()`, with core's zod-3 schemas bridged.
 * Before the bridge, every one of these failed with
 * "keyValidator._parse is not a function" during `astro build`.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("astro/zod", async () => {
  const v4 = await import("zod/v4");
  return { ...v4, z: v4.z, default: v4.z };
});

import { z } from "zod/v4";
import { HOST_ZOD_IS_V4 } from "../../src/utils/zod-bridge";
import {
  getMapSchema,
  getScrollytellingSchema,
  getChapterSchema,
  getSimpleMapSchema,
  extendSchema,
} from "../../src/utils/collections";
import {
  LocationPointSchema,
  getCollectionItemWithLocationSchema,
} from "../../src/utils/collections-schemas";
import { getCollectionItemWithFeatureRefSchema } from "../../src/utils/feature-ref-schema";

const MAP = {
  type: "map",
  id: "m",
  config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
  layers: [],
};

describe("zod-4 host (Astro 6+)", () => {
  it("detects the v4 host", () => {
    expect(HOST_ZOD_IS_V4).toBe(true);
  });

  it("geo field schemas nest inside the host's z.object()", () => {
    const schema = z.object({ title: z.string(), location: LocationPointSchema.optional() });
    const ok = schema.safeParse({ title: "t", location: { coordinates: [1, 2], name: "x" } });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ title: "t", location: { coordinates: ["a", 2] } });
    expect(bad.success).toBe(false);
  });

  it("collection item helpers accept host-zod custom fields", () => {
    const schema = getCollectionItemWithLocationSchema({ tags: z.array(z.string()) });
    expect(
      schema.safeParse({ title: "t", pubDate: "2024-01-01", tags: ["a"] }).success
    ).toBe(true);
    expect(schema.safeParse({ title: "t", pubDate: "2024-01-01", tags: [1] }).success).toBe(
      false
    );
  });

  it("feature_ref helper keeps its mutual-exclusivity refinement", () => {
    const schema = getCollectionItemWithFeatureRefSchema({ title: z.string() });
    const both = schema.safeParse({
      title: "t",
      feature_ref: { source: "a.geojson", featureId: 1 },
      location: { coordinates: [0, 0] },
    });
    expect(both.success).toBe(false);
    expect(JSON.stringify(both.error?.issues)).toMatch(/Cannot use 'feature_ref'/);
  });

  it("bridged core schemas validate, apply defaults, and keep issue paths", async () => {
    const ok = await getMapSchema().safeParseAsync(MAP);
    expect(ok.success).toBe(true);

    const bad = await getMapSchema().safeParseAsync({ ...MAP, config: { ...MAP.config, zoom: 99 } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(["config", "zoom"]);

    expect(getSimpleMapSchema().safeParse(MAP.config).success).toBe(true);
    expect(
      getChapterSchema().safeParse({ id: "c", title: "C", center: [0, 0], zoom: 3 }).success
    ).toBe(true);
    expect(
      getScrollytellingSchema().safeParse({
        type: "scrollytelling",
        id: "s",
        config: MAP.config,
        chapters: [{ id: "c", title: "C", center: [0, 0], zoom: 3 }],
      }).success
    ).toBe(true);
  });

  it("a bridged schema nests as a field of a host object", () => {
    const schema = z.object({ map: getMapSchema() });
    expect(schema.safeParse({ map: MAP }).success).toBe(true);
  });

  it("extendSchema merges host fields onto a bridged core schema", () => {
    const schema = extendSchema(getMapSchema(), {
      author: z.string(),
      featured: z.boolean().default(false),
    });
    const ok = schema.safeParse({ ...MAP, author: "a" });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ id: "m", author: "a", featured: false });

    expect(schema.safeParse({ ...MAP }).success).toBe(false); // author missing
    expect(
      schema.safeParse({ ...MAP, author: "a", config: { ...MAP.config, zoom: 99 } }).success
    ).toBe(false);
  });

  it("bridged schemas survive the JSON-schema export Astro runs on collections", () => {
    // Astro 6+ calls z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })
    // and only warns on failure; it must not throw for our schemas.
    for (const schema of [getMapSchema(), getCollectionItemWithLocationSchema()]) {
      expect(() =>
        z.toJSONSchema(schema as never, { io: "input", unrepresentable: "any" })
      ).not.toThrow();
    }
  });
});
