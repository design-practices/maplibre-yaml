---
"@maplibre-yaml/core": patch
---

Accept same-origin paths in every source URL field (GH #39). `url: "/data/points.geojson"` validates now.

Source URLs were validated with `z.string().url()`, which demands a fully-qualified URL and therefore rejected `/data/points.geojson` — self-hosting data alongside the page, an ordinary setup that works perfectly at runtime, since the data layer passes the string straight to `fetch()` and MapLibre resolves source URLs relative to the document. A real consumer hit this deploying.

The fix is one shared predicate, `isFetchableReference`, applied to **every** source URL field rather than only the GeoJSON one the report named: `geojson.url`, the TileJSON `url` on vector/raster/raster-dem, `image.url`, `video.urls`, and the stream endpoint. They all had the identical defect, and fixing one would have left four near-identical reports to file. Absolute URLs, root-relative (`/x`), and explicitly-relative (`./x`, `../x`) references pass; a bare word like `data.geojson` or `example.com/data.geojson` still does not, so the field keeps a meaningful check. Tile templates continue to validate with `{z}/{x}/{y}` placeholders substituted, and now share the same predicate.

Two consequences worth knowing:

- The published JSON Schema carries `pattern` for these fields instead of `format: "uri"`, so editors and agents validate against the rule that actually applies rather than flagging valid same-origin paths. The rule is expressed as a regex rather than a `new URL()` refinement partly for this reason, and partly because a refinement yields a `ZodEffects` whose larger type — multiplied across seven fields inside the layer discriminated union — pushes that union past TypeScript's declaration-serialization limit (TS7056).

  This is a DX guard, not a security boundary: `.url()` accepted `javascript:` all along, since `new URL()` considers it well-formed. Scheme safety is enforced at the render sinks — see the HTML-hardening changeset.
- The `source.data` rejection message for source-directory paths now recommends `url: "/data/..."`. It previously recommended `data:` *because* `url:` could not accept root-relative paths — the workaround the message encoded is no longer needed, and `data:` for inline GeoJSON versus `url:` for anything fetched is the distinction that was always intended. `data: "/data/..."` remains legal; MapLibre treats a `data` string as a URL.
