import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { defineConfig, type Options } from "tsup";
import { stripDescribePlugin } from "./scripts/strip-describe";

// ---------------------------------------------------------------------------
// On-demand format libraries (ml-7qa.5)
//
// Every `name: () => import("spec")` line in the seam (src/formats/decoders.ts)
// becomes a file of its own in both builds, so a page downloads the library
// only when a document uses that format:
//
// - CDN build: `dist/chunks/<name>.js`. Built as a separate, self-contained
//   entry (no shared chunks), and the seam's `import("spec")` is rewritten to
//   `import("./chunks/<name>.js")` — relative to `register.browser.js`, so it
//   resolves from unpkg/jsDelivr, a copied `dist/`, or a Pages subpath. The
//   main bundle statically imports nothing but `maplibre-gl`: a page with no
//   cloud-native source makes no extra request. (esbuild's own code splitting
//   would move its runtime helpers into a shared chunk that every page then
//   fetches; tests/lazy-chunks.test.ts guards against that.)
// - npm build: `dist/formats/<name>.js`, via esbuild code splitting (shared
//   code lands in `dist/shared/`). Bundlers turn the `import()` into a lazy
//   chunk of the consumer's app; Node (`mlym emit`, SSR) imports it as is. A
//   seam library that is a runtime `dependency` stays a bare `import("spec")`.
// ---------------------------------------------------------------------------

const SEAM = "src/formats/decoders.ts";

/**
 * The COG library (ml-cnv.2, `chunks/cog.js` / `formats/cog.js`) reads with
 * geotiff.js, which also reads local files and plain-Node HTTP (`fs`,
 * `http`, `https`, `url`) and starts its decoding workers through
 * `web-worker`, whose Node build uses worker_threads. Core only reads COGs
 * in a browser, and the npm build is what Vite/Astro bundle for one: those
 * imports resolve to the browser's own `Worker` and to empty modules
 * instead (the browser builds get the same from geotiff's `browser` field;
 * the plugin keeps them identical).
 */
const geotiffBrowserOnly = {
  name: "geotiff-browser-only",
  setup(build: {
    onResolve: (o: { filter: RegExp }, cb: (args: { path: string; importer: string }) => unknown) => void;
    onLoad: (o: { filter: RegExp; namespace: string }, cb: (args: { path: string }) => unknown) => void;
  }) {
    build.onResolve({ filter: /^(fs|http|https|url|web-worker)$/ }, (args) =>
      /[\\/](geotiff|web-worker)[\\/]/.test(args.importer)
        ? { path: args.path, namespace: "geotiff-browser-only" }
        : undefined
    );
    build.onLoad({ filter: /.*/, namespace: "geotiff-browser-only" }, (args) => ({
      contents:
        args.path === "web-worker"
          ? "export default typeof Worker !== 'undefined' ? Worker : undefined;"
          : "export default {};",
      loader: "js",
    }));
  },
};

/**
 * The story stylesheet, minified (ml-7qa, KTD2), browser builds only:
 * `SCROLLYTELLING_CSS` in `src/scrollytelling/styles.ts` is one readable
 * template literal, comments and all, and esbuild never minifies string
 * contents. As the file loads, the literal becomes a string of the same
 * rules minified by esbuild's own CSS minifier (`build.esbuild`, no extra
 * dependency). The source, its tests (which read the selectors as written)
 * and `dist/scrollytelling.css` (emitted from source) keep the readable form.
 */
const STORY_CSS_FILE = /[\\/]src[\\/]scrollytelling[\\/]styles\.ts$/;
const STORY_CSS_LITERAL = /(export const SCROLLYTELLING_CSS = )`((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`;/;

