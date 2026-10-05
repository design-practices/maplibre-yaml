// The escape hatch that isn't even getMap(): <ml-map> dispatches DOM
// CustomEvents (ml-map:layer-hover, ml-map:layer-click, ...) with the
// feature in detail — plain addEventListener, no MapLibre API in sight.
const mapEl = document.querySelector("ml-map");
const panel = document.querySelector("[data-feature-info]");

mapEl.addEventListener("ml-map:layer-hover", (e) => {
  const { name, kind } = e.detail.feature?.properties ?? {};
  panel.textContent = name ? `${name} — ${kind}` : "Hover a landmark";
});
