/**
 * @file When the page shows author hints (ml-aot.57)
 * @module @maplibre-yaml/core/components/author-hints
 *
 * @description
 * The on-page notice carries two kinds of line:
 *
 * - **failures**: part of the map did not load (a data file that 404'd, a
 *   layer MapLibre rejected, an image that failed). These ALWAYS show, as a
 *   plain line for the visitor with the author's detail under "Details for
 *   the site's author" — a failure that only happens on the deployed site
 *   (a GitHub Pages base path) has to be visible there.
 * - **author hints**: the map works, but the document probably does not say
 *   what its author meant (a did-you-mean, a key nested under `config:`, a
 *   `fitTo` typo, coordinates written [latitude, longitude], a string
 *   starting with the reserved `=`). Readers of a finished site have no use
 *   for these, so they show only while the author is developing.
 *
 * {@link showAuthorHints} is the one place that decides "developing". Every
 * element asks it; nothing else reads the hostname or the build mode, so the
 * rules below change in one spot (and a wrapper — translated strings, a host
 * app's own policy — wraps one function).
 *
 * The console is not affected: every hint is still logged as before.
 */

import { isLocalPage } from "./map-notice.js";

/** Why {@link authorHintsDecision} decided as it did. */
export type AuthorHintsReason =
  /** `quiet` hides every on-page notice, hints included. */
  | "quiet"
  /** The element (or its story) has the `debug` attribute. */
  | "debug"
  /** The page is served from this computer: localhost, *.localhost, 127.x, [::1], 0.0.0.0, [::], file:. */
  | "local"
  /** A bundler development build (Vite/Astro `import.meta.env.DEV`). */
  | "dev-build"
  /** None of the above: a published site, hints hidden. */
  | "published";

/** The decision and its reason, for tests and for wrappers that log it. */
export interface AuthorHintsDecision {
  show: boolean;
  reason: AuthorHintsReason;
}

/**
 * Set by `@maplibre-yaml/astro`'s client script in `astro dev` only (its
 * `import.meta.env.DEV` is reliably replaced in a component script, while a
 * pre-bundled dependency's may not be). Internal: not a public switch —
 * pages use the `debug` attribute.
 */
const DEV_FLAG = "__MAPLIBRE_YAML_DEV__";

let devBuildOverride: boolean | undefined;

/**
 * Whether this code runs in a bundler's development build.
 *
 * @remarks
 * Vite (and so Astro) replaces `import.meta.env.DEV` with `false` in a
 * production build and sets it `true` under the dev server. A plain browser
 * loading the CDN build has no `import.meta.env` at all, so this is `false`
 * there and the hostname rule decides.
 */
export function isBundlerDevBuild(): boolean {
  try {
    if ((globalThis as Record<string, unknown>)[DEV_FLAG] === true) return true;
  } catch {
    /* no globalThis: fall through */
  }
  if (devBuildOverride !== undefined) return devBuildOverride;
  try {
    const env = (import.meta as unknown as { env?: { DEV?: unknown } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
}

/**
 * Pin what `import.meta.env.DEV` reads as (tests: vitest itself runs as a
 * dev build). `undefined` restores detection. The Astro flag still counts.
 *
 * @internal
 */
export function _setBundlerDevBuildForTesting(value: boolean | undefined): void {
  devBuildOverride = value;
}

/**
 * Whether an element shows author hints, and why.
 *
 * @param host - The `<ml-map>` or `<ml-scrollytelling>` that would show them.
 *
 * @remarks
 * In order: `quiet` hides everything; `debug` (on the element, or on the
 * `<ml-scrollytelling>` it belongs to) shows hints anywhere; otherwise they
 * show on a page served from this computer and in a bundler dev build, and
 * stay hidden on a published site.
 */
export function authorHintsDecision(host: Element): AuthorHintsDecision {
  if (host.hasAttribute("quiet")) return { show: false, reason: "quiet" };
  if (host.hasAttribute("debug") || host.closest?.("ml-scrollytelling[debug]")) {
    return { show: true, reason: "debug" };
  }
  if (isLocalPage(host.ownerDocument)) return { show: true, reason: "local" };
  if (isBundlerDevBuild()) return { show: true, reason: "dev-build" };
  return { show: false, reason: "published" };
}

/** Whether `host` shows author hints on the page (see {@link authorHintsDecision}). */
export function showAuthorHints(host: Element): boolean {
  return authorHintsDecision(host).show;
}
