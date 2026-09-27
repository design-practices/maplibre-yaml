---
"@maplibre-yaml/core": minor
---

The params/toggle panel — the first reader of `parameters:` (R11). Declaring
`parameters:` renders a control panel (default top-right): `range`, `select`
(alias `enum`), and `toggle` controls, each seeded from its `state:` default
and writing live via `setGlobalStateProperty`; unrecognized types degrade to
a labeled read-only row. Layers with an authored `label:` get a visibility
checkbox (consuming `toggleable:` — set it false to opt out); layer toggles
are plain visibility and work on every supported runtime, while parameter
controls need maplibre-gl ≥ 5.6 and degrade to one declared-absence notice
below it. The legend, the panel, and (soon) author slots share one
overlay-chrome corner system: four corners, same-corner occupants stack,
`pointer-events` pass through empty chrome. On eject nothing changes —
parameters remain declared-absent and state defaults inline below the
runtime floor. Three more gallery pages flip to Pure YAML (time slider,
global-state symbol filter, color buttons — census 59).
