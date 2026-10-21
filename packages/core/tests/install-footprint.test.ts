/**
 * @file The install footprint: cloud-native decoders are bundled, not installed
 *
 * @description
 * flatgeobuf declares OpenLayers (`ol`, ~30 MB with geotiff) as an optional
 * dependency, and npm installs optional dependencies: listing flatgeobuf as
 * a runtime dependency put that tree under every core, astro and cli
 * install. The decoders are bundled into every build instead (0.9: as
 * on-demand modules, dist/formats/ and dist/chunks/) and listed as
 * devDependencies; the Node build must not import them (or Node's `module`,
 * which fflate's node build pulls in and every browser bundler rejects).
 * The dist checks skip when dist/ is absent outside CI (presubmit builds
 * first), as in maplibre-subpath.test.ts.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const NODE_ENTRIES = ["index.js", "register.js", "components/index.js"].map((f) => join(PKG_ROOT, "dist", f));
const built = NODE_ENTRIES.every((f) => existsSync(f));
/** The npm build's entries plus the modules they share and load on demand (0.9: split). */
const NODE_FILES = built
  ? [
      ...NODE_ENTRIES,
      ...["shared", "formats"].flatMap((dir) =>
        existsSync(join(PKG_ROOT, "dist", dir))
          ? readdirSync(join(PKG_ROOT, "dist", dir))
              .filter((f) => f.endsWith(".js"))
              .map((f) => join(PKG_ROOT, "dist", dir, f))
          : []
      ),
    ]
  : [];

if (process.env.CI && !built) {
  throw new Error("dist/ missing under CI — the build step must run before tests");
}

/** Bare specifiers a module imports statically or dynamically. */
function importsOf(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) found.add(m[1]!);
  // Not a JSDoc type (`{import('http').IncomingMessage}`, kept in the
  // unminified Node build from geotiff.js's sources).
  for (const m of code.matchAll(/(?<!\{)\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]!);
  return [...found];
}

describe("install footprint", () => {
  it("the decoders are not runtime dependencies", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain("flatgeobuf");
    expect(deps).not.toContain("pmtiles");
    expect(deps).not.toContain("ol");
    // The Protomaps basemap generator (ml-cnv.7) is bundled the same way.
    expect(deps).not.toContain("@protomaps/basemaps");
    // The COG reader (ml-cnv.2): ~20 MB installed (geotiff.js and its codecs).
    expect(deps).not.toContain("@geomatico/maplibre-cog-protocol");
    expect(deps).not.toContain("geotiff");
  });

  it.skipIf(!built)("the Node build bundles them and imports nothing Node-only", () => {
    const allowed = new Set([...Object.keys(pkg.dependencies ?? {}), "maplibre-gl"]);
    expect(NODE_FILES.length).toBeGreaterThan(NODE_ENTRIES.length);
    for (const file of NODE_FILES) {
      const imports = importsOf(readFileSync(file, "utf8")).filter((s) => !s.startsWith("."));
      expect(imports.filter((s) => !allowed.has(s)), file).toEqual([]);
    }
  });

  it.skipIf(!existsSync(join(PKG_ROOT, "dist", "register.browser.js")))(
    "the CDN build has no bare import a plain page cannot resolve (ml-aot.109)",
    () => {
      const chunks = readdirSync(join(PKG_ROOT, "dist", "chunks"))
        .filter((f) => f.endsWith(".js"))
        .map((f) => `chunks/${f}`);
      for (const f of ["register.browser.js", "index.browser.js", ...chunks]) {
        const code = readFileSync(join(PKG_ROOT, "dist", f), "utf8");
        expect(importsOf(code).filter((s) => !s.startsWith(".") && s !== "maplibre-gl"), f).toEqual([]);
      }
    }
  );
});
