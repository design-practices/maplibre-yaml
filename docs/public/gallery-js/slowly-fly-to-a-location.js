// The escape hatch: flyTo with tuned flight options. speed and curve
// shape the arc (zoom far out, pan, zoom back in); easing is any
// t -> t function. Each click aims at whichever end the camera isn't at.
const mapEl = document.querySelector("ml-map");
const start = [-74.5, 40];
const end = [74.5, 40];
let isAtStart = true;

document.querySelector("[data-fly-toggle]").addEventListener("click", async () => {
  const map = await mapEl.mapReady();
  const target = isAtStart ? end : start;
  isAtStart = !isAtStart;

  map.flyTo({
    center: target,
    zoom: 9,
    bearing: 0,
    speed: 0.2, // make the flight slow
    curve: 1, // how far it zooms out before panning
    easing: (t) => t, // linear
    essential: true, // runs even under prefers-reduced-motion
  });
});
