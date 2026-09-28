# Lower Manhattan vector-tile fixture (spike only)

z13–14 OpenMapTiles-schema tiles for bbox [-74.035, 40.695, -73.985, 40.735],
fetched from OpenFreeMap (planet build 20260913) so the spike's browser
evidence runs hermetically. Data © OpenStreetMap contributors (ODbL),
schema © OpenMapTiles; served via OpenFreeMap. Lives only on the spike
branch — never merged.

Tile requests run in MapLibre's worker, where relative URLs don't parse:
consumers build an absolute template from the page origin
(`${origin}/packages/spike-deck-hatch/fixtures/omt/{z}/{x}/{y}.pbf`).
