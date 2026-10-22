---
"@maplibre-yaml/core": patch
---

A source with `refresh: { refreshInterval: … }` now fetches its URL on every tick. Before, each tick read through the data cache, which is on by default with a 5-minute lifetime, so a poll faster than every 5 minutes kept showing the first response until the cache expired, unless the source also set `cache: { enabled: false }`. Refresh ticks now always ask the server, and the new response replaces the cached copy. `DataFetcher.fetch()` gains a `revalidate` option that does the same for your own calls: it ignores a fresh cached copy, goes to the network, and caches the result. A `skipCache` fetch no longer copies the response's `ETag` or `Last-Modified` onto the older cached copy, which could have made a later conditional request return that older copy.
