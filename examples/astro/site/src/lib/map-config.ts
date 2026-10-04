import { loadGlobalMapConfig } from "@maplibre-yaml/astro";

/** Site-wide map defaults, loaded once at build time. */
export const globalMapConfig = await loadGlobalMapConfig("./src/config/maps.yaml");
