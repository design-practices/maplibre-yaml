/**
 * @file The install footprint: cloud-native decoders are bundled, not installed
 *
 * @description
 * flatgeobuf declares OpenLayers (`ol`, ~30 MB with geotiff) as an optional
 * dependency, and npm installs optional dependencies: listing flatgeobuf as
 * a runtime dependency put that tree under every core, astro and cli
 * install. The decoders are bundled into every build instead and listed as
 * devDependencies; the Node build must not import them (or Node's `module`,
 * which fflate's node build pulls in and every browser bundler rejects).
 * The dist checks skip when dist/ is absent outside CI (presubmit builds
 * first), as in maplibre-subpath.test.ts.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const NODE_ENTRIES = ["index.js", "register.js", "components/index.js"].map((f) => join(PKG_ROOT, "dist", f));
const built = NODE_ENTRIES.every((f) => existsSync(f));

if (process.env.CI && !built) {
  throw new Error("dist/ missing under CI — the build step must run before tests");
}

/** Bare specifiers a module imports statically or dynamically. */
function importsOf(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) found.add(m[1]!);
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]!);
  return [...found];
}

describe("install footprint", () => {
  it("the decoders are not runtime dependencies", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain("flatgeobuf");
    expect(deps).not.toContain("pmtiles");
    expect(deps).not.toContain("ol");
  });

  it.skipIf(!built)("the Node build bundles them and imports nothing Node-only", () => {
    const allowed = new Set([...Object.keys(pkg.dependencies ?? {}), "maplibre-gl"]);
    for (const file of NODE_ENTRIES) {
      const imports = importsOf(readFileSync(file, "utf8")).filter((s) => !s.startsWith("."));
      expect(imports.filter((s) => !allowed.has(s)), file).toEqual([]);
    }
  });
});
