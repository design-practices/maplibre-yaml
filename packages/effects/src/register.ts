/**
 * @file `@maplibre-yaml/effects/register` — built-ins + the core hook
 * @module @maplibre-yaml/effects/register
 *
 * @description
 * **Experimental.** Import once per page:
 *
 * ```js
 * import "@maplibre-yaml/core/register";
 * import "@maplibre-yaml/effects/register";
 * ```
 *
 * Registers the built-in effects (`tonal-hatch`, `blueprint`) and installs
 * the effects host core reads, so every `<ml-map>` whose document has
 * `effect:` layers validates their params and attaches the effects once the
 * map loads. Order does not matter: an `<ml-map>` that loaded first attaches
 * as soon as this module runs.
 */

import { effectRegistry } from "./registry";
import { registerBuiltins } from "./builtins";
import { installEffectsHost } from "./host";

registerBuiltins(effectRegistry);
installEffectsHost();

export * from "./index";
