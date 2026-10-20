/**
 * @file The one seam every on-demand format library is reached through
 * @module @maplibre-yaml/core/formats/decoders
 *
 * @description
 * The third-party readers behind the cloud-native formats (pmtiles,
 * flatgeobuf, and those still to come) are **not** part of the main bundle.
 * Each is one literal `import()` in {@link LOADERS}, and the build turns each
 * into a file of its own that a page downloads only when a document uses
 * that format:
 *
 * - **CDN / plain HTML** (`register.js` → `dist/register.browser.js`): the
 *   library becomes `dist/chunks/<name>.js`, fetched relative to the bundle's
 *   own URL — so it works from unpkg/jsDelivr, a copied `dist/` folder, or a
 *   GitHub Pages subpath. Self-hosting means copying the whole `dist/`.
 * - **npm / bundlers** (`dist/register.js`, `dist/index.js`): the same
 *   `dist/chunks/<name>.js`, which Vite, Astro and webpack turn into a lazy
 *   chunk of the consumer's build; Node (`mlym emit`, SSR) imports it the
 *   same way.
 * - **`index.browser.js`** (one-file tooling build): inlined, as before.
 *
 * `tsup.config.ts` reads this table: every `name: () => import("spec")` line
 * becomes the chunk `chunks/<name>.js` in both builds (`tests/lazy-chunks`
 * asserts it). The modules that *use* a library — formats/pmtiles.ts,
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
 *    `tests/lazy-chunks.test.ts` fails on that.)
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
 * The on-demand libraries, one literal `import()` each. The key is the
 * chunk's name (`dist/chunks/<key>.js`) and the name {@link getDecoder}
 * takes. Keep one `key: () => import("…")` per line: tsup.config.ts reads
 * these lines.
 */
const LOADERS = {
  pmtiles: () => import("pmtiles"),
  flatgeobuf: () => import("./lib/flatgeobuf"),
  "protomaps-basemap": () => import("@protomaps/basemaps"),
  // Reserved for the 0.9 work in flight — each adds one line shaped like the
  // ones above (see "Adding a format" at the top of this file):
  //   geoparquet          the hyparquet library
  //   cog                 the @geomatico/maplibre-cog-protocol library
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
 * The on-demand library for `name`, downloaded on first use and shared by
 * every map on the page.
 *
 * @throws {FormatError} (code `"chunk"`) when its file can't be downloaded
 *   (offline, a content blocker or CSP, or a self-hosted copy without the
 *   `chunks/` folder). The rejection is not cached: the next call — a
 *   `reload()`, a pan that asks for another tile — tries again.
 */
export function getDecoder<F extends DecodedFormat>(name: F): Promise<Decoders[F]> {
  let pending = loading.get(name) as Promise<Decoders[F]> | undefined;
  if (!pending) {
    pending = (LOADERS[name]() as Promise<Decoders[F]>).catch((error: unknown) => {
      loading.delete(name);
      throw new FormatError({
        code: "chunk",
        format: name as CloudFormat,
        url: failedUrlOf(error) ?? `chunks/${name}.js`,
        detail: String((error as { message?: unknown } | null)?.message ?? error),
      });
    });
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
