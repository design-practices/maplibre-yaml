// The escape hatch: the map's styleimagemissing event. MapLibre asks for
// an image it doesn't have; a handler that calls addImage() synchronously
// supplies it before the symbol is placed. Here the colour is parsed from
// the requested name itself, so any `square-rgb-r,g,b` works.
const mapEl = document.querySelector("ml-map");
const prefix = "square-rgb-";

mapEl.mapReady().then((map) => {
  map.on("styleimagemissing", ({ id }) => {
    if (!id.startsWith(prefix)) return; // not one this handler can make
    const rgb = id.slice(prefix.length).split(",").map(Number);
    const width = 64;
    const data = new Uint8Array(width * width * 4);
    for (let i = 0; i < width * width; i++) {
      data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
    map.addImage(id, { width, height: width, data });
  });

  // Listening now — let the layer request its icons.
  mapEl.setLayerVisibility("points", true);
});