const minifyStoryCss = {
  name: "maplibre-yaml-minify-story-css",
  setup(build: {
    onLoad: (
      o: { filter: RegExp },
      cb: (args: { path: string }) => Promise<{ contents: string; loader: "ts" }>
    ) => void;
    esbuild: { transform: (input: string, options: { loader: "css"; minify: boolean }) => Promise<{ code: string }> };
  }) {
    build.onLoad({ filter: STORY_CSS_FILE }, async (args) => {
      const source = readFileSync(args.path, "utf8");
      const literal = STORY_CSS_LITERAL.exec(source);
      if (!literal) {
        throw new Error(
          `minify-story-css: ${args.path} no longer has \`export const SCROLLYTELLING_CSS = \`…\`;\` without \${…}; update tsup.config.ts`
        );
      }
      // The template's escapes (`\``, `\\`, `\$`) cooked; any other escape would be a CSS one we can't see here.
      const css = literal[2]!.replace(/\\([\s\S])/g, (_, c: string) => {
        if (c === "`" || c === "\\" || c === "$") return c;
        throw new Error(`minify-story-css: unexpected escape \\${c} in SCROLLYTELLING_CSS`);
      });
      const { code } = await build.esbuild.transform(css, { loader: "css", minify: true });
      return {
        contents: source.replace(literal[0], () => `${literal[1]}${JSON.stringify(code.trim())};`),
        loader: "ts",
      };
    });
  },
};

/** The seam's table: on-demand name → specifier, as written in the `import()`. */
const seam: Record<string, string> = Object.fromEntries(
  [
    ...readFileSync(SEAM, "utf8")
      // Comments don't count: the doc block's example, the reserved lines.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .matchAll(/["']?([a-z][\w-]*)["']?\s*:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g),
  ].map(([, name, spec]) => [name!, spec!])
);

/** An entry point for a specifier written in the seam (paths are relative to it). */
const entryFor = (spec: string) => (spec.startsWith(".") ? resolve("src/formats", spec) : spec);

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
const isDependency = (spec: string) =>
  Object.keys(pkg.dependencies ?? {}).some((d) => spec === d || spec.startsWith(`${d}/`));

/** `{ "<dir>/<name>": entry }` for the seam libraries a build bundles. */
function seamEntries(dir: string, include: (spec: string) => boolean = () => true): Record<string, string> {
  return Object.fromEntries(
    Object.entries(seam)
      .filter(([, spec]) => include(spec))
      .map(([name, spec]) => [`${dir}/${name}`, entryFor(spec)])
  );
}

/**
 * Add entries tsup itself won't accept (it requires files; these are package
 * specifiers). esbuild resolves them exactly as it resolves the seam's
 * `import()`, so the entry and the import are one module.
 */
function addEntries(options: { entryPoints?: unknown }, entries: Record<string, string>): void {
  options.entryPoints = { ...(options.entryPoints as Record<string, string>), ...entries };
}

/**
 * CDN build: the seam's `import("spec")` becomes `import("./chunks/<name>.js")`,
 * external — the chunk is built as its own entry in the same config.
 */
