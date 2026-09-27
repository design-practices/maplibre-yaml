// The escape hatch: `getMap()` hands you the live maplibregl.Map, and every
// imperative API — here flyTo — works on it. Buttons carry their target in a
// data attribute; the YAML stays purely declarative.
const mapEl = document.querySelector("ml-map");

for (const btn of document.querySelectorAll("[data-fly]")) {
  btn.addEventListener("click", () => {
    const map = mapEl.getMap();
    if (!map) return; // not loaded yet
    map.flyTo({ center: JSON.parse(btn.dataset.fly), zoom: 9, duration: 2500 });
  });
}
