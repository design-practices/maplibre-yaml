// The escape hatch: a timer sequence calling jumpTo. A tour is a series
// of events, not map state, so YAML declares the cities and the page
// steps through them. mapReady() hands over the live map once loaded.
const mapEl = document.querySelector("ml-map");
const readout = document.querySelector("[data-city]");

const tour = [
  { name: "Bangkok", center: [100.507, 13.745] },
  { name: "Chiang Mai", center: [98.993, 18.793] },
  { name: "Chiang Rai", center: [99.838, 19.924] },
  { name: "Udon Thani", center: [102.812, 17.408] },
  { name: "Hat Yai", center: [100.458, 7.001] },
  { name: "Pattaya", center: [100.905, 12.935] },
];

mapEl.mapReady().then((map) => {
  tour.forEach((city, index) => {
    setTimeout(() => {
      map.jumpTo({ center: city.center });
      readout.textContent = `${index + 1}/${tour.length} · ${city.name}`;
    }, 2000 * index);
  });
});
