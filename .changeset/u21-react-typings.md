---
"@maplibre-yaml/core": minor
---

React typings for `<ml-map>` ship from core: add `/// <reference types="@maplibre-yaml/core/react" />` (or `import "@maplibre-yaml/core/react"`) once and `tsc` accepts `<ml-map>` in JSX, replacing the hand-written declaration the docs used to ask for. The entry is types only (an empty module at runtime) and works with `@types/react` 18 and 19, adapting to the one installed: `src`, `config`, a `ref` typed as `MLMap`, slot children and an inline YAML `<script>` on both; on React 19 an object `config` and `onml-map:*` event props typed with each event's `detail`; on React 18 an object `config` is a type error, since React 18 would stringify it to `"[object Object]"`. The new `MLMapEventMap` type (exported from `@maplibre-yaml/core/register`) names every `ml-map:*` event with its `detail`, and `MLMap#addEventListener` is now typed by it, so `el.addEventListener("ml-map:layer-click", (e) => e.detail.layerId)` needs no cast in any framework.
