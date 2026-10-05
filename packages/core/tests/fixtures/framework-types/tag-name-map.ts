// Consumer-shaped: a side-effect import of the register entry is all a
// TypeScript app writes, and it must be enough for the element to be typed.
import "@maplibre-yaml/core/register";
import type { Map as MapLibreMap } from "maplibre-gl";

// HTMLElementTagNameMap["ml-map"] = MLMap — no cast needed.
export async function ready(): Promise<MapLibreMap | undefined> {
  const created = document.createElement("ml-map");
  created.getMap();
  return document.querySelector("ml-map")?.mapReady();
}
