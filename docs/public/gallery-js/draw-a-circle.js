// The escape hatch: compute geometry in the page, hand it to the layer.
// circle() is what turf.circle does — 64 points at a fixed great-circle
// distance from the centre — and updateLayerData() fills the (initially
// empty) source both YAML layers share. The slider recomputes it live.
const mapEl = document.querySelector("ml-map");
const slider = document.querySelector("[data-radius]");
const readout = document.querySelector("[data-radius-readout]");
const center = [2.3454, 48.8452];

function circle([lng, lat], radiusKm, steps = 64) {
  const R = 6371.0088; // mean Earth radius, km
  const d = radiusKm / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (-2 * Math.PI * (i % steps)) / steps; // counter-clockwise, closed
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return { type: "Feature", properties: { radiusKm }, geometry: { type: "Polygon", coordinates: [ring] } };
}

function draw() {
  const km = Number(slider.value);
  readout.textContent = `${km.toFixed(1)} km`;
  mapEl.updateLayerData("location-radius", circle(center, km));
}

mapEl.mapReady().then(() => {
  draw();
  slider.addEventListener("input", draw);
});
