---
"@maplibre-yaml/core": minor
---

Every construct in the format now declares its eject class — ejects, ejects
via fallback, or declared absence — in a closed-world registry
(`ejectClasses`, exported). `mlym emit` reports declared absences instead of
silently dropping them: chrome that previously vanished from emitted styles
with no trace (`controls:`, `legend:`, layer `interactive:`/`toggleable:`,
`parameters:`, stripped `x-*` extension blocks) now arrives as `contract`
warnings naming the construct and what emit did with it. A runtime construct
reaching the emitter without a registration is a thrown error, so the
construct list and the emit report can never drift. Documented at
`/guides/eject-classes/`, with drift tests binding the docs table and the
model's runtime-key boundaries to the registry.
