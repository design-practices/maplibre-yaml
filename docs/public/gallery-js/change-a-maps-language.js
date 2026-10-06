// The JavaScript half: setLayoutProperty on the basemap's own label layers.
// Every symbol layer whose text-field reads a name is pointed at
// `name:<lang>`, falling back to the local name where a feature has no
// translation (upstream patches three country-label layers by id; this
// works on any OpenMapTiles-schema basemap).
const mapEl = document.querySelector("ml-map");

document.querySelector("[data-languages]").addEventListener("click", async (e) => {
  const lang = e.target.closest("[data-lang]")?.dataset.lang;
  if (!lang) return;
  const map = await mapEl.mapReady();
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const field = map.getLayoutProperty(layer.id, "text-field");
    if (field && JSON.stringify(field).includes("name")) {
      map.setLayoutProperty(layer.id, "text-field", [
        "coalesce",
        ["get", `name:${lang}`],
        ["get", "name"],
      ]);
    }
  }
});
