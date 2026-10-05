/**
 * Loader for the escape-hatch twins (see twin.html).
 *
 * Order matters and mirrors a real page:
 *  1. page chrome goes INSIDE <ml-map> before the element renders, so its
 *     `slot="…"` children are collected on the first render (U9);
 *  2. module hatches (protocol plugins) register on the maplibre-gl module
 *     before any source request can go out;
 *  3. the element gets its document and is defined;
 *  4. classic hatch scripts run, exactly as the docs page's
 *     `<script src="/gallery-js/<slug>.js" defer>` does.
 */

/**
 * Every hatch page this harness drives. `chrome`: the page has a
 * docs/public/gallery-js/<slug>.html slot fragment. `module`: the hatch JS
 * is an ES module in docs/src/gallery-js/ (it imports the protocol hatch
 * `@maplibre-yaml/core/maplibre`, so the docs site must bundle it).
 * `noJs`: the hatch lives inside the YAML (an inline mapStyle object).
 */
const HATCHES = {
  // Wave 3 (converted to the harness by U16 / ml-7fb)
  "fly-to-a-location": { chrome: true },
  "filter-within-a-layer": { chrome: true },
  "get-features-under-the-mouse-pointer": { chrome: true },
  "animate-a-point": {},
  "style-labels-with-web-fonts": { noJs: true },
  // U16 — camera and animation
  "jump-to-a-series-of-locations": { chrome: true },
  "slowly-fly-to-a-location": { chrome: true },
  "animate-a-line": { chrome: true },
  "animate-a-point-along-a-route": { chrome: true },
  "animate-map-camera-around-a-point": {},
  "customize-camera-animations": { chrome: true },
  "offset-the-vanishing-point-using-padding": { chrome: true },
  "toggle-interactions": { chrome: true },
  // U16 — sources and data
  "add-a-canvas-source": { chrome: true },
  "animate-a-series-of-images": {},
  "update-geojson-polygons": {},
  "draw-a-circle": { chrome: true },
  // U16 — images and icons
  "add-a-generated-icon-to-the-map": {},
  "add-a-stretchable-image-to-the-map": {},
  "add-an-animated-icon-to-the-map": {},
  "generate-and-add-a-missing-icon-to-the-map": {},
  // U16 — labels, language, events
  "style-labels-with-local-fonts": { noJs: true },
  "filter-symbols-by-text-input": { chrome: true },
  "change-a-maps-language": { chrome: true },
  "get-coordinates-of-the-mouse-pointer": { chrome: true },
  // U16 — protocols and plugins
  "use-addprotocol-to-transform-feature-properties": { module: true },
  "add-contour-lines": { module: true },
};

const params = new URLSearchParams(location.search);
const slug = params.get("slug") ?? "";
const live = params.has("live");
const title = document.getElementById("title");
const mapEl = document.getElementById("map");

if (!/^[a-z0-9-]+$/.test(slug) || !(slug in HATCHES)) {
  title.textContent = `unknown hatch "${slug}" — known: ${Object.keys(HATCHES).join(", ")}`;
} else {
  const hatch = HATCHES[slug];
  title.textContent = `hatch ${live ? "(LIVE docs config)" : "twin"}: ${slug}`;
  document.title = `hatch: ${slug}`;

  if (hatch.chrome) {
    const res = await fetch(`/docs/public/gallery-js/${slug}.html`);
    mapEl.insertAdjacentHTML("beforeend", await res.text());
  }
  if (hatch.module) {
    await import(`/docs/src/gallery-js/${slug}.js`);
  }

  mapEl.setAttribute(
    "src",
    live ? `/docs/public/configs/gallery/${slug}.yaml` : `../configs/${slug}.yaml`
  );
  await import("../../../packages/core/register.js");

  if (!hatch.module && !hatch.noJs) {
    const script = document.createElement("script");
    script.src = `/docs/public/gallery-js/${slug}.js`;
    const ran = new Promise((resolve) => script.addEventListener("load", resolve));
    document.body.append(script);
    await ran;
  }
  // Tests key on this: the page's own JS has run (its listeners exist).
  document.documentElement.dataset.hatchReady = slug;
}
