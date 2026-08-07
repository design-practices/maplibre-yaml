---
"@maplibre-yaml/core": patch
"@maplibre-yaml/astro": patch
"@maplibre-yaml/cli": patch
---

Harden every HTML sink: shared attribute-safe escaping, a popup tag allowlist, and URL scheme guards.

A document may be authored by someone other than the person whose browser renders it, and feature properties come from fetched data that is never trusted. Escaping was applied unevenly across the sinks, and three vectors were live.

**New `escapeHtml` / `safeUrl` in core** (exported from the package root). One escaper, attribute-safe — quotes included — and DOM-free, so it works during SSR where the previous `document.createElement` approach did not. It replaces two divergent private copies: the popup builder's regex version escaped quotes, the `<ml-map>` error card's `textContent` version did not, which is exactly the difference between safe and unsafe in attribute position.

**Popup builder.** Three fixes:

- *Tag allowlist.* Popup content is `z.record(...)`, so the tag is a YAML **key** and nothing constrained it: `script:` emitted a real `<script>` block, and a key carrying attributes (`img src=x onerror=...`) injected them wholesale. Only the documented tags render now; anything else is dropped with a console warning. `iframe` is deliberately excluded — the builder never emitted one with a `src`, so nothing that worked stops working.
- *URL scheme guards.* `javascript:alert(1)` contains no character escaping touches, and zod's `.url()` accepts it as well-formed, so it reached `href` intact and executed on click. `href` and `src` now pass through a scheme allowlist (http, https, mailto, tel, plus scheme-less relative references); an unsafe link degrades to its text, an unsafe image is dropped. The guard strips control characters first, because browsers do the same before resolving a scheme — `java\nscript:` navigates as `javascript:`.
- *`target` and `rel`.* `target` is passthrough in the schema and was raw-interpolated into the attribute, so `_blank" onmouseover="…` broke out. It is now allowlisted to the four legal values, and `_blank` links carry `rel="noopener noreferrer"`.

**Astro components.** The `Map`, `FullPageMap`, and `Scrollytelling` error cards interpolated validation messages and thrown-error text into `innerHTML` completely unescaped. Scrollytelling additionally interpolated chapter `title`, `id`, `image`, and `video` into markup and attributes. All escaped; media URLs get the scheme guard. These inline scripts carry a small deliberate copy of the escaper rather than importing it — they are `is:inline`, and the only import route sits inside the very `try` whose `catch` renders the error card.

**CLI preview.** The debug panel rendered event type and payload — which carry feature properties from fetched sources — into `innerHTML` unescaped.

Not addressed here, and deliberately so: `chapter.description` and `footer` are documented as HTML-bearing (`"HTML/markdown supported"`, `"Footer content (HTML)"`). Escaping them would break documented behavior, and choosing between an allowlist sanitizer and a trusted-author contract is a product decision, tracked separately. Both sites are now commented to say so.
