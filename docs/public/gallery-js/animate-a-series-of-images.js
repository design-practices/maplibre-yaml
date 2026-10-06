// The JavaScript half: an image source's updateImage(). The YAML declared
// the source inline on the layer, so the page asks the layer which source
// it draws from, then swaps that source's frame every 200 ms.
const mapEl = document.querySelector("ml-map");
const frameCount = 5;
let currentImage = 0;

mapEl.mapReady().then((map) => {
  const source = map.getSource(map.getLayer("radar-layer").source);
  setInterval(() => {
    currentImage = (currentImage + 1) % frameCount;
    source.updateImage({ url: `/gallery-assets/radar${currentImage}.gif` });
  }, 200);
});
