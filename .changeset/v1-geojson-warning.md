---
"@maplibre-yaml/core": minor
---

Warn on malformed inline GeoJSON `data` under format v1 (ml-ldv). v1 keeps
`source.data` as permissive (`z.any()`) for byte-for-byte compatibility —
MapLibre tolerates loosely-conformant geometry — so genuinely broken inline
GeoJSON used to pass validation silently. It now surfaces a validation
**warning** that names the RFC 7946 problem; the document still parses and
renders. The check is self-gating on the field schema, so format v2 (where the
same data is already a hard error) never double-reports it.

Note: like other non-deprecation warnings, this promotes to an error under
`mlym validate --strict` / CI, so upgrading may surface a CI failure for a
document that already contained malformed inline geometry — the fix is to
correct the geometry (or move it to a fetched `url:`).
