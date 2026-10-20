---
"@maplibre-yaml/core": patch
---

A classified layer whose `field:` (or `normalize:`) has no usable value in the loaded data now explains why the map is one colour. When no feature has the property (a typo or a different capitalization) or, for numeric classes, no feature holds a number in it (a text field), the console warns and, while you develop, the map's author notes say so. The message names the field, suggests the closest property name (case-insensitive) and lists the data's properties. When every feature is no data, the legend shows only the "No data" line instead of an "All values" class.
