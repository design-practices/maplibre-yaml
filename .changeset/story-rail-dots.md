---
"@maplibre-yaml/core": patch
---

The chapter rail's dots (`showMarkers: true`) now stand out on any basemap. They are white with a dark outline, and the current chapter's dot is larger and filled dark with a white ring, so it is marked by size and fill and not by colour alone. Before, every dot was `#3FB1CE` with a white border, which disappeared on water, teal and pale basemaps. Keyboard focus on a dot shows a dark ring with a white halo. `markerColor` still fills the dots with your own color and now keeps the dark outline; it no longer has a default value.
