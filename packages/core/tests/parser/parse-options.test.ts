/**
 * @file U1 (ml-0fg): the canonical parse options are public API.
 *
 * These pin that `YAML_PARSE_OPTIONS` and `htmlTag` reach a consumer through
 * the package's public barrel — the single source of truth a consumer imports
 * instead of re-declaring (which is how Astro's copy drifted and dropped
 * `!html`). Importing from the root barrel (`../../src`) proves `core/index.ts`'s
 * `export *` surfaces them; the shape assertions pin the contract.
 */

import { describe, it, expect, vi } from "vitest";

// The root barrel eagerly loads maplibre-gl (via the renderer), which needs a
// URL.createObjectURL. Same shim the renderer conformance suites use — lets us
// import from the real public `@maplibre-yaml/core` surface, not a sub-path.
vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:parse-options";
  w.URL.revokeObjectURL ??= () => {};
});

import { YAML_PARSE_OPTIONS, htmlTag } from "../../src";

describe("canonical parse options are public API (U1)", () => {
  it("YAML_PARSE_OPTIONS reaches consumers through the public barrel", () => {
    expect(YAML_PARSE_OPTIONS).toBeDefined();
    expect(YAML_PARSE_OPTIONS.merge).toBe(true);
  });

  it("YAML_PARSE_OPTIONS carries the !html tag (the half a drifted copy drops)", () => {
    const tags = YAML_PARSE_OPTIONS.customTags;
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain(htmlTag);
    // The tag is addressable by its `!html` name.
    expect(
      (tags as Array<{ tag?: string }>).some((t) => t?.tag === "!html")
    ).toBe(true);
  });

  it("htmlTag resolves !html to the structural { $html } marker", () => {
    expect(htmlTag.tag).toBe("!html");
    // `resolve` is the ScalarTag hook the yaml library calls for an `!html` node.
    const resolve = htmlTag.resolve as (v: string) => unknown;
    expect(resolve("<b>x</b>")).toEqual({ $html: "<b>x</b>" });
  });
});
