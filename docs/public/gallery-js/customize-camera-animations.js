// The escape hatch: flyTo's AnimationOptions — duration, easing, offset,
// animate — built from the panel's controls. The YAML's "target" layers
// show where the camera was asked to centre; with an offset, compare that
// point with where the camera actually ends up.
const mapEl = document.querySelector("ml-map");
const panel = document.querySelector("[data-camera-panel]");
const field = (name) => panel.querySelector(`[name="${name}"]`);

// Easing functions map animation progress t (0..1) to output progress.
const easingFunctions = {
  easeInCubic: (t) => t * t * t, // slow start, then speeds up
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5), // fast start, long wind-down
  easeInOutCirc: (t) => // slow start and finish, fast middle
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  easeOutBounce(t) { // fast start with a bounce at the end
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

const durationLabel = panel.querySelector("[data-duration-value]");
const showDuration = () => (durationLabel.textContent = `${field("duration").value / 1000} s`);
field("duration").addEventListener("input", showDuration);
showDuration();

panel.querySelector("[data-animate]").addEventListener("click", async () => {
  const map = await mapEl.mapReady();
  // A random target up to 10 degrees from the starting centre.
  const center = [-95 + (Math.random() - 0.5) * 20, 40 + (Math.random() - 0.5) * 20];

  map.flyTo({
    center,
    duration: Number(field("duration").value),
    easing: easingFunctions[field("easing").value],
    offset: [Number(field("offset-x").value), Number(field("offset-y").value)],
    animate: field("animate").checked,
    essential: true,
  });

  mapEl.updateLayerData("target-circle", {
    type: "Feature",
    properties: { label: `Center: [${center[0].toFixed(1)}, ${center[1].toFixed(1)}]` },
    geometry: { type: "Point", coordinates: center },
  });
});
