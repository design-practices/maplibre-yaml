// The JavaScript half: setFilter through mapReady(). The YAML declares the
// layer's initial filter; user input re-filters at runtime — awaiting
// mapReady() means an early interaction waits for the map instead of
// silently doing nothing. (A declarative alternative — global-state
// expressions driven by setGlobalStateProperty — exists in the format but
// needs maplibre-gl >= 5.6 at runtime.)
const mapEl = document.querySelector("ml-map");
const slider = document.querySelector("[data-filter-mag]");
const readout = document.querySelector("[data-filter-readout]");

slider.addEventListener("input", async () => {
  const min = Number(slider.value);
  readout.textContent = min.toFixed(1);
  const map = await mapEl.mapReady();
  map.setFilter("quakes", [">=", ["get", "mag"], min]);
});
