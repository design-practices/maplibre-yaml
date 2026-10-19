---
"@maplibre-yaml/core": patch
---

Stories gain two optional settings for authors who want to manage layout themselves. Nothing changes unless you set them. `cameraOffset: false` (story level) centres each chapter in the whole map instead of offsetting the camera to keep `center` clear of the card. A chapter's own `padding:` (a number, or `{ top, right, bottom, left }` in pixels) is used as written for that chapter's camera. These are additive keys; existing stories need no change.
