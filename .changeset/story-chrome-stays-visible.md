---
"@maplibre-yaml/core": patch
---

A story's legend and corner slots now stay visible while chapter cards scroll past them. Cards used to cover a legend for most of each chapter on phones, and on landscape phones for whole chapters. The chrome now moves just out of a card's way as it passes and returns home afterwards. It never sits on the scale bar or attribution: 0.8.0's phone lift could drop a bottom-left legend onto the scale bar at a hidden chapter. Phones on their side (short landscape screens) now get the phone layout with a narrower, shorter card instead of desktop cards taller than the screen. Chapter photos and videos are capped at 40% of the screen height, so a full-width card's photo no longer fills the map, and full-width cards keep the chapter's `center` above them as centred cards do.
