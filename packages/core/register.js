/**
 * Top-level CDN entry point.
 *
 * unpkg.com serves files at the literal path given in the URL and does NOT
 * honor the package.json `exports` field for subpath resolution. Our
 * `./register` export maps to `./dist/register.js`, so the bare URL
 * `https://unpkg.com/@maplibre-yaml/core/register` would otherwise 404
 * (and the 404 response is missing CORS headers, so the browser surfaces
 * it as a CORS error rather than a 404).
 *
 * This file exists so the bare CDN URL resolves correctly. npm / Vite /
 * Webpack consumers use the `./register` exports-field mapping above and
 * never touch this file.
 *
 * Usage from a vanilla HTML page:
 *
 *     <script type="module"
 *             src="https://unpkg.com/@maplibre-yaml/core/register"></script>
 *
 * Auto-registers the `<ml-map>` custom element.
 */
export * from "./dist/register.js";
