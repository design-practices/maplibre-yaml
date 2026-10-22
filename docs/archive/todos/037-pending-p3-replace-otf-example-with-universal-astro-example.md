---
status: pending
priority: p3
issue_id: 037
tags: [examples, astro, docs, dx]
dependencies: []
---

# Replace the otf example with a simpler, universal Astro example

## Problem Statement

`examples/astro/otf` is a snapshot of a real project (Gowanus Oversight Task Force site): ~8 MB including photos, gitignored (never tracked), with real-world content that makes it a poor teaching artifact. It demonstrates the feature-ref system in production shape but is too specific, too heavy, and invisible to anyone cloning the repo. Decision (Mario, 2026-07-04): replace it rather than commit it.

## Proposed Action

1. Build a new tracked example app (e.g. `examples/astro/site/`) that is small, generic, and demonstrates the Astro integration surface end to end:
   - `<Map>` with a YAML config and with a built config (`buildMapConfigFromEntry`)
   - content collection with `feature_ref` pointing at one small bundled GeoJSON file (a handful of features, no real-project data)
   - `loadGlobalMapConfig` + `maps.yaml` global defaults (exercises the inheritance shipped in Phase 1)
   - one `<Scrollytelling>` page and one `<FullPageMap>` page — the components no runnable example currently uses (overlaps with the Phase 3 plan `plans/docs-positioning-and-examples.md`; coordinate so the work isn't done twice)
2. Use `workspace:*` deps, no nested lockfile, changesets-ignored name (follow `@maplibre-yaml/example-astro-minimal`).
3. Delete `examples/astro/otf` locally and remove the `/examples/astro/otf` line from `.gitignore` once nothing references it.
4. Decide whether `minimal` and the new example both stay (minimal = feature-ref showcase, site = whole-integration walkthrough) or merge.

## Acceptance Criteria

- A tracked, buildable (`pnpm --filter <example> build` in CI) Astro example demonstrating Map, Scrollytelling, FullPageMap, feature_ref, and global config inheritance with generic data.
- otf directory gone; `.gitignore` entry removed; no lockfile pollution from untracked workspace members.

## Work Log

- 2026-07-04: Created at Mario's request during Phase 1 wrap-up (PR #41). Context: otf was found to be untracked/gitignored during Workstream G; its local package.json was fixed (name, workspace:*) as a stopgap.
