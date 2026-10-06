// The JavaScript half: a requestAnimationFrame loop feeding <ml-map>'s
// updateLayerData(). Each frame appends a vertex of a sine wave and hands
// the whole line to the layer — no getSource(...).setData bookkeeping.
const mapEl = document.querySelector("ml-map");
const pauseButton = document.querySelector("[data-pause]");

const speedFactor = 30; // frames per degree of longitude
let coordinates = [[0, 0]];
let startTime = 0;
let progress = 0;
let resumed = true; // restart the clock from `progress` on the next frame
let frame = 0;

function animateLine(timestamp) {
  if (resumed) {
    startTime = timestamp - progress;
    resumed = false;
  }
  progress = timestamp - startTime;

  if (progress > speedFactor * 360) {
    // Finished a loop: start over.
    startTime = timestamp;
    progress = 0;
    coordinates = [[0, 0]];
  } else {
    const x = progress / speedFactor;
    const y = Math.sin((x * Math.PI) / 90) * 40;
    coordinates.push([x, y]);
    mapEl.updateLayerData("line-animation", {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    });
  }
  frame = requestAnimationFrame(animateLine);
}

mapEl.mapReady().then(() => {
  frame = requestAnimationFrame(animateLine);

  pauseButton.addEventListener("click", () => {
    const paused = pauseButton.toggleAttribute("aria-pressed");
    pauseButton.textContent = paused ? "Play" : "Pause";
    if (paused) {
      cancelAnimationFrame(frame);
    } else {
      resumed = true;
      frame = requestAnimationFrame(animateLine);
    }
  });
});
