---
"@maplibre-yaml/core": patch
---

The "layer references image … but no images: entry, sprite, or addImage call supplies it" warning no longer fires when the page's own `styleimagemissing` handler supplies the image. Generating icons on demand — MapLibre's documented pattern for data-driven icon names — now runs warning-free: the renderer checks `hasImage` after every listener has had its turn, and warns only for images that are still missing.
