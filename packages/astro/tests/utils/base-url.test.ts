/**
 * @file withBase(): a component `src` under Astro's `base` (ml-aot.21)
 */

import { describe, it, expect } from "vitest";
import { withBase } from "../../src/utils/base-url";

describe("withBase", () => {
  it("prefixes a root-relative path with the base, in every BASE_URL spelling", () => {
    for (const base of ["/my-repo", "/my-repo/", "my-repo", "/my-repo//"]) {
      expect(withBase("/configs/map.yaml", base)).toBe("/my-repo/configs/map.yaml");
    }
    expect(withBase("/configs/map.yaml", "/org/site/")).toBe("/org/site/configs/map.yaml");
  });

  it("leaves the path alone when there is no base", () => {
    for (const base of ["/", "", undefined]) {
      expect(withBase("/configs/map.yaml", base)).toBe("/configs/map.yaml");
    }
  });

  it("never doubles a base the author already wrote", () => {
    expect(withBase("/my-repo/configs/map.yaml", "/my-repo/")).toBe("/my-repo/configs/map.yaml");
    expect(withBase("/my-repo", "/my-repo")).toBe("/my-repo");
    expect(withBase("/my-repo?x=1", "/my-repo")).toBe("/my-repo?x=1");
    // A sibling path that merely starts with the same letters is not "already based".
    expect(withBase("/my-repository/map.yaml", "/my-repo")).toBe("/my-repo/my-repository/map.yaml");
  });

  it("leaves everything that is not root-relative untouched", () => {
    for (const url of [
      "https://example.com/map.yaml",
      "http://localhost:4321/map.yaml",
      "//cdn.example.com/map.yaml",
      "./map.yaml",
      "../configs/map.yaml",
      "configs/map.yaml",
      "data:text/yaml,type: map",
      "",
    ]) {
      expect(withBase(url, "/my-repo")).toBe(url);
    }
    expect(withBase(undefined, "/my-repo")).toBeUndefined();
  });
});
