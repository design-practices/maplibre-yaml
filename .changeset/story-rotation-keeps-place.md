---
"@maplibre-yaml/core": patch
---

Rotating a phone, or resizing the window, in the middle of a story now keeps the reader's place and the right camera. The chapter being read stays on screen; before, the page kept its scroll offset in pixels while every chapter changed height, so the reader landed chapters away. The map is resized before the chapter's camera is worked out, so the camera lands on the active chapter with the new layout's offset; before, a rotation that changed the chapter could leave the map at the previous chapter's place. A chapter with `rotateAnimation` or `spinGlobe` keeps turning from where it was through any number of resizes and rotations, with its new offset.
