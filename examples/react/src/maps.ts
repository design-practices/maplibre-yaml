import type { MapBlock } from "@maplibre-yaml/core";

/** Same-origin, relative to the page: works under `vite dev` and from dist/. */
export const BASEMAP = "./styles/basemap.json";
export const CITIES_YAML = "./maps/cities.yaml";

const HUB: [number, number] = [-9.14, 38.72]; // Lisbon

const DESTINATIONS: { name: string; at: [number, number] }[] = [
  { name: "New York", at: [-74.0, 40.71] },
  { name: "São Paulo", at: [-46.63, -23.55] },
  { name: "Luanda", at: [13.23, -8.84] },
  { name: "Nairobi", at: [36.82, -1.29] },
  { name: "Dubai", at: [55.27, 25.2] },
  { name: "Reykjavík", at: [-21.94, 64.15] },
  { name: "Mexico City", at: [-99.13, 19.43] },
];

export const ROUTE_COLORS = ["#e76f51", "#2a9d8f", "#7209b7"] as const;

/**
 * A map document built in code: flight routes out of Lisbon. The color is a
 * parameter, so the demo can produce a CHANGED document (rebuilds the map)
 * or an EQUAL one (must not).
 */
export function routesDocument(color: string): MapBlock {
  return {
    type: "map",
    id: "routes",
    config: { center: [-20, 25], zoom: 1.2, mapStyle: BASEMAP },
    layers: [
      {
        id: "routes",
        type: "line",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: DESTINATIONS.map((d) => ({
              type: "Feature",
              properties: { name: d.name },
              geometry: { type: "LineString", coordinates: [HUB, d.at] },
            })),
          },
        },
        paint: { "line-color": color, "line-width": 2, "line-dasharray": [2, 1] },
      },
      {
        id: "airports",
        type: "circle",
        source: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [{ name: "Lisbon", at: HUB }, ...DESTINATIONS].map((d) => ({
              type: "Feature",
              properties: { name: d.name },
              geometry: { type: "Point", coordinates: d.at },
            })),
          },
        },
        paint: {
          "circle-radius": 6,
          "circle-color": color,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
        interactive: {
          hover: { cursor: "pointer" },
          click: { popup: [{ strong: [{ property: "name" }] }] },
        },
      },
    ],
  };
}
