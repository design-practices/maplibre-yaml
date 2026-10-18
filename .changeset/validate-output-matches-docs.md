---
"@maplibre-yaml/cli": patch
---

`validate`'s terminal output now matches the docs. Files are shown relative to the folder you ran it in (`✓ my-map.yaml`, not the full path); a run with both valid and broken files prints `✓ N file(s) valid` as well as the issues line; a missing top-level key (`config: Expected object, got undefined`) no longer carries a meaningless "at line 1, column 1"; and a plain file name that doesn't exist says `File not found: missing.yaml` (a pattern that matches nothing still says "No files match"). `init` and the story template now spell the commands `npx maplibre-yaml …`, like the docs and class starters, and the story template puts `theme` at the top level of `story.yaml`, where the story reads it (under `config:` it did nothing).
