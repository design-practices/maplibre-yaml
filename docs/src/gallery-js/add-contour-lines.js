// The escape hatch: a protocol plugin on the maplibre module <ml-map>
// renders with. maplibre-contour turns DEM tiles into vector contour
// tiles; registering `contours://` through @maplibre-yaml/core/maplibre
// guarantees it lands on the same module the document's source requests
// go through. The plugin is built lazily, on the first contour tile, from
// the `dem` source the YAML declares — so the DEM lives in one place.
import { addProtocol } from "@maplibre-yaml/core/maplibre";
import mlcontour from "maplibre-contour";

const mapEl = document.querySelector("ml-map");

const contourOptions = {
  multiplier: 3.28084, // metres to feet
  overzoom: 1,
  thresholds: {
    // zoom: [minor, major] interval, in feet
    11: [200, 1000],
    12: [100, 500],
    13: [100, 500],
    14: [50, 200],
    15: [20, 100],
  },
  elevationKey: "ele",
  levelKey: "level",
  contourLayer: "contours",
};

let demSource;
function dem() {
  if (!demSource) {
    const spec = mapEl.getMap().getStyle().sources.dem;
    const template = spec.tiles[0];
    demSource = new mlcontour.DemSource({
      // The worker resolves URLs against nothing — make a site path absolute.
      url: template.startsWith("/") ? location.origin + template : template,
      encoding: spec.encoding ?? "mapbox",
      maxzoom: spec.maxzoom ?? 12,
      worker: true, // compute contours off the main thread
    });
  }
  return demSource;
}

addProtocol("contours", (request, abortController) => {
  const [z, x, y] = request.url.slice("contours://".length).split("/");
  const url = dem()
    .contourProtocolUrl(contourOptions)
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);
  return dem().contourProtocolV4({ ...request, url }, abortController);
});
