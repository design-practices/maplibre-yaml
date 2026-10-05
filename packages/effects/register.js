// Top-level re-export so unpkg's bare `/register` URL resolves (unpkg ignores
// package.json `exports` for subpaths); npm/Vite consumers use the
// `./register` exports mapping and never touch this file. Points at the
// browser build (zod inlined) so a plain `<script type="module">` loads it.
export * from "./dist/register.browser.js";
