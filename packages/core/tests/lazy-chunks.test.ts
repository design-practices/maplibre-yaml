/**
 * @file On-demand format readers (ml-7qa.5, 0.9): what the builds emit
 *
 * @description
 * The format libraries behind the seam (src/formats/decoders.ts) must not be
 * in the main bundle of either build:
 *
 * - CDN: `register.browser.js` statically imports nothing but `maplibre-gl`
 *   (a page with no cloud-native source makes no extra request) and reaches
 *   each library only through `import("./chunks/<name>.js")`; every chunk is
 *   self-contained (it imports nothing back from the bundle, so a renamed or
 *   re-hosted bundle still finds it).
 * - npm: the libraries live in `dist/formats/<name>.js`, reached by
 *   `import()`, never by a static import of an entry.
 *
 * The dist checks skip when dist/ is absent outside CI (presubmit builds
 * first), as in install-footprint.test.ts.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist");
const read = (f: string) => readFileSync(join(DIST, f), "utf8");
const built = existsSync(join(DIST, "register.browser.js")) && existsSync(join(DIST, "index.js"));

if (process.env.CI && !built) {
  throw new Error("dist/ missing under CI — the build step must run before tests");
}

/** The seam's on-demand names, read the way tsup.config.ts reads them. */
const SEAM_NAMES = [
  ...readFileSync(join(PKG_ROOT, "src/formats/decoders.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .matchAll(/["']?([a-z][\w-]*)["']?\s*:\s*\(\)\s*=>\s*import\(/g),
].map((m) => m[1]!);

/** Strings only the libraries contain (their own error messages). */
const LIBRARY_MARKERS: Record<string, string[]> = {
  pmtiles: ["Wrong magic number for PMTiles archive", "Server returned no content-length header"],
  flatgeobuf: ["Not a FlatGeobuf file", "Invalid header size", "FlatBuffers: "],
};

/** Static import specifiers (`import … from "x"`, `import "x"`), minified or not. */
function staticImports(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/(?:^|[;\n])import\s*(?:[\w$*{][^'"]*?from\s*)?['"]([^'"]+)['"]/g)) found.add(m[1]!);
  for (const m of code.matchAll(/(?:^|[;\n])export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) found.add(m[1]!);
  return [...found];
}

/** Dynamic `import("x")` specifiers. */
function dynamicImports(code: string): string[] {
  return [...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
}

/** Every .js file under a dist subdirectory (relative to dist/). */
function jsFiles(dir: string): string[] {
  const root = join(DIST, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

describe("the seam", () => {
  it("names the readers this version loads on demand", () => {
    expect(SEAM_NAMES).toEqual(expect.arrayContaining(["pmtiles", "flatgeobuf"]));
    for (const name of Object.keys(LIBRARY_MARKERS)) expect(SEAM_NAMES).toContain(name);
  });
});

describe.skipIf(!built)("CDN build: register.browser.js + chunks/", () => {
  const main = built ? read("register.browser.js") : "";

  it("statically imports nothing but maplibre-gl (no shared chunk on every page)", () => {
    expect(staticImports(main)).toEqual(["maplibre-gl"]);
  });

  it("reaches each reader through import('./chunks/<name>.js'), and only those", () => {
    expect(dynamicImports(main).sort()).toEqual(SEAM_NAMES.map((n) => `./chunks/${n}.js`).sort());
  });

  it("does not contain the readers themselves", () => {
    for (const [name, markers] of Object.entries(LIBRARY_MARKERS)) {
      for (const marker of markers) expect(main.includes(marker), `${name}: ${marker}`).toBe(false);
    }
  });

  it("emits every chunk, self-contained, holding its library", () => {
    for (const name of SEAM_NAMES) {
      const file = `chunks/${name}.js`;
      expect(existsSync(join(DIST, file)), file).toBe(true);
      const code = read(file);
      // Nothing relative (no import back into the bundle), at most maplibre-gl.
      expect(staticImports(code).filter((s) => s !== "maplibre-gl"), file).toEqual([]);
      for (const marker of LIBRARY_MARKERS[name] ?? []) expect(code.includes(marker), `${file}: ${marker}`).toBe(true);
    }
  });

  it("keeps index.browser.js one file (tooling pages), readers inlined", () => {
    const code = read("index.browser.js");
    expect(staticImports(code)).toEqual(["maplibre-gl"]);
    expect(dynamicImports(code).filter((s) => s.startsWith("."))).toEqual([]);
  });

  it("ships chunks/ in the package (`files` includes dist)", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("dist");
  });
});

describe.skipIf(!built)("npm build: readers in dist/formats/, reached by import()", () => {
  const formatFiles = new Set(SEAM_NAMES.map((n) => `formats/${n}.js`));
  const npmFiles = [
    "index.js",
    "register.js",
    "components/index.js",
    "schemas/index.js",
    "scrollytelling/index.js",
    "maplibre.js",
    ...jsFiles("shared"),
  ];

  it("emits each reader as its own module", () => {
    for (const file of formatFiles) expect(existsSync(join(DIST, file)), file).toBe(true);
  });

  it("no entry or shared module contains a reader, or imports one statically", () => {
    for (const file of npmFiles) {
      const code = read(file);
      for (const [name, markers] of Object.entries(LIBRARY_MARKERS)) {
        for (const marker of markers) expect(code.includes(marker), `${file} has ${name}: ${marker}`).toBe(false);
      }
      const statics = staticImports(code).filter((s) => /\/formats\//.test(s));
      expect(statics, file).toEqual([]);
    }
    const dynamic = npmFiles.flatMap((f) => dynamicImports(read(f)));
    for (const name of SEAM_NAMES) expect(dynamic).toContain(`../formats/${name}.js`);
  });
});
