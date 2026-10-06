// The JavaScript half: geometry maths plus a requestAnimationFrame loop.
// The route arrives from YAML as a straight two-point line; the page bends
// it into a great-circle arc (what turf.along does upstream, in a dozen
// lines) and walks the plane along it, writing each position and heading
// through <ml-map>'s updateLayerData().
const mapEl = document.querySelector("ml-map");
const origin = [-122.414, 37.776]; // San Francisco
const destination = [-77.032, 38.913]; // Washington DC
const steps = 500;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Point `f` (0..1) of the way along the great circle from a to b. */
function intermediate([lng1, lat1], [lng2, lat2], f) {
  const [l1, p1, l2, p2] = [rad(lng1), rad(lat1), rad(lng2), rad(lat2)];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}

/** Initial compass bearing from a to b, in degrees. */
function bearing([lng1, lat1], [lng2, lat2]) {
  const [l1, p1, l2, p2] = [rad(lng1), rad(lat1), rad(lng2), rad(lat2)];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return deg(Math.atan2(y, x));
}

const arc = Array.from({ length: steps + 1 }, (_, i) => intermediate(origin, destination, i / steps));
let counter = 0;

function animate() {
  const here = arc[counter];
  const [from, to] = counter < steps ? [here, arc[counter + 1]] : [arc[counter - 1], here];
  mapEl.updateLayerData("plane", {
    type: "Feature",
    properties: { bearing: bearing(from, to) },
    geometry: { type: "Point", coordinates: here },
  });
  if (counter < steps) requestAnimationFrame(animate);
  counter += 1;
}

mapEl.mapReady().then(() => {
  mapEl.updateLayerData("route", {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: arc },
  });
  animate();

  document.querySelector("[data-replay]").addEventListener("click", () => {
    const running = counter <= steps;
    counter = 0;
    if (!running) animate(); // a finished run restarts; a live one just rewinds
  });
});
