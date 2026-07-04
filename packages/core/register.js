// Top-level re-export so unpkg's bare `/register` URL resolves. unpkg
// ignores package.json `exports` for subpaths; npm/Vite/Webpack consumers
// use the `./register` exports mapping and never touch this file.
// Points at the browser build (yaml + zod inlined) so a plain
// `<script type="module">` can load it — its only bare specifier is
// `maplibre-gl`, which the documented import map provides.
// See issue #33 / changeset for full context.
export * from "./dist/register.browser.js";
