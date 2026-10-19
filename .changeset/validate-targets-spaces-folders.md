---
"@maplibre-yaml/cli": patch
---

`validate` reads each argument the way you meant it. A quoted pattern in a folder with a space (`validate "My Maps/*.yaml"`) is one pattern again, not two, so it no longer fails with "No files match"; the older `validate "a.yaml b.yaml"` spelling still works. A folder argument (`validate maps/`) validates every `.yaml`/`.yml` file under it. A file named directly on the command line is skipped, with a note, when your project's `validate.ignorePatterns` excludes it, as files matched by a pattern already were.
