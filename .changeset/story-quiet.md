---
"@maplibre-yaml/core": patch
---

`<ml-scrollytelling quiet>` now works like `<ml-map quiet>`. It hides the story map's "Part of this map couldn't load" notice and a chapter's "image didn't load" note, and every message stays in the console. Before, a story ignored the attribute. The image note now refers to "most web servers" for the case-sensitive file name, not a particular host. A chapter image that had already loaded before the story started is no longer reported as missing just because it has no intrinsic size, as some SVGs don't.
