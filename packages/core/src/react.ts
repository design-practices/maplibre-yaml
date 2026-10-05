/**
 * @file React JSX typings for `<ml-map>`
 * @module @maplibre-yaml/core/react
 *
 * @description
 * Teaches React's JSX types about the `<ml-map>` custom element. Types only:
 * the compiled module is empty, so importing it costs nothing at runtime and
 * it never pulls in `react` (non-React consumers never resolve it at all,
 * because they never import this entry).
 *
 * Reference it once in your project, for example in `src/vite-env.d.ts`:
 *
 * ```ts
 * /// <reference types="@maplibre-yaml/core/react" />
 * ```
 *
 * or as an import in any module (`import "@maplibre-yaml/core/react";`).
 *
 * ## What it types
 *
 * - `src` — URL of a YAML document.
 * - `config` — on React 19 a `MapBlock` object or its JSON string (React 19
 *   sets it as a property); on React 18 a JSON string only, because React 18
 *   sets unknown props on custom elements as attributes and an object would
 *   arrive as `"[object Object]"`.
 * - `ref` — `useRef<MLMap>(null)`, so `ref.current.mapReady()` is typed.
 * - `onml-map:*` event props (React 19 only; React 18 ignores them), each
 *   typed with its `CustomEvent` detail from {@link MLMapEventMap}.
 * - `children` — slot children (`<div slot="top-right">`) and an inline
 *   `<script type="text/yaml">`, through the standard HTML attributes.
 *
 * Works with `@types/react` 18 and 19. The React major is detected from the
 * types themselves: `@types/react` 19 is the first to export `use`.
 */

import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type * as ReactTypes from "react";
import type { MLMap, MLMapEventMap } from "./components/ml-map.js";
import type { MapBlock } from "./parser/yaml-parser.js";

export type { MLMap, MLMapEventMap } from "./components/ml-map.js";

/**
 * `true` when the installed `@types/react` describes React 19 or later.
 * React 19 is the first major whose types export `use`; it is also the first
 * that sets custom-element props as properties and binds `on*` props to
 * custom events, which is what the props below depend on.
 */
export type IsReact19Types = "use" extends keyof typeof ReactTypes
  ? true
  : false;

/**
 * React 19 event props: `onml-map:load`, `onml-map:layer-click`, and so on,
 * one per {@link MLMapEventMap} entry, each receiving its typed
 * `CustomEvent`.
 */
export type MLMapEventProps = {
  [K in keyof MLMapEventMap as `on${K}`]?: (event: MLMapEventMap[K]) => void;
};

/** The props `<ml-map>` accepts in JSX, for the installed React major. */
export type MLMapProps = DetailedHTMLProps<HTMLAttributes<MLMap>, MLMap> & {
  /** URL of a YAML map document, fetched when the element connects. */
  src?: string;
  /**
   * The map document. React 19: a `MapBlock` object (keep its identity
   * stable, or pass a JSON string) or a JSON string. React 18: a JSON
   * string only (`JSON.stringify(config)`).
   */
  config?: IsReact19Types extends true ? MapBlock | string : string;
} & (IsReact19Types extends true ? MLMapEventProps : unknown);

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ml-map": MLMapProps;
    }
  }
}
