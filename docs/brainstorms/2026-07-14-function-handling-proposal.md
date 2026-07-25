# Proposal: Function Handling in YAML Documents

**Status:** draft v0.2 · **Scope:** policy + mechanisms for user-supplied logic in
`maplibre-yaml` documents, in the library and in mapparty

---

## 1. Problem statement

Tangram's scene files allowed inline JavaScript — `filter: function() { ... }` and
property functions evaluated per feature — and it was one of the platform's most
loved capabilities. It is also, verbatim, a stored-XSS mechanism in any context
where one user's document renders on another user's screen. mapparty is exactly
that context.

This proposal defines how `maplibre-yaml` documents express logic, ordered by trust
required, and states the prohibitions explicitly so they can be cited in reviews.

## 2. Trust model

Three authoring contexts, three trust levels:

| Context | Who writes the YAML | Who renders it | Trust |
|---|---|---|---|
| Self-hosted site (Astro integration) | the developer | their own visitors | full — it's their codebase |
| mapparty collaborative document | any collaborator | all collaborators + public viewers | none — treat as hostile |
| mapparty static export | originally a collaborator | the downloader's audience | none at export time |

The design rule that follows: **the document format itself never carries executable
JavaScript.** Logic is expressed as (a) references to named code that lives outside
the document, or (b) declarative expressions with no host access. A document is
data in every context; only the *host* decides what code names resolve to.

## 3. Pattern 1 — Named hooks (the default)

YAML references a symbol; JavaScript lives in code, registered by the host:

```yaml
runtime:
  interactions:
    parcels:
      on_click: showParcelPopup      # resolved from the handler registry
```

```ts
// host application code (Astro page, mapparty runtime, anywhere)
import { registerHandler } from '@maplibre-yaml/interactions';

registerHandler('showParcelPopup', ({ feature, lngLat, map }) => {
  // arbitrary trusted JS — it shipped with the site, not the document
});
```

Contract details:

- **Resolution is closed-world.** Under `--strict`, a document referencing an
  unregistered handler name fails the build, unless the reference is annotated
  `external: true` (the document declares "the host promises to register this").
  In mapparty, only mapparty-shipped handler names resolve — a document cannot
  smuggle behavior in, only select from the menu the platform provides.
- **Handlers receive a capability object, not the world**: `{ feature, lngLat,
  map, emit }`. `map` is the MapLibre instance (trusted-host contexts) or a
  narrowed facade (mapparty runtime). No DOM handle is ever part of the contract.
- Built-in handlers (`popup`, `highlight`, `zoom-to-feature`, `emit`) cover the
  majority of real interactivity with zero user JS — see the effects/interactions
  proposal §6.

This is the standard pattern in mature config ecosystems (CI pipelines referencing
named actions, serverless frameworks referencing named handlers): configuration
selects, code implements.

## 4. Pattern 2 — Expression DSL (computed values without code)

For computed styling, filtering, and templating, the document uses expressions —
declarative, sandboxed by construction, diffable, and safe in all three trust
contexts.

**4.1 Compile target.** MapLibre's expression language is the target for anything
that can live in `style.json` (data-driven paint, filters). Core's sugar already
compiles friendlier YAML into it:

```yaml
draw:
  fill:
    color:
      by: assessed_value            # sugar →
      scale: { 0: '#f7fbff', 500000: '#08306b' }
# compiles to ["interpolate", ["linear"], ["get","assessed_value"], 0, "#f7fbff", ...]
```

**4.2 Template strings.** Runtime-side text (popups, tooltips, ARIA labels) uses
`{{property}}` interpolation with a small filter set:

```yaml
popup: "{{name}} — {{acres | number:1}} acres ({{status | title}})"
```

Interpolation reads feature properties only; filters are a fixed whitelist
(`number`, `title`, `upper`, `date`, `default:`). No method calls, no property
traversal beyond one level, no host access. Implemented as a ~100-line
tokenizer, not a template library, precisely so its power stays bounded.

