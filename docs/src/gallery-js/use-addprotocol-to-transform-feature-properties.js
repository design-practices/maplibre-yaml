// The escape hatch: addProtocol, imported from @maplibre-yaml/core/maplibre
// so it registers on the very module <ml-map> renders with. Any source URL
// that starts `reverse://` now comes through this function: fetch the real
// URL, rewrite the properties, return the result as the response.
// (Upstream does the same to vector tiles, decoding them with
// @mapbox/vector-tile and re-encoding with vt-pbf; GeoJSON needs neither.)
import { addProtocol } from "@maplibre-yaml/core/maplibre";

const reverse = (text) => [...text].reverse().join("");

addProtocol("reverse", async (request) => {
  const url = request.url.slice("reverse://".length);
  const geojson = await (await fetch(url)).json();
  for (const { properties } of geojson.features) {
    for (const key of ["NAME", "ABBREV"]) {
      if (typeof properties?.[key] === "string") properties[key] = reverse(properties[key]);
    }
  }
  return { data: geojson };
});
