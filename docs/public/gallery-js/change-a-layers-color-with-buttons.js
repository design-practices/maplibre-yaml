// The escape hatch: setPaintProperty through getMap(). Any paint property
// can be driven this way at runtime; the YAML keeps the authored default.
const mapEl = document.querySelector("ml-map");

for (const btn of document.querySelectorAll("[data-fill-color]")) {
  btn.addEventListener("click", () => {
    mapEl.getMap()?.setPaintProperty("district", "fill-color", btn.dataset.fillColor);
  });
}
