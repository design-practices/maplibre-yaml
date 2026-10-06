// The JavaScript half: the map's interaction handlers, switched at runtime.
// Each checkbox is named after a handler (map.scrollZoom, map.dragPan, …)
// and one delegated listener enables or disables it.
const mapEl = document.querySelector("ml-map");

document.querySelector("[data-interactions]").addEventListener("change", async (e) => {
  const map = await mapEl.mapReady();
  const handler = map[e.target.name];
  if (e.target.checked) handler.enable();
  else handler.disable();
});
