/**
 * @file Setup verification test
 * @module @maplibre-yaml/astro/tests
 *
 * @description
 * Basic test to verify the testing infrastructure is working correctly.
 */

import { describe, it, expect } from "vitest";

describe("Test Infrastructure", () => {
  it("vitest is configured correctly", () => {
    expect(true).toBe(true);
  });

  it("can import types", async () => {
    const types = await import("../src/types");
    expect(types).toBeDefined();
  });
});
