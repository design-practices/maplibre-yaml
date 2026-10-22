---
"@maplibre-yaml/core": patch
---

Importing `@maplibre-yaml/core/register` or `@maplibre-yaml/core/components` during server-side rendering (Next.js, SvelteKit, Nuxt, Astro) no longer throws `ReferenceError: HTMLElement is not defined`. The modules now load in Node, and `<ml-map>` and `<ml-scrollytelling>` register in the browser as before. A server-evaluated module can import these entry points without a client-only workaround.
