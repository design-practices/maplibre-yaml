---
"@maplibre-yaml/astro": patch
---

In `astro dev`, `Map`, `FullPageMap` and `Scrollytelling` now print a one-time console hint when the page has no `<meta name="viewport">`. Without it, phones lay the page out about 980px wide and shrink it, so a full-page map or story comes out tiny with unreadable controls and chapter text, and nothing else points at the cause. The hint is compiled out of production builds. The docs' FullPageMap and Scrollytelling "Basic Usage" snippets are now complete pages with the viewport meta and `body { margin: 0 }`.
