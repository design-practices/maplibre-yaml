/**
 * @file The one seam every on-demand library is reached through
 * @module @maplibre-yaml/core/formats/decoders
 *
 * @description
 * The third-party readers behind the cloud-native formats (pmtiles,
 * flatgeobuf, and those still to come) and the library's own update engine
 * (renderer/update, live documents) are **not** part of the main bundle.
 * Each is one literal `import()` in {@link LOADERS}, and the build turns each
 * into a file of its own that a page downloads only when a document uses
 * that format — or, for the engine, when a running map is first given a
 * changed document:
 *
 * - **CDN / plain HTML** (`register.js` → `dist/register.browser.js`): the
 *   library becomes `dist/chunks/<name>.js`, fetched relative to the bundle's
 *   own URL — so it works from unpkg/jsDelivr, a copied `dist/` folder, or a
 *   GitHub Pages subpath. Self-hosting means copying the whole `dist/`.
 * - **npm / bundlers** (`dist/register.js`, `dist/index.js`):
 *   `dist/formats/<name>.js` (code they share in `dist/shared/`), which Vite,
 *   Astro and webpack turn into a lazy chunk of the consumer's build; Node
 *   (`mlym emit`, SSR) imports it the same way.
 * - **`index.browser.js`** (one-file tooling build): inlined, as before.
 *
 * `tsup.config.ts` reads this table: every `name: () => import("spec")` line
 * becomes `chunks/<name>.js` in the CDN build and `formats/<name>.js` in the
 * npm build (`tests/lazy-chunks` asserts both). The modules that *use* a library — formats/pmtiles.ts,
 * formats/flatgeobuf.ts — stay in the main bundle, are small, and reach the
 * library only through {@link getDecoder}. That split is deliberate: a chunk
 * holding only third-party code shares nothing with the main bundle, so
 * esbuild emits no shared chunk and a page with no cloud-native source makes
 * zero extra requests.
 *
 * ## Adding a format (geoparquet, cog, protomaps-basemap, …)
 *
 * 1. Add **one line** to {@link LOADERS}: `geoparquet: () => import("hyparquet"),`
 *    — a literal specifier (bare package or a path), nothing computed. The
 *    library may be a devDependency (bundled into the chunk, like pmtiles)
 *    or a dependency (the CDN chunk bundles it; the npm build keeps the bare
 *    `import()` for the consumer's bundler).
 * 2. In your own module (e.g. `formats/geoparquet.ts`), get the library with
 *    `const { parquetReadObjects } = await getDecoder("geoparquet");`. Import
 *    only **types** from the library statically (`import type …`): a value
 *    import would pull the library back into the main bundle.
 * 3. Never import core modules from the library side, and never import
 *    maplibre-gl there: what a reader needs from maplibre-gl is injected.
 *    (A non-type import of core code from inside a chunk makes esbuild move
 *    the shared code into a third file every page then downloads;
 *    `tests/lazy-chunks.test.ts` fails on that.) The update engine follows
 *    the same rule from the other side: it is core code, reached through
 *    `getDecoder("update")`, and it imports core modules as types only —
 *    the renderer hands it everything it touches (`UpdateHost`).
 * 4. A failure to download the chunk rejects {@link getDecoder} with a
 *    {@link FormatError} of code `"chunk"` whose message names the file and
 *    says to copy the whole `dist/` folder or use the CDN. Report it on the
 *    affected source only (the notice path), as pmtiles/flatgeobuf do.
 *
 * Anything that must happen synchronously (registering a URL protocol before
 * `new Map()`) registers a thin handler at once and awaits the library inside
 * it — see formats/pmtiles.ts.
 */

import { FormatError } from "./errors";
import type { CloudFormat } from "./detect";

/**
 * What formats/cog.ts calls in the `cog` chunk (formats/lib/cog.ts), named
 * here: `@geomatico/maplibre-cog-protocol`'s own declaration types can't be
 * named from core's emitted declarations (TS2742).
 */
interface CogLibrary {
  cogProtocol: (params: { url: string; type?: string }) => Promise<{ data: unknown }>;
  readCogHeader: typeof import("./cog-header").readCogHeader;
  readCogHeaderParts: typeof import("./cog-header").readCogHeaderParts;
  isCloudOptimized: typeof import("./cog-header").isCloudOptimized;
  shareFirstBlock: typeof import("./lib/cog-first-block").shareFirstBlock;
  dropFirstBlock: typeof import("./lib/cog-first-block").dropFirstBlock;
}

/**
 * The on-demand libraries, one literal `import()` each. The key is the
 * chunk's name (`dist/chunks/<key>.js`) and the name {@link getDecoder}
 * takes. Keep one `key: () => import("…")` per line: tsup.config.ts reads
 * these lines.
 */
