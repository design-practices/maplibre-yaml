---
title: "Sample content entry — Polygon via feature_ref"
summary: "Demonstrates buildMapConfigFromEntry resolving a `feature_ref` from a content collection item."
feature_ref:
  source: "./src/data/sample.geojson"
  match:
    property: "ref_id"
    equals: 1
  fillColor: "#3388ff"
  fillOpacity: 0.3
---

This markdown body renders alongside the map. The map is built at request
time by `buildMapConfigFromEntry(entry.data, globalMapConfig)`, which detects
that `feature_ref` is set on this entry and delegates to
`buildFeatureMapConfig`.

To exercise inline geometry instead, replace the `feature_ref` block with
one of:

```yaml
# inline single Point
location:
  coordinates: [-73.9826, 40.6725]
  name: "Inline point example"
  markerColor: "#e74c3c"
```

```yaml
# inline LineString
route:
  coordinates:
    - [-73.9890, 40.6790]
    - [-73.9870, 40.6760]
    - [-73.9855, 40.6730]
  name: "Inline line example"
  color: "#34495e"
  width: 3
```

```yaml
# inline Polygon
region:
  coordinates:
    - [[-73.9890, 40.6790], [-73.9810, 40.6790], [-73.9810, 40.6700], [-73.9890, 40.6700], [-73.9890, 40.6790]]
  name: "Inline polygon example"
  fillColor: "#27ae60"
  fillOpacity: 0.25
```

The strict schema (`getCollectionItemWithFeatureRefSchema`) rejects any
entry that declares `feature_ref` alongside an inline geometry field —
declare only one.
