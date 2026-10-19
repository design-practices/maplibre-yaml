---
"@maplibre-yaml/cli": patch
---

The `preview` status bar now shows the file relative to the folder you ran the command in (`map.yaml` instead of a full absolute path), on one line, truncated with an ellipsis if it is still too long; the full path appears on hover. On a phone-width window the absolute path used to wrap and run into "Connected". The preview also waits for a save to finish before reloading, so a file written in two steps no longer briefly shows a wrong "Unable to determine document type" error.
