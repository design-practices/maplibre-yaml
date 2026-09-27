// Top-level re-export so unpkg's bare `/maplibre` URL resolves, mirroring
// register.js (unpkg ignores package.json `exports` for subpaths; npm/Vite
// consumers use the `./maplibre` exports mapping and never touch this file).
// dist/maplibre.js's only bare specifier is `maplibre-gl`, which the
// documented import map provides, so a plain `<script type="module">` can
// load it directly.
export * from "./dist/maplibre.js";
export { default } from "./dist/maplibre.js";
