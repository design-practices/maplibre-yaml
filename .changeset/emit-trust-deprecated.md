---
"@maplibre-yaml/cli": patch
---

`mlym emit --trust` is deprecated, because it never changed the exported file. Trust decides whether raw `!html` in popups renders and whether `click.emit` host events fire, and both are map behavior that a `style.json` cannot hold, so a trusted and an untrusted export were byte-for-byte the same. The flag is no longer listed in `mlym emit --help`. Passing it still works and exports the same style as before, and it prints a note on stderr saying it has no effect, so your scripts keep running while you remove it. A value other than `trusted` or `untrusted` no longer fails the export. A later release will remove the flag.
