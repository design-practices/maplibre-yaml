# Lower Manhattan vector-tile fixture

z13–14 OpenMapTiles-schema vector tiles covering
bbox `[-74.035, 40.695, -73.985, 40.735]` (lower Manhattan), fetched from
OpenFreeMap (planet build 20260913) so the effects browser suite and demo
(`e2e/effects.spec.ts`, `examples/verification/effects/`) run hermetically.

**Data © OpenStreetMap contributors, available under the Open Database
License (ODbL) — https://www.openstreetmap.org/copyright.** Schema ©
OpenMapTiles (https://openmaptiles.org). Served via OpenFreeMap
(https://openfreemap.org). The tiles are redistributed unmodified; any map
rendered from them must carry the attribution above (the fixture documents
declare it on their source).

Tile requests run in MapLibre's worker, where relative URLs don't parse:
consumers build an absolute template from the page origin, e.g.
`${location.origin}/examples/verification/data/omt/{z}/{x}/{y}.pbf`.

Graduated from the U12 spike branch (`spike/07-u12-deck-hatch`, ml-rzm) in
U13′ (ml-vw4.2).
