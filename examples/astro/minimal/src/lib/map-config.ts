import { loadGlobalMapConfig } from "@maplibre-yaml/astro";

export const globalMapConfig = await loadGlobalMapConfig(
  "./src/config/maps.yaml",
);
