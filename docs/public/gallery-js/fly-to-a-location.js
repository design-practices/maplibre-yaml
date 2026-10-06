// The JavaScript half: `mapReady()` resolves with the live maplibregl.Map once
// the document has loaded — no load-event listener, no null-guard (the
// boilerplate this idiom replaced in 0.7). Buttons carry their target in a
// data attribute; the YAML stays purely declarative.
const mapEl = document.querySelector("ml-map");

for (const btn of document.querySelectorAll("[data-fly]")) {
  btn.addEventListener("click", async () => {
    const map = await mapEl.mapReady();
    map.flyTo({ center: JSON.parse(btn.dataset.fly), zoom: 9, duration: 2500 });
  });
}
