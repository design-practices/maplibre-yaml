---
"@maplibre-yaml/cli": patch
---

`maplibre-yaml validate` now checks every file and pattern you give it. Before, only the first argument was read: `validate a.yaml b.yaml`, an unquoted `validate *.yaml` (which the shell expands into many arguments) and several quoted patterns all reported just the first file and could exit 0 while later files were broken. Each file is now reported, the command exits non-zero if any of them fails, and an argument that matches no file is named ("No files match …") and makes the run exit non-zero instead of being skipped silently.
