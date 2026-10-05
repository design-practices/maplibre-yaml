/**
 * maplibre-gl 6 under Vite (this site's bundler): MapLibre cannot find its
 * worker inside a bundle, so point it there before any LiveMap builds a map.
 * A glob, not a static `?url` import, so the site still builds when CI pins
 * maplibre-gl 4/5 (no such file); core applies the URL only on 6+.
 */
import { setWorkerModuleUrl } from "@maplibre-yaml/core/maplibre";

const worker = import.meta.glob<string>("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", {
  query: "?worker&url",
  import: "default",
  eager: true,
});

setWorkerModuleUrl(Object.values(worker)[0]);
