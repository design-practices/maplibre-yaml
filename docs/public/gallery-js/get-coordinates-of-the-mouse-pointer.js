// The escape hatch: the map's own mousemove event. e.point is the pixel
// position relative to the map's top-left corner; e.lngLat is the
// geographic position under the pointer (wrapped into -180..180).
const mapEl = document.querySelector("ml-map");
const info = document.querySelector("[data-pointer-info]");

mapEl.mapReady().then((map) => {
  map.on("mousemove", (e) => {
    info.textContent = `${JSON.stringify(e.point)}\n${JSON.stringify(e.lngLat.wrap())}`;
  });
});
