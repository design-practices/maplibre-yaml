// The escape hatch: GeoJSONSource.updateData(), the incremental API.
// setData() (and <ml-map>'s updateLayerData()) re-tiles the whole
// collection; updateData() patches features by id, which is what makes a
// per-frame animation of many features cheap.
const mapEl = document.querySelector("ml-map");

const rectangles = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  x: -68.13 + (Math.random() - 0.5) * 5,
  y: 45.13 + (Math.random() - 0.5) * 5,
  vx: (Math.random() - 0.5) * 0.05,
  vy: (Math.random() - 0.5) * 0.05,
  w: 0.5 + Math.random(),
  h: 0.5 + Math.random(),
  rotation: Math.random() * 2 * Math.PI,
  rotationSpeed: (Math.random() - 0.5) * 0.1,
  color: "#008888",
  every: Math.round(Math.random() * 100 + 200), // frames between colour changes
}));

const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

function rectangleGeometry({ x, y, w, h, rotation }) {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const ring = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([dx, dy]) => [x + dx * c - dy * s, y + dx * s + dy * c]);
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}

mapEl.mapReady().then((map) => {
  map.showTileBoundaries = true; // watch which tiles each update touches
  const source = map.getSource("rectangles");
  const zoom = () => map.getZoom().toFixed(1);

  // Seed: features need ids for updateData() to address them.
  source.setData({
    type: "FeatureCollection",
    features: rectangles.flatMap((r) => [
      { type: "Feature", id: r.id, properties: { color: r.color }, geometry: rectangleGeometry(r) },
      { type: "Feature", id: `${r.id}_label`, properties: { label: zoom() }, geometry: { type: "Point", coordinates: [r.x, r.y] } },
    ]),
  });

  let count = 0;
  function animate() {
    count++;
    const update = rectangles.flatMap((r) => {
      r.x += r.vx;
      r.y += r.vy;
      r.rotation += r.rotationSpeed;
      if (r.x < -75 || r.x > -60) r.vx *= -1;
      if (r.y < 40 || r.y > 50) r.vy *= -1;
      if (count % r.every === 0) r.color = randomColor();
      return [
        { id: r.id, newGeometry: rectangleGeometry(r), addOrUpdateProperties: [{ key: "color", value: r.color }] },
        { id: `${r.id}_label`, newGeometry: { type: "Point", coordinates: [r.x, r.y] }, addOrUpdateProperties: [{ key: "label", value: zoom() }] },
      ];
    });
    source.updateData({ update });
    requestAnimationFrame(animate);
  }
  animate();
});
