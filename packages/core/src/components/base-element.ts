/**
 * @file A server-safe base class for the custom elements
 * @module @maplibre-yaml/core/components
 *
 * @description
 * `class X extends HTMLElement` evaluates `HTMLElement` when the module
 * loads, so a plain `extends HTMLElement` throws `ReferenceError:
 * HTMLElement is not defined` the moment a server (Node SSR: Next.js,
 * SvelteKit, Nuxt, Astro frontmatter) imports `@maplibre-yaml/core/register`
 * or `/components` — before any `typeof window` guard can run.
 *
 * The elements extend this instead. In a browser (and in jsdom) it IS
 * `HTMLElement`, so nothing changes there; on a server it is an empty class,
 * so the module evaluates and the element class exists, but it is never
 * defined as a custom element — registration stays browser-gated
 * (`registerMLMap()`, `registerMLScrollytelling()`).
 */
export const BaseElement: typeof HTMLElement =
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ??
  (class {} as unknown as typeof HTMLElement);
