---
"@maplibre-yaml/core": minor
---

Converge the two interaction-binding code paths onto one shared per-layer core
(ml-wx2). The renderer's `EventHandler` and the standalone `attachInteractions`
were hand-maintained copies of the `map.on` binding + dispatch + cursor logic;
they now share a single `bindLayerInteractions` core, so a change to what is
bound or how it dispatches is made once. `attachInteractions` gains an optional
raw-event callback hook (its public, additive surface change). As a consequence,
the `emit` interaction's trust gate is now honored on the shared path under the
renderer too.

No `<ml-map>` behavior change: `MapRenderer` still supplies the default
untrusted policy and no host handlers, so `click.emit` remains inert under
`<ml-map>` exactly as before (fail-closed, pinned by a regression test). Making
`click.emit` live under `<ml-map>` — an embedder trust surface plus a DOM
`CustomEvent` bridge — is a tracked follow-up.

One API-level behavior change to note (not reachable through `<ml-map>`): because
the `emit` trust gate is now honored on the shared path, a consumer that
constructs `MapRenderer`/`EventHandler` directly with a **trusted** `capabilities`
policy and a `click.emit` will now see it act — dispatching to a registered host
handler, or logging a one-time missing-handler warning when none is registered —
where before it was unconditionally inert. `<ml-map>` never sets a trusted policy,
so this affects only direct programmatic embedders.