const LOADERS = {
  pmtiles: () => import("pmtiles"),
  flatgeobuf: () => import("./lib/flatgeobuf"),
  "protomaps-basemap": () => import("@protomaps/basemaps"),
  geoparquet: () => import("./lib/geoparquet"),
  // Brotli's decoder is mostly a dictionary (~68 KB gzip): its own chunk,
  // fetched only for a GeoParquet file whose footer says brotli.
  "geoparquet-brotli": () => import("./lib/geoparquet-brotli"),
  cog: () => import("./lib/cog") as Promise<CogLibrary>,
  // The live-documents update engine (renderer/update, 0.10): the differ,
  // the apply step and the runtime re-sync, awaited by `MapRenderer.update`
  // on a running map's first changed document.
  update: () => import("../renderer/update/index"),
  // The TOML reader (parser/toml, 0.10): toml-eslint-parser plus the walk
  // that builds the value, its positions and the TOML hints, awaited by
  // `parseDocumentText` for the first TOML document a page reads.
  toml: () => import("../parser/toml/index"),
} satisfies Record<string, () => Promise<unknown>>;

/** The library module behind each on-demand name. */
export type Decoders = { [K in keyof typeof LOADERS]: Awaited<ReturnType<(typeof LOADERS)[K]>> };

/** The names {@link getDecoder} can load. */
export type DecodedFormat = keyof Decoders;

/** In-flight or settled loads, one per name per page. A failure is evicted. */
const loading = new Map<DecodedFormat, Promise<unknown>>();

/**
 * The URL a failed dynamic import names, when the browser says (Chromium:
 * "Failed to fetch dynamically imported module: <url>", Firefox: "error
 * loading dynamically imported module: <url>"). Safari names none.
 */
function failedUrlOf(error: unknown): string | undefined {
  for (let e = error, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const message = String((e as { message?: unknown }).message ?? e);
    const url = /\b(?:https?|file):\/\/\S+?\.m?js\b/.exec(message)?.[0];
    if (url) return url;
  }
  return undefined;
}

/**
 * The file a reader failed to download from, and how many times: what the
 * next attempt asks for again.
 */
const failedFiles = new Map<DecodedFormat, { url: string; attempts: number }>();

/**
 * Ask again for a reader file that failed. A browser keeps a failed dynamic
 * import in its module map — `import()` of the same URL rejects again with
 * no request at all (Chromium, Firefox) — so the retry asks for the same file
 * under a URL of its own (`?retry=<n>`). A test seam, hence an object.
 *
 * @internal
 */
export const reimport = {
  load: (url: string): Promise<unknown> => import(/* @vite-ignore */ /* webpackIgnore: true */ url),
};

/** `url` (a reader file, no query of its own) asked for afresh: `?retry=<attempt>`. */
function retryUrl(url: string, attempt: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}`;
}

/**
 * The on-demand library for `name`, downloaded on first use and shared by
 * every map on the page.
 *
 * @throws {FormatError} (code `"chunk"`) when its file can't be downloaded
 *   (offline, a content blocker or CSP, or a self-hosted copy without the
 *   `chunks/` folder). The rejection is not kept: the next call — a
 *   `reload()`, a pan that asks for another tile — downloads the file again
 *   (under a `?retry=` URL where the browser named the file, since it would
 *   otherwise repeat the failure without asking).
 */
export function getDecoder<F extends DecodedFormat>(name: F): Promise<Decoders[F]> {
  let pending = loading.get(name) as Promise<Decoders[F]> | undefined;
  if (!pending) {
    const failed = failedFiles.get(name);
    const load = failed
      ? () => reimport.load(retryUrl(failed.url, failed.attempts)) as Promise<Decoders[F]>
      : (LOADERS[name] as () => Promise<Decoders[F]>);
    pending = load().then(
      (library) => {
        failedFiles.delete(name);
        return library;
      },
      (error: unknown) => {
        loading.delete(name);
        // The file as the browser named it (its URL ends at `.js`: a retry's
        // query is not part of it), else the one already known.
        const file = failedUrlOf(error) ?? failed?.url;
        if (file) failedFiles.set(name, { url: file, attempts: (failed?.attempts ?? 0) + 1 });
        throw new FormatError({
          code: "chunk",
          format: name as CloudFormat,
          url: file ?? `chunks/${name}.js`,
          detail: String((error as { message?: unknown } | null)?.message ?? error),
        });
      }
    );
    loading.set(name, pending);
  }
  return pending;
}

/**
 * Start downloading `name`'s library without waiting for it (a document that
 * will need it, seen at parse time). Never rejects: the caller that actually
 * needs the library awaits {@link getDecoder} and reports the failure there.
 */
export function prefetchDecoder(name: DecodedFormat): void {
  getDecoder(name).catch(() => undefined);
}

/** Whether this version has a reader for `format`. */
export function hasDecoder(format: CloudFormat): format is CloudFormat & DecodedFormat {
  return Object.prototype.hasOwnProperty.call(LOADERS, format);
}
