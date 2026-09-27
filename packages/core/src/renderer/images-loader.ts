/**
 * @file Live `images:` — load named images before layers (U6, R9)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * The runtime half of the images construct: each declared image is fetched
 * and registered via `map.addImage(name, ...)` BEFORE layers are added, so a
 * symbol layer's `icon-image: name` (or a `*-pattern` reference) resolves on
 * first render. URLs pass the same `safeUrl` scheme gate as popup images and
 * marker icons.
 *
 * Loading uses a plain `HTMLImageElement` (with `crossOrigin = "anonymous"`
 * so the texture upload isn't tainted) rather than `map.loadImage`, whose
 * callback-vs-promise signature drifted across the supported maplibre-gl
 * peer range (^3 || ^4 || ^5). `addImage` accepts the element directly on
 * every supported version.
 *
 * Failure posture (ml-blj): a missing or refused image warns once per name
 * and the document keeps rendering — the layer simply draws without the
 * icon, exactly what MapLibre itself does for an unknown image reference.
 * Unknown names referenced by layers surface through the renderer's
 * `styleimagemissing` warn-once handler, not here.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { safeUrl } from "../utils/html";
import type { ImageConfig } from "../schemas/map.schema";

/** Options `map.addImage` understands, drawn from the declaration. */
function addImageOptions(config: ImageConfig): Record<string, unknown> {
  if (typeof config === "string") return {};
  return {
    ...(config.sdf !== undefined ? { sdf: config.sdf } : {}),
    ...(config.pixelRatio !== undefined ? { pixelRatio: config.pixelRatio } : {}),
  };
}

/**
 * Load every declared image and register it on the map. Resolves when all
 * images have either registered or failed (never rejects — failures warn).
 */
export function loadDocumentImages(
  map: MapLibreMap,
  images: Record<string, ImageConfig>,
  onImageError?: (name: string, url: string) => void
): Promise<void> {
  const loads = Object.entries(images).map(([name, config]) => {
    const url = typeof config === "string" ? config : config.url;
    const gated = safeUrl(url);
    if (gated === null) {
      console.warn(
        `[maplibre-yaml] Dropping image "${name}" with unsafe URL scheme: ${url}`
      );
      onImageError?.(name, url);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const img = document.createElement("img");
      img.crossOrigin = "anonymous";
      img.addEventListener("load", () => {
        try {
          if (!map.hasImage(name)) {
            map.addImage(name, img, addImageOptions(config) as never);
          }
        } catch (error) {
          console.warn(`[maplibre-yaml] Could not register image "${name}":`, error);
          onImageError?.(name, url);
        }
        resolve();
      });
      img.addEventListener("error", () => {
        console.warn(
          `[maplibre-yaml] image "${name}" failed to load from ${url}; ` +
            "layers referencing it render without it."
        );
        onImageError?.(name, url);
        resolve();
      });
      img.src = gated;
    });
  });
  return Promise.all(loads).then(() => undefined);
}
