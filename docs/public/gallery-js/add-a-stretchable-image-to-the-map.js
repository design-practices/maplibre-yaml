// The escape hatch: addImage() options the `images:` block doesn't carry.
// stretchX/stretchY name the pixel columns and rows that may stretch (the
// blue and red bands of the debug image); `content` is the box the text
// must fit inside. Then the two layers the YAML declared hidden appear.
const mapEl = document.querySelector("ml-map");

const stretch = {
  stretchX: [[25, 55], [85, 115]], // two horizontally stretchable column bands
  stretchY: [[25, 100]], // one vertically stretchable row band
  content: [25, 25, 115, 100], // [x1, y1, x2, y2] the text sits inside
  pixelRatio: 2, // a high-dpi image
};

mapEl.mapReady().then(async (map) => {
  const [debugPopup, popup] = await Promise.all([
    map.loadImage("/gallery-assets/popup_debug.png"),
    map.loadImage("/gallery-assets/popup.png"),
  ]);
  map.addImage("popup-debug", debugPopup.data, stretch);
  map.addImage("popup", popup.data, stretch);

  mapEl.setLayerVisibility("points", true);
  mapEl.setLayerVisibility("original", true);
});
