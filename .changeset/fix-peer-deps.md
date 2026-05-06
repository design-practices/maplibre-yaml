---
"@maplibre-yaml/astro": patch
"@maplibre-yaml/core": patch
---

Fix maplibre-gl v5 compatibility and peer dependency ranges

### Bug fixes

- **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
- **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
- **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
- **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.
