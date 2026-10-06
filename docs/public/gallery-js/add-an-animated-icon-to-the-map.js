// The JavaScript half: a StyleImageInterface. Instead of fixed pixels,
// addImage() gets an object whose render() MapLibre calls before every
// frame that uses the icon; it redraws a canvas, copies the pixels into
// `data`, asks for another frame and returns true ("I changed").
const mapEl = document.querySelector("ml-map");
const size = 200;

mapEl.mapReady().then((map) => {
  const pulsingDot = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),

    // Called when the image is added: set up a 2D canvas to draw on.
    onAdd() {
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      this.context = canvas.getContext("2d", { willReadFrequently: true });
    },

    // Called once before every frame where the icon is used.
    render() {
      const duration = 1000;
      const t = (performance.now() % duration) / duration;
      const radius = (size / 2) * 0.3;
      const outerRadius = (size / 2) * 0.7 * t + radius;
      const ctx = this.context;

      ctx.clearRect(0, 0, this.width, this.height);
      ctx.beginPath(); // outer, fading ring
      ctx.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 200, 200, ${1 - t})`;
      ctx.fill();

      ctx.beginPath(); // inner dot
      ctx.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 100, 100, 1)";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2 + 4 * (1 - t);
      ctx.fill();
      ctx.stroke();

      this.data = ctx.getImageData(0, 0, this.width, this.height).data;
      map.triggerRepaint(); // keep the animation running
      return true;
    },
  };

  map.addImage("pulsing-dot", pulsingDot, { pixelRatio: 2 });
  mapEl.setLayerVisibility("points", true);
});