const seamChunksExternal = {
  name: "maplibre-yaml-seam-chunks",
  setup(build: {
    onResolve: (
      o: { filter: RegExp },
      cb: (args: { path: string; importer: string; kind: string }) => { path: string; external: boolean } | undefined
    ) => void;
  }) {
    const bySpec = new Map(Object.entries(seam).map(([name, spec]) => [spec, name]));
    const escaped = [...bySpec.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
    if (escaped.length === 0) return;
    const seamFile = resolve(SEAM);
    build.onResolve({ filter: new RegExp(`^(?:${escaped.join("|")})$`) }, (args) => {
      if (args.kind !== "dynamic-import" || resolve(args.importer) !== seamFile) return undefined;
      return { path: `./chunks/${bySpec.get(args.path)}.js`, external: true };
    });
  },
};

/**
 * The COG chunk's codecs (ml-cnv.11), CDN build only: geotiff.js reaches its
 * per-compression decoders with `import("./<codec>.js")` from
 * `compression/index.js`. Built into `chunks/cog.js` they would be inlined;
 * instead each heavy one becomes its own file next to it,
 * `chunks/cog-<codec>.js` — stable names, loaded relative to `chunks/cog.js`
 * only when the main thread decodes that compression. Each is a
 * self-contained entry (its small shared helpers are duplicated), so nothing
 * else on the page — and no other format's chunk — changes. The npm build
 * already splits these (`dist/shared/`).
 */
const COG_CODECS = ["deflate", "jpeg", "lerc", "zstd"] as const;

/** geotiff.js's `compression/` folder, as esbuild resolves it for the COG library (its ESM build). */
function geotiffCompressionDir(): string {
  const plugin = realpathSync(resolve("node_modules/@geomatico/maplibre-cog-protocol"));
  const main = createRequire(join(plugin, "package.json")).resolve("geotiff");
  // …/geotiff/dist-node/geotiff.js → …/geotiff/dist-module/compression
  return join(dirname(dirname(main)), "dist-module", "compression");
}

const cogCodecChunks = {
  name: "maplibre-yaml-cog-codecs",
  setup(build: {
    onResolve: (
      o: { filter: RegExp },
      cb: (args: { path: string; importer: string; kind: string }) => { path: string; external: boolean } | undefined
    ) => void;
  }) {
    const filter = new RegExp(`^\\./(${COG_CODECS.join("|")})\\.js$`);
    build.onResolve({ filter }, (args) => {
      if (args.kind !== "dynamic-import" || !/[\\/]geotiff[\\/]dist-module[\\/]compression[\\/]index\.js$/.test(args.importer)) {
        return undefined;
      }
      return { path: `./cog-${filter.exec(args.path)![1]}.js`, external: true };
    });
  },
};

/** `{ "chunks/cog-<codec>": file }` for the CDN build. */
function cogCodecEntries(): Record<string, string> {
  const dir = geotiffCompressionDir();
  return Object.fromEntries(COG_CODECS.map((c) => [`chunks/cog-${c}`, join(dir, `${c}.js`)]));
}

/** The npm build's public entries (and the only ones with declarations). */
const NPM_ENTRIES = {
  index: "src/index.ts",
  "schemas/index": "src/schemas/index.ts",
  "components/index": "src/components/index.ts",
  // The DOM-free scrollytelling engine + renderers (server-safe: Astro
  // frontmatter imports it; the element lives in components/register).
  "scrollytelling/index": "src/scrollytelling/index.ts",
  register: "src/register.ts",
  maplibre: "src/maplibre.ts",
  // Types-only entry (React JSX typings). Its JS output is an empty
  // module; it exists so `import "@maplibre-yaml/core/react"` resolves
  // in bundlers as well as in tsc.
  react: "src/react.ts",
};

export default defineConfig([
  // Main build for Node.js/bundlers
  {
    entry: NPM_ENTRIES,
    format: ["esm"],
    dts: { entry: NPM_ENTRIES },
    clean: true,
    sourcemap: true,
    // On (ml-7qa.5): with it off, esbuild inlines every `import()` of a
    // bundled module and the format libraries would load eagerly. The
    // entries now share common code through `dist/shared/*.js`.
    splitting: true,
    treeshake: true,
    // `react` is only ever imported for types (src/react.ts); keep the
    // declaration bundler from inlining @types/react into dist/react.d.ts.
    // `@bokuweb/zstd-wasm` (flatgeobuf's codec for the rare seekable-zstd
    // variant, reached by a dynamic import) stays a real dependency: a
    // bundler resolving this build (Vite's dependency optimizer) must find it.
    external: ["maplibre-gl", "react", "@bokuweb/zstd-wasm"],
    // The cloud-native decoders are bundled here too (into dist/formats/),
    // as in the browser build, and are devDependencies: flatgeobuf declares
    // OpenLayers (`ol`, ~30 MB with geotiff) as an optional dependency, which
    // npm installs, so depending on it put that tree under every core, astro
    // and cli install. Bundled, only the code core uses ships.
    noExternal: [
      "pmtiles",
      "fflate",
      "flatgeobuf",
      "flatbuffers",
      "slice-source",
      "@repeaterjs/repeater",
      // GeoParquet's reader (formats/lib/geoparquet*): devDependencies,
      // bundled into its on-demand module like the others.
      "hyparquet",
      "hyparquet-compressors",
      "fzstd",
      // The TOML reader (parser/toml, the `toml` chunk): a devDependency
      // bundled into its on-demand module, with its one dependency.
      "toml-eslint-parser",
      "eslint-visitor-keys",
    ],
    esbuildPlugins: [geotiffBrowserOnly as never],
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Declarative web maps with YAML",
      };
      // fflate's `node` build (resolved on this platform) opens with
      // `createRequire` from "module" for worker_threads, which breaks this
      // build in every browser bundler. Its plain-ESM `browser` build works
      // in Node too (pmtiles uses only the synchronous decoder).
      options.alias = { ...(options.alias ?? {}), fflate: "fflate/browser" };
      options.chunkNames = "shared/[name]-[hash]";
      addEntries(options, seamEntries("formats", (spec) => !isDependency(spec)));
    },
  },
  // Browser/CDN build of `register` — what `register.js` (the unpkg root
  // shim) and `<script type="module">` pages load — plus the seam's
  // libraries as `chunks/<name>.js`, each self-contained (no splitting).
  browserBuild({ "register.browser": "src/register.ts" }, true),
  // The full public API, browser-bundled, as ONE file (tooling pages want
  // one file; the seam's `import()`s are inlined). `index.js` bare-imports
  // yaml/zod which no browser resolves; this is what a page importing the
  // emitter, parser, or model directly (rather than the `<ml-map>` component)
  // loads. The export-proof browser demo is the motivating consumer: it
  // compiles a document and renders the output in vanilla maplibre-gl.
  browserBuild({ "index.browser": "src/index.ts" }, false),
]);

