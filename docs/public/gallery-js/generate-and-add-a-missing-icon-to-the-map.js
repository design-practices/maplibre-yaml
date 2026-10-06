// The JavaScript half: MapLibre asks the page for an image it doesn't have,
// and the page paints it. The colour is parsed from the requested name
// itself, so any `square-rgb-r,g,b` works.
//
// maplibre-gl 6 asks through map.setMissingStyleImageResolver(), which it
// awaits before the icon counts as missing; an image added from the old
// `styleimagemissing` event arrives too late there. maplibre-gl 4 and 5
// only have the event, where a synchronous addImage() is in time.
const mapEl = document.querySelector("ml-map");
const prefix = "square-rgb-";

function paint(map, id) {
  if (!id.startsWith(prefix)) return; // not one this page can make
  const rgb = id.slice(prefix.length).split(",").map(Number);
  const width = 64;
  const data = new Uint8Array(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  map.addImage(id, { width, height: width, data });
}

mapEl.mapReady().then((map) => {
  if (typeof map.setMissingStyleImageResolver === "function") {
    map.setMissingStyleImageResolver((id) => paint(map, id));
  } else {
    map.on("styleimagemissing", ({ id }) => paint(map, id));
  }

  // Listening now — let the layer request its icons.
  mapEl.setLayerVisibility("points", true);
});
