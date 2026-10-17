---
"@maplibre-yaml/core": patch
---

Scrollytelling chapter `image` and `video` accept a path to a file on your site, such as `/images/fuji.jpg` for a photo in an Astro or Vite `public/` folder (also `./` and `../` paths). Before, these failed validation with "Invalid URL format" even though the story renderer displayed them. `javascript:`, `data:` and other non-http(s) schemes are now rejected, which `.url()` used to let through. Validation errors from a field with its own message, such as a source `url` or chapter media, now show that message ("Must be an absolute URL … or a path that resolves against the page …") instead of the generic "Invalid string format: regex".