/** A browser build (bundled dependencies, minified, maplibre-gl external). */
function browserBuild(entry: Record<string, string>, chunks: boolean): Options {
  return {
    entry,
    format: ["esm"],
    // Resolve bundled deps via their browser conditions: without this,
    // esbuild pulls in yaml's Node CJS entry, which calls require("process")
    // and throws "Dynamic require of 'process' is not supported" the moment
    // a real browser loads the bundle.
    platform: "browser",
    dts: false,
    clean: false,
    sourcemap: true,
    // Off: each entry (the bundle, each chunk) is one self-contained file.
    splitting: false,
    treeshake: true,
    minify: true, // CDN-served raw from unpkg — ship it minified
    external: ["maplibre-gl"],
    // Bundle these for browser: a plain page resolves only `maplibre-gl`
    // (its import map). The seam's libraries are bundled into their chunks.
    noExternal: [
      "yaml",
      "zod",
      "fflate",
      "flatbuffers",
      "slice-source",
      "@repeaterjs/repeater",
      "hyparquet",
      "hyparquet-compressors",
      "fzstd",
      "toml-eslint-parser",
      "eslint-visitor-keys",
      // The PMTiles reader: the seam names its adapter (formats/lib/pmtiles),
      // which re-exports the library, so the package is listed here itself.
      "pmtiles",
      // Resolved to the stub below (the alias), not the package.
      "@bokuweb/zstd-wasm",
      ...Object.values(seam).filter((spec) => !spec.startsWith(".")),
    ],
    esbuildPlugins: [
      geotiffBrowserOnly as never,
      minifyStoryCss as never,
      // The CDN entry only: index.browser.js (tooling pages, not size-gated)
      // keeps its schema descriptions, as the npm build does.
      ...(chunks ? [seamChunksExternal as never, cogCodecChunks as never, stripDescribePlugin as never] : []),
    ],
    esbuildOptions(options) {
      options.banner = {
        js: "// @maplibre-yaml/core - Browser build with bundled dependencies",
      };
      // `@bokuweb/zstd-wasm` is flatgeobuf's codec for seekable-zstd files,
      // reached only through a dynamic import that maplibre-yaml never
      // triggers (compressed files are refused with a plain notice). A CDN
      // page cannot resolve the bare specifier, so here it resolves to a stub
      // that fails plainly (ml-aot.109); bundler builds keep the dependency.
      options.alias = {
        ...(options.alias ?? {}),
        "@bokuweb/zstd-wasm": "./src/formats/zstd-unavailable.ts",
      };
      if (chunks) addEntries(options, { ...seamEntries("chunks"), ...cogCodecEntries() });
    },
  };
}
