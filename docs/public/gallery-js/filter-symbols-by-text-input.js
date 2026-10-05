// The escape hatch: one call, setGlobalStateProperty. The layer's filter
// already reads the `query` state key (see the YAML), so typing only has
// to write the key — no per-layer visibility bookkeeping as upstream does.
const mapEl = document.querySelector("ml-map");
const input = document.querySelector("[data-filter-input]");

input.addEventListener("input", async () => {
  const map = await mapEl.mapReady();
  map.setGlobalStateProperty("query", input.value.trim().toLowerCase());
});
