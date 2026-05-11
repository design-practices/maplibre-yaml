---
status: pending
priority: p2
issue_id: 020
tags: [code-review, pattern, error-handling]
dependencies: []
---

# `GeoJSONLoadError` vs `YAMLLoadError` drift on `cause` field

## Problem Statement

`GeoJSONLoadError` (`feature-ref-loader.ts:229-252`) accepts an ES2022 `cause` field; `YAMLLoadError` (`loader.ts:63-80`) does not. Both errors otherwise have the same shape (`name`, `message`, `filePath`, `errors[]`). Two near-identical error classes diverging on a foundational field is exactly the drift that gets harder to consolidate over time.

The plan documents this as forward-compat constraint #4 ("future shared-base-class introduction"), but the constraint was only applied to the new class.

## Findings

- `packages/astro/src/utils/loader.ts:63-80` — `YAMLLoadError` lacks `cause` parameter
- `packages/astro/src/utils/feature-ref-loader.ts:229-252` — `GeoJSONLoadError` has `cause`

Reviewer: pattern-recognition (P2).

## Proposed Solutions

### Option A: Backport `cause` to `YAMLLoadError` (recommended)

One paragraph of code in `loader.ts`. No behavior change for existing callers since `cause` is optional. Realizes the forward-compat plan.

- Pros: cheap; eliminates drift
- Cons: requires bumping `loader.ts` for what's nominally a separate concern
- Effort: Trivial
- Risk: Low

### Option B: Extract `MaplibreYamlLoadError` base class

Both errors extend the base. Plan flagged this as a V2 candidate.

- Pros: justifies the existence of the `cause` field; consumers can `catch` either via the base
- Cons: larger change; new exported class
- Effort: Small
- Risk: Low

### Option C: Accept the drift, document in plan

- Pros: zero work
- Cons: drift persists
- Effort: Trivial
- Risk: Medium

## Recommended Action

(Filled during triage — Option A as a minimum; Option B if/when consumers ask for unified catching)

## Acceptance Criteria

- [ ] Both error classes accept `cause` consistently OR a shared base provides it
- [ ] Existing `YAMLLoadError` callers unaffected (additive change)

## Resources

- Review by `compound-engineering:review:pattern-recognition-specialist`
- Plan: forward-compat constraint #4
