---
"@maplibre-yaml/core": minor
---

Every construct in the format now declares its eject class — ejects, ejects
via fallback, or declared absence — in a closed-world registry
(`ejectClasses`, exported). `mlym emit` reports declared absences instead of
silently dropping them: chrome that previously vanished from emitted styles
with no trace (`controls:`, `legend:`, layer `interactive:`/`toggleable:`,
`parameters:`, stripped `x-*` extension blocks) now arrives as `contract`
warnings naming the construct and what emit did with it.

Consumer-visible changes to `EmitResult.warnings`: warnings are now emitted
**per construct** (path `layers.<id>.<key>`, `sources.<name>.<key>`) instead
of one grouped warning per layer/source, and registry-driven warnings carry
two new machine-readable fields — `construct` (e.g. `"layer.interactive"`)
and `ejectClass` — so programmatic consumers no longer parse message prose.
Schema-default keys the author never wrote (`toggleable: true`,
`fetchStrategy: "runtime"`, `interactive: true`) no longer generate warning
noise. An inline live source with no compile-time data is now `lossy` (fails
`--strict`), matching its named-source twin. Unknown runtime keys in
passthrough positions warn and never throw; the one new throw
(`EmitError`) fires only when a key from core's own closed runtime lists is
missing its registration — a code bug, not a document condition. Documented
at `/guides/eject-classes/`, with drift tests binding the docs table (names
AND classes) and the model's runtime-key boundaries to the registry.
