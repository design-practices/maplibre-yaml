---
"@maplibre-yaml/core": patch
---

Stories gain three optional settings for authors who want to manage layout themselves. Nothing changes unless you set them. `cameraOffset: false` (story level) centres each chapter in the whole map instead of offsetting the camera to keep `center` clear of the card. `moveChrome: false` (story level) keeps the legend and corner slots in their corners instead of moving them out of a card's way. A chapter's own `padding:` (a number, or `{ top, right, bottom, left }` in pixels) is used as written for that chapter's camera. These are additive keys; existing stories need no change.
