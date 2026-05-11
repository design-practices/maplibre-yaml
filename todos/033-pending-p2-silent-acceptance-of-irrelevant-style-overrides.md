---
status: pending
priority: p2
issue_id: 033
tags: [code-review, ux, dx]
dependencies: []
---

# `feature_ref` silently accepts style overrides that don't apply to the resolved geometry

## Problem Statement

`FeatureRefSchema` (`packages/astro/src/utils/feature-ref-schema.ts`) spreads ALL three style field groups (`PointStyleFields`, `PolygonStyleFields`, `LineStyleFields`) onto the ref because the geometry type is unknown at schema time — it's resolved at load time.

The schema accepts a ref with `markerColor` on a `Polygon` feature, or `fillColor` on a `Point` feature, or `width` on a `MultiPolygon`. `dispatchByGeometry` in `feature-ref-builder.ts` then silently ignores the fields that don't apply to the resolved geometry. The author gets no signal that their override was no-op.

The architecturally-cleaner alternative (discriminated union by `kind: "point" | "polygon" | "line"`) would force authors to redundantly declare what GeoJSON already encodes, so the current spread is the right schema shape. The fix is at dispatch time, not at schema time.

## Findings

- `packages/astro/src/utils/feature-ref-schema.ts:127-129` — spread of all three style groups
- `packages/astro/src/utils/feature-ref-builder.ts:199-368` — dispatch picks only the fields that apply, silently drops the rest
- No test asserts a warning is emitted on mismatched style overrides

## Proposed Solutions

**Option 1: Emit a build-time warning when a style override doesn't apply**

In `dispatchByGeometry`, after the geometry type is known, check whether ref-supplied style fields match the geometry family. If not, `console.warn` once per (source, featureId) pair with a clear message.

```typescript
function warnIrrelevantStyles(ref: FeatureRef, geomType: GeoJSONGeomType): void {
  const irrelevant: string[] = [];
  const isPoint = geomType === "Point" || geomType === "MultiPoint";
  const isPoly = geomType === "Polygon" || geomType === "MultiPolygon";
  const isLine = geomType === "LineString" || geomType === "MultiLineString";
  if (ref.markerColor && !isPoint) irrelevant.push("markerColor");
  if ((ref.fillColor || ref.strokeColor || ref.fillOpacity !== undefined) && !isPoly)
    irrelevant.push(...["fillColor", "strokeColor", "fillOpacity"].filter(k => ref[k] !== undefined));
  if ((ref.color || ref.width !== undefined) && !isLine) {
    if (ref.color) irrelevant.push("color");
    if (ref.width !== undefined) irrelevant.push("width");
  }
  if (irrelevant.length) {
    console.warn(
      `feature_ref: style override(s) [${irrelevant.join(", ")}] do not apply ` +
        `to ${geomType} geometry from "${ref.source}"; they will be ignored.`,
    );
  }
}
```

- Pros: catches real author mistakes; no schema gymnastics; one-time output per call
- Cons: noisy for repeated misuse without per-key dedupe; warning doesn't fail the build
- Effort: S
- Risk: Low

**Option 2: Throw a build-time error instead of warning**

- Pros: forces correctness
- Cons: breaks authors who deliberately set "speculative" style fields knowing the schema doesn't know geometry type yet
- Effort: S
- Risk: Medium (DX regression)

**Option 3: Do nothing; document the spread behavior**

Update FeatureRefSchema JSDoc explicitly: "Style overrides not applicable to the resolved geometry are silently ignored. The schema cannot enforce this because geometry type is resolved at load time."

- Pros: zero code change
- Cons: real footgun remains; authors copy/paste refs across features and don't notice the mismatch
- Effort: S
- Risk: Low (code-wise); Medium (DX-wise)

## Recommended Action

Option 1. Warnings are the right severity: they catch the mistake without blocking the build.

## Technical Details

- **Affected files**: `packages/astro/src/utils/feature-ref-builder.ts` (add helper + call after `findFeature`)
- **Test**: warning emitted for a `markerColor` set on a Polygon ref; not emitted when types align

## Acceptance Criteria

- [ ] Warning emitted (via `console.warn`) when ref style fields don't apply to resolved geometry
- [ ] Warning text includes geometry type and the irrelevant field names
- [ ] No warning when ref style fields match the geometry family
- [ ] Test coverage for at least 2 mismatch cases

## Work Log

- 2026-05-11: Identified by architecture-strategist during post-P2 code review

## Resources

- See P2-019 (style-field dedupe) for the spread pattern that made this surface visible