**4.3 If a friendlier general expression language is ever needed** (users asking
for arithmetic/conditionals beyond what the sugar covers), adopt an existing
sandboxed expression evaluator (CEL, JSONata, or jexl class) compiled down to
MapLibre expressions where possible and interpreted where not. Decision deferred:
the sugar + templates cover the observed need; adding a second expression language
has real documentation cost. Revisit on evidence.

## 5. Pattern 3 — Sandboxed inline JS (deferred; conditions defined now)

If mapparty tenants eventually need real scripting (custom computed styling beyond
expressions), the *only* acceptable mechanism is an isolated interpreter:

- **Engine:** QuickJS compiled to WebAssembly (`quickjs-emscripten`) — a full JS
  engine in an isolated heap with no ambient host access — executed **inside a
  Web Worker** for scheduling isolation and kill-ability (hard wall-clock budget,
  terminate on overrun).
- **Capability-based API:** the guest receives exactly `{ feature, zoom, globals }`
  in and returns a value out. No `fetch`, no DOM, no message channel beyond the
  typed request/response. The classic failure mode is capability leakage —
  handing the guest a host function "just this once" collapses the sandbox; the
  API surface is reviewed as a security boundary.
- **Not ShadowRealm:** the TC39 proposal remains at Stage 2.7 and unshipped;
  revisit when it lands, as it may eventually simplify the worker layer. Not SES
  lockdown as the primary boundary: same-realm hardening is defense-in-depth, not
  isolation.
- **Placement:** even then, sandboxed functions are a mapparty *app* feature
  (paid tier, per-document opt-in, audit-logged), not part of the open document
  format's baseline — a document using them declares `requires: scripting` so
  every other consumer can refuse or fall back cleanly.

## 6. Prohibitions (citable)

1. **No `eval`, no `new Function`, no dynamic `import()` of document-derived
   strings.** Anywhere. Including "temporarily" and including self-hosted mode —
   the format must mean the same thing in every context.
2. **No inline `function() {}` strings in the schema.** The Tangram affordance is
   explicitly not inherited. A migration guide maps each Tangram function use-case
   to its replacement (filters → expressions; property functions → sugar scales;
   interactivity → named hooks).
3. **No DOM selectors in documents.** `target: '#sidebar .legend'` couples the
   document to one page's markup, breaks silently, and is an injection surface.
   Sanctioned alternatives:
   - the library dispatches `CustomEvent`s on the map container (`emit:` handler);
   - the Astro/React components expose named slots/mount points;
   - the JS API (`mapYaml.on('featureclick', ...)`) for host pages.
   YAML stays declarative about *what*, never *where in the DOM*.
4. **No user GLSL in the SaaS.** Shader `blocks:` remain a possible self-hosted
   "pro mode" only (see effects proposal §9) — a hostile or merely buggy shader
   can hang a GPU, and compile errors surface at runtime on collaborators'
   machines.

## 7. Decision matrix

| Need | Mechanism | Trust required | Available in |
|---|---|---|---|
| Data-driven color/width/filter | expressions (sugar → MapLibre exprs) | none | core |
| Popup/tooltip text | `{{ }}` templates | none | interactions |
| Click/hover behavior from a menu | built-in named hooks | none | interactions |
| Custom behavior, self-hosted site | `registerHandler` + named hook | host-level | interactions |
| Custom behavior, mapparty | platform-shipped hooks only | none | app |
| Arbitrary computed values, mapparty | QuickJS-wasm sandbox (deferred) | opt-in, audited | app (future) |
| Inline JS strings in YAML | — | — | never |
| DOM selectors in YAML | — | — | never |

## 8. Phasing

1. **v1:** named-hook registry + built-ins; `{{ }}` templates; expression sugar in
   core. Migration guide from Tangram function idioms.
2. **v1.x:** `external: true` handler declarations; `emit`/CustomEvent host
   integration documented as *the* interop path.
3. **Deferred, criteria-gated:** general expression language (on evidence of
   need); QuickJS sandbox (on tenant demand, shipped behind the app, with the
   capability API reviewed as a security boundary).