---
"@maplibre-yaml/astro": patch
---

`Map`, `FullPageMap` and `Scrollytelling` accept a `quiet` prop, which renders `<ml-map quiet>` / `<ml-scrollytelling quiet>`. It hides the on-page notices for non-fatal problems, such as a data file that didn't load or the zero-height hint, so a finished site can keep them away from its visitors. The problems are still logged to the browser console, and fatal problems still show their error card. Before, an Astro site had no way to turn the notice off.
