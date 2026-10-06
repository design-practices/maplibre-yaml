// The JavaScript half: a `canvas` source, added through mapReady(). The page
// animates bouncing circles on a hidden <canvas>; MapLibre re-reads it
// every frame (animate: true) and drapes it over four corner coordinates.
const mapEl = document.querySelector("ml-map");
const canvas = document.querySelector("[data-canvas-source]");
const ctx = canvas.getContext("2d");
const size = canvas.width;
const radius = 20;

const circles = Array.from({ length: 5 }, () => ({
  x: Math.random() * (size - radius * 2) + radius,
  y: Math.random() * (size - radius * 2) + radius,
  dx: (Math.random() - 0.5) * 4,
  dy: (Math.random() - 0.5) * 4,
  color: `hsl(${Math.floor(Math.random() * 360)} 80% 45%)`,
}));

function animate() {
  ctx.clearRect(0, 0, size, size);
  for (const c of circles) {
    if (c.x + radius > size || c.x - radius < 0) c.dx = -c.dx;
    if (c.y + radius > size || c.y - radius < 0) c.dy = -c.dy;
    c.x += c.dx;
    c.y += c.dy;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.color;
    ctx.stroke();
  }
  requestAnimationFrame(animate);
}
animate();

mapEl.mapReady().then((map) => {
  map.addSource("canvas-source", {
    type: "canvas",
    canvas,
    coordinates: [
      [91.4461, 21.5006],
      [100.3541, 21.5006],
      [100.3541, 13.9706],
      [91.4461, 13.9706],
    ],
    animate: true, // static canvases should say false: it saves a re-upload per frame
  });
  map.addLayer({ id: "canvas-layer", type: "raster", source: "canvas-source" });
});
