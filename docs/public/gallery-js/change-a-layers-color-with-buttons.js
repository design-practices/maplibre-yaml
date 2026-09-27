// The escape hatch: setPaintProperty through mapReady(). Any paint property
// can be driven this way at runtime; the YAML keeps the authored default.
// Awaiting mapReady() means a click before the map loads waits instead of
// silently doing nothing.
const mapEl = document.querySelector("ml-map");

for (const btn of document.querySelectorAll("[data-fill-color]")) {
  btn.addEventListener("click", async () => {
    const map = await mapEl.mapReady();
    map.setPaintProperty("district", "fill-color", btn.dataset.fillColor);
  });
}
