/**
 * @file On-demand readers and the update engine (ml-7qa.5, 0.9; ml-4ug, 0.10): what the builds emit
 *
 * @description
 * The format libraries behind the seam (src/formats/decoders.ts), and the
 * live-documents update engine that rides the same seam (KTD10), must not
 * be in the main bundle of either build:
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
import { join, dirname, relative, resolve, sep } from "node:path";
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
  // @protomaps/basemaps (ml-cnv.7): its error and one of its layer ids.
  "protomaps-basemap": ["Flavor not found", "roads_tunnels_highway_casing"],
  // hyparquet, plus fzstd (zstd) — the main bundle's formats/geoparquet.ts
  // names none of these.
  geoparquet: ['parquet filter requires rowFormat: "object"', "parquet requires metadata", "invalid zstd data"],
  "geoparquet-brotli": ["copyUncompressedBlockToOutput: not enough bytes", "Invalid size nibble"],
  cog: ["Invalid COG protocol URL", "Server responded with full file", "GDAL_NODATA"],
  // The update engine (renderer/update): its own wording, which the entry —
  // which decides fallback and runs the queue — never carries.
  update: ["so the document's layer is skipped", "names a layer that comes earlier in the document"],
  // toml-eslint-parser's own errors, and the TOML hints the chunk words
  // (the entry carries neither: YAML and JSON pages download no TOML code).
  toml: ["Trailing comma is not permitted in an inline table", "Unspecified values are invalid", "TOML reads the dots in"],
  // The converter's loss rules and printers (convert/): only `convertDocument`
  // loads them, and no element imports it.
  convert: ["and leaving this value out would change the document", "is written out in full", "# yaml-language-server: $schema="],
};

/** geotiff's codecs, in chunks/cog-<codec>.js (ml-cnv.11): never in a main bundle either. */
const CODEC_MARKERS = ["LercDecode", "JPEGTables"];

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

/** `files` and every dist module they import statically, transitively (dist-relative). */
function staticClosure(files: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticImports(read(file))) {
      if (!spec.startsWith(".")) continue;
      queue.push(relative(DIST, resolve(DIST, dirname(file), spec)).split(sep).join("/"));
    }
  }
  return [...seen];
}

