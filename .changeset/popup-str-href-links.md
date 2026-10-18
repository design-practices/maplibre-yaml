---
"@maplibre-yaml/core": patch
---

Popup link items now render the way they read. An item with both `str` and `href` (`- str: "Wikipedia"` plus `href: "https://…"`) is a link with `str` as its text; before, the text rendered and the URL was silently dropped. `target` (`_blank`, the default, or `_self`, `_parent`, `_top`) is now part of the popup item schema: it no longer logs `Unknown key "target"`, editors offer its values, and any other value fails validation with `target must be one of: _blank, _self, _parent, _top` on that key. `href` also accepts relative paths (`/about`, `./notes.html`, `#top`) as well as absolute URLs. The builder already rendered these, but validation rejected them as "Invalid URL format". Unsafe schemes such as `javascript:` still render as plain text, and `_blank` links still get `rel="noopener noreferrer"`. A link item wrapped in `a:`, or an image item wrapped in `img:`, now renders one element instead of an extra empty `<a>`/`<img>`.
