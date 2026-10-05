/**
 * maplibre-gl 6 under Vite: tell MapLibre where its worker module is.
 *
 * In your own app, on maplibre-gl 6, this is two lines (the docs print them):
 *
 *   import { setWorkerUrl } from "maplibre-gl";
 *   import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
 *   setWorkerUrl(workerUrl);
 *
 * This app is built by CI on every supported maplibre-gl major, and on 4/5
 * that file does not exist, so a static `?url` import would fail their build.
 * A glob that matches nothing is just empty, and core's `setWorkerModuleUrl`
 * applies the URL only on maplibre-gl 6+.
 */
import { setWorkerModuleUrl } from "@maplibre-yaml/core/maplibre";

const worker = import.meta.glob<string>("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", {
  query: "?worker&url",
  import: "default",
  eager: true,
});

setWorkerModuleUrl(Object.values(worker)[0]);