describe("the seam", () => {
  it("names the readers this version loads on demand", () => {
    expect([...SEAM_NAMES].sort()).toEqual(
      ["cog", "convert", "flatgeobuf", "geoparquet", "geoparquet-brotli", "pmtiles", "protomaps-basemap", "toml", "update"]
    );
    // Every on-demand library has markers, so the "not in the main bundle"
    // checks below cover all of them.
    expect(Object.keys(LIBRARY_MARKERS).sort()).toEqual([...SEAM_NAMES].sort());
  });

  it("the update engine's sources import core modules as types only, and never emitter/ or export/ (KTD10)", () => {
    const dir = join(PKG_ROOT, "src/renderer/update");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(4); // types, diff, apply, resync, index
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const values = [...code.matchAll(/^import\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]!);
      // Value imports stay inside the engine (./diff, ./apply, ./resync): nothing from the main bundle.
      expect(values.filter((s) => !s.startsWith("./")), file).toEqual([]);
      expect(/["'][^"']*\/(emitter|export)\//.test(code), `${file} reaches emitter/ or export/`).toBe(false);
    }
  });

  it("the TOML reader's sources import core modules as types only (KTD4)", () => {
    const dir = join(PKG_ROOT, "src/parser/toml");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual(["hints.ts", "index-positions.ts", "index.ts", "reader.ts"]);
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const values = [...code.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]!);
      // Value imports stay inside the reader (./…) or are the parser itself.
      expect(values.filter((s) => !s.startsWith("./") && s !== "toml-eslint-parser"), file).toEqual([]);
    }
  });

  it("the converter chunk's sources import core modules as types only (KTD9)", () => {
    const dir = join(PKG_ROOT, "src/convert");
    // The entry half (index.ts reads the text, tree.ts builds the authored
    // tree) may import core; everything chunk.ts reaches may not.
    const chunkFiles = ["chunk.ts", "losses.ts", "print-json.ts", "print-toml.ts", "print-yaml.ts", "types.ts"];
    expect(readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()).toEqual([...chunkFiles, "index.ts", "tree.ts"].sort());
    for (const file of chunkFiles) {
      const code = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const values = [...code.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]!);
      // Value imports stay among the chunk's own files.
      expect(values.filter((s) => !chunkFiles.includes(`${s.replace(/^\.\//, "")}.ts`)), file).toEqual([]);
    }
    // No element reaches convertDocument: only the package index exports it.
    const importers = (dir: string): string[] =>
      readdirSync(join(PKG_ROOT, dir), { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
          ? importers(join(dir, d.name))
          : d.name.endsWith(".ts") && /from\s*["'][^"']*convert(?:\/index)?["']/.test(readFileSync(join(PKG_ROOT, dir, d.name), "utf8"))
            ? [join(dir, d.name)]
            : []
      );
    expect(importers("src").sort()).toEqual(["src/index.ts"]);
  });

  it("describes where each build puts the readers as tsup.config.ts does (ml-cnv.19)", () => {
    const header = readFileSync(join(PKG_ROOT, "src/formats/decoders.ts"), "utf8").split("*/")[0]!;
    const config = readFileSync(join(PKG_ROOT, "tsup.config.ts"), "utf8");
    // The CDN build: chunks/<name>.js; the npm build: formats/<name>.js.
    expect(config).toContain("`dist/chunks/<name>.js`");
    expect(config).toContain("`dist/formats/<name>.js`");
    expect(header).toMatch(/CDN[\s\S]*`dist\/chunks\/<name>\.js`/);
    expect(header).toMatch(/npm \/ bundlers[\s\S]*`dist\/formats\/<name>\.js`/);
    expect(header).not.toMatch(/npm \/ bundlers[^*]*\n \*   `dist\/chunks/);
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
    for (const marker of CODEC_MARKERS) expect(main.includes(marker), `cog codec: ${marker}`).toBe(false);
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

  it("the update engine chunk imports nothing at all and carries no main-bundle wording (KTD10)", () => {
    const code = read("chunks/update.js");
    expect(staticImports(code)).toEqual([]);
    expect(dynamicImports(code)).toEqual([]);
    // Wording only the entry has: the fallback decision and the queue live there, not in the chunk.
    for (const marker of ["setGlobalStateProperty (needs >= 5.6)", "overrides `attributionControl: true`", "Failed to create map"]) {
      expect(code.includes(marker), `chunks/update.js has entry wording: ${marker}`).toBe(false);
    }
    expect(main.includes("so the document's layer is skipped")).toBe(false);
  });

  it("the TOML reader chunk imports nothing at all (KTD4)", () => {
    const code = read("chunks/toml.js");
    expect(staticImports(code)).toEqual([]);
    expect(dynamicImports(code)).toEqual([]);
    // The entry's own wording stays in the entry.
    for (const marker of ["The document is empty. Add a map or a story to it.", "JSON syntax error:"]) {
      expect(code.includes(marker), `chunks/toml.js has entry wording: ${marker}`).toBe(false);
    }
  });

  it("the converter chunk imports nothing at all, and the entry carries none of the converter (KTD9)", () => {
    const code = read("chunks/convert.js");
    expect(staticImports(code)).toEqual([]);
    expect(dynamicImports(code)).toEqual([]);
    // convertDocument's own wording is in neither: no element imports it.
    for (const marker of ["The document could not be converted", "choose yaml, json or toml"]) {
      expect(main.includes(marker), `register.browser.js has ${marker}`).toBe(false);
      expect(code.includes(marker), `chunks/convert.js has ${marker}`).toBe(false);
    }
  });

  it("the COG chunk keeps its heavy codecs in their own files next to it (ml-cnv.11)", () => {
    const cog = read("chunks/cog.js");
    const codecs = ["deflate", "jpeg", "lerc", "zstd"];
    expect(dynamicImports(cog).sort()).toEqual(codecs.map((c) => `./cog-${c}.js`));
    for (const codec of codecs) {
      const code = read(`chunks/cog-${codec}.js`);
      expect(staticImports(code), codec).toEqual([]);
      expect(dynamicImports(code), codec).toEqual([]);
    }
    // The codec libraries are in their files, not in chunks/cog.js.
    expect(read("chunks/cog-lerc.js")).toContain("LercDecode");
    expect(cog.includes("LercDecode")).toBe(false);
    expect(read("chunks/cog-jpeg.js")).toContain("JPEGTables");
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
  const entries = [
    "index.js",
    "register.js",
    "components/index.js",
    "schemas/index.js",
    "scrollytelling/index.js",
    "maplibre.js",
  ];
  /**
   * The entries and every shared module they load statically — what a page
   * using core downloads. Shared modules only a reader reaches (geotiff.js's
   * codec sub-chunks share code with formats/cog.js) load on demand too.
   */
  const npmFiles = built ? staticClosure(entries) : entries;

  it("emits each reader as its own module", () => {
    for (const file of formatFiles) expect(existsSync(join(DIST, file)), file).toBe(true);
  });

  it("no entry or shared module contains a reader, or imports one statically", () => {
    // Not vacuous: the entries do share code through dist/shared/.
    expect(npmFiles.some((f) => f.startsWith("shared/"))).toBe(true);
    for (const file of npmFiles) {
      const code = read(file);
      for (const [name, markers] of Object.entries(LIBRARY_MARKERS)) {
        for (const marker of markers) expect(code.includes(marker), `${file} has ${name}: ${marker}`).toBe(false);
      }
      for (const marker of CODEC_MARKERS) expect(code.includes(marker), `${file} has a cog codec: ${marker}`).toBe(false);
      const statics = staticImports(code).filter((s) => /\/formats\//.test(s));
      expect(statics, file).toEqual([]);
    }
    const dynamic = npmFiles.flatMap((f) => dynamicImports(read(f)));
    for (const name of SEAM_NAMES) expect(dynamic).toContain(`../formats/${name}.js`);
  });
});
