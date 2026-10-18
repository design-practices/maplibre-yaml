/**
 * @file Prefix a site-root path with Astro's `base`
 * @module @maplibre-yaml/astro/utils/base-url
 *
 * @description
 * A site deployed under a subpath -- a GitHub Pages project site is served
 * from `https://<user>.github.io/<repo>/` and configured with
 * `base: '/<repo>'` -- serves `public/configs/map.yaml` at
 * `/<repo>/configs/map.yaml`. Astro rewrites its own asset URLs for that, but
 * a `src="/configs/map.yaml"` prop is just a string, so `<ml-map>` fetched
 * `/configs/map.yaml` and 404'd (ml-aot.21). The components run their `src`
 * through {@link withBase}.
 *
 * @internal
 */

/**
 * Prefix a root-relative path (`/configs/map.yaml`) with the site's base path.
 *
 * @param path - The URL or path as the author wrote it.
 * @param base - Astro's `import.meta.env.BASE_URL` (`/`, `/repo`, `/repo/`).
 * @returns The path under the base. Unchanged when there is no base (`/`),
 *   when it is not root-relative (absolute `https://…`, protocol-relative
 *   `//cdn…`, `./relative`, `data:`), or when it already starts with the base
 *   -- so writing the base out yourself (`/repo/configs/map.yaml`) is never
 *   doubled.
 *
 * @example
 * ```ts
 * withBase("/configs/map.yaml", "/my-repo");       // "/my-repo/configs/map.yaml"
 * withBase("/my-repo/configs/map.yaml", "/my-repo/"); // unchanged
 * withBase("https://example.com/map.yaml", "/my-repo"); // unchanged
 * withBase("/configs/map.yaml", "/");             // unchanged
 * ```
 */
export function withBase(path: string, base: string | undefined): string;
export function withBase(path: string | undefined, base: string | undefined): string | undefined;
export function withBase(path: string | undefined, base: string | undefined): string | undefined {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return path;
  const prefix = normalizeBase(base);
  if (!prefix) return path;
  if (path === prefix || hasPrefix(path, prefix)) return path;
  return prefix + path;
}

/** `"/repo/"`, `"repo"`, `"/repo"` -> `"/repo"`; `"/"`, `""`, `undefined` -> `""`. */
function normalizeBase(base: string | undefined): string {
  if (!base) return "";
  const trimmed = base.replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Whether `path` is `prefix` followed by a path, query or fragment boundary. */
function hasPrefix(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === "/" || next === "?" || next === "#";
}
