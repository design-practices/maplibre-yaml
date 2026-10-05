// The escape hatch: a requestAnimationFrame loop calling rotateTo with
// duration 0, so the bearing tracks the clock (~10 degrees a second).
// Upstream also strips the basemap's text labels for a cleaner orbit —
// the basemap is the style's, not the document's, so that is JS too.
const mapEl = document.querySelector("ml-map");

mapEl.mapReady().then((map) => {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.removeLayer(layer.id);
    }
  }

  function rotateCamera(timestamp) {
    map.rotateTo((timestamp / 100) % 360, { duration: 0 });
    requestAnimationFrame(rotateCamera);
  }
  requestAnimationFrame(rotateCamera);
});
