// Top-level re-export so unpkg's bare `/register` URL resolves. unpkg
// ignores package.json `exports` for subpaths; npm/Vite/Webpack consumers
// use the `./register` exports mapping and never touch this file.
// See issue #33 / changeset for full context.
export * from "./dist/register.js";
