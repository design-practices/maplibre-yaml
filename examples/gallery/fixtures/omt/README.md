# Lower Manhattan vector-tile fixture

z13–14 OpenMapTiles-schema vector tiles for bbox
[-74.035, 40.695, -73.985, 40.735], fetched from OpenFreeMap (planet build
20260913). They let the Mapzen-classic gallery twins
(`examples/gallery/configs/crosshatch.yaml`, `blueprint.yaml`) and their
browser tests (`e2e/gallery.spec.ts`) render real city geometry hermetically:
no network, no flaky external dependency in CI.

## Attribution and licence

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  These tiles are a Produced Work derived from that database; any map
  rendered from them must credit OpenStreetMap.
- Schema © [OpenMapTiles](https://www.openmaptiles.org/).
- Served by [OpenFreeMap](https://openfreemap.org).

## Using the fixture

The twins reference the tiles as a same-origin path
(`/examples/gallery/fixtures/omt/{z}/{x}/{y}.pbf`). Vector tiles are fetched
inside MapLibre's web worker, so core resolves the template against the page
before handing it to MapLibre. Declare `minzoom: 13`, `maxzoom: 14` and the
bbox above as `bounds`, so MapLibre overzooms instead of requesting tiles
that are not in the fixture.
