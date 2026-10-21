---
"@maplibre-yaml/core": minor
---

A layer's own legend entry (`legend: { label, color }`) now makes the map show a legend, even without a `legend:` block — as a classified layer already does in 0.9. Before, the entry was silently ignored unless the document also had a `legend:` block, so a map that described its layers for the legend showed none. The automatic legend uses the defaults (top-left, open, headed "Legend"); a `legend:` block still places and titles it, and `legend: false` turns it off. Stories get the same in their pinned legend.
