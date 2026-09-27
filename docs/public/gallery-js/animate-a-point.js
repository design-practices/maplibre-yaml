// The escape hatch: <ml-map>'s imperative data API. updateLayerData()
// replaces a layer's GeoJSON — no getMap(), no source-id bookkeeping; the
// element resolves the layer's source itself. The upstream version does
// this dance with map.getSource(...).setData().
const mapEl = document.querySelector("ml-map");
let angle = 0;

setInterval(() => {
  angle += 2;
  const rad = (angle * Math.PI) / 180;
  mapEl.updateLayerData?.("orbiter", {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [20 * Math.cos(rad), 20 * Math.sin(rad)] },
        properties: { name: "Orbiter" },
      },
    ],
  });
}, 60);
