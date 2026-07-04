---
"@maplibre-yaml/core": patch
---

Internal cleanup in core: removed the dead legacy refresh path and fixed abort-signal handling in the data fetcher.

- **`LayerManager`**: deleted the superseded legacy refresh implementation (`refreshIntervals` map, the never-populated `abortControllers` map, and `startRefreshInterval` / `stopRefreshInterval` / `clearAllIntervals`). Polling is handled by `PollingManager`, which `addLayer` wires up automatically; the legacy `refreshInterval` YAML field keeps working through that path. Only the dead code is gone — no schema fields changed.
- **`DataFetcher`**: `options.signal` is now honored correctly. The internal per-request controller (which also carries the timeout) aborts immediately if the caller's signal is already aborted, aborts (with the caller's reason) when the caller's signal fires, and the abort listener is removed from the external signal once the request settles so long-lived signals don't accumulate listeners across retries. Previously the code contained a no-op ternary (`options.signal ? new AbortController() : new AbortController()`) and never handled pre-aborted signals or listener cleanup.
