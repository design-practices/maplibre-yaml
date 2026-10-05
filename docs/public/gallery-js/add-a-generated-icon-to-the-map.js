// The escape hatch: map.addImage() with raw pixels. A 64×64 RGBA buffer
// becomes the image "gradient" (red down, green across); then the layer
// the YAML declared hidden is shown through <ml-map>'s setLayerVisibility.
const mapEl = document.querySelector("ml-map");

mapEl.mapReady().then((map) => {
  const width = 64;
  const bytesPerPixel = 4; // red, green, blue, alpha
  const data = new Uint8Array(width * width * bytesPerPixel);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < width; y++) {
      const offset = (y * width + x) * bytesPerPixel;
      data[offset + 0] = (y / width) * 255; // red
      data[offset + 1] = (x / width) * 255; // green
      data[offset + 2] = 128; // blue
      data[offset + 3] = 255; // alpha
    }
  }
  map.addImage("gradient", { width, height: width, data });
  mapEl.setLayerVisibility("points", true);
});
