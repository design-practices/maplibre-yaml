---
"@maplibre-yaml/core": minor
---

Maps can now be named and described for screen readers. A document's new top-level `title:` replaces MapLibre's generic "Map" as the canvas's accessible name, and `description:` (the map's alt text: what it shows and what it means) is linked to the canvas with `aria-describedby` through a visually hidden element. Both keys work the same in v1 and v2 documents and in stories (where they name the story's map). MapLibre's own `role="region"` and keyboard handling are kept; without a `title`, the name stays MapLibre's `locale["Map.Title"]`. On export, `title` becomes the style's root `name` and `description` is kept in `metadata["maplibre-yaml:description"]`.
