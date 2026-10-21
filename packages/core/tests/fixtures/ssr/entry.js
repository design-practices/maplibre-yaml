// A server-evaluated module, as an SSR framework (SvelteKit, Nuxt, Next.js)
// would load one: it imports the element entry points at module scope.
import "@maplibre-yaml/core/register";
export { MLMap, MLScrollytelling, registerMLMap } from "@maplibre-yaml/core/register";
export * as components from "@maplibre-yaml/core/components";
