---
status: pending
priority: p3
issue_id: 036
tags: [ci, maplibre-gl, peer-deps, testing]
dependencies: [workstream-b-named-imports]
---

# CI matrix should test maplibre-gl v5

## Problem Statement

`@maplibre-yaml/core` advertises `maplibre-gl` peer range `^3.0.0 || ^4.0.0 || ^5.0.0`, but CI only ever installs and tests against the single version pinned in the lockfile. The v5 breakage that shipped in 0.2.1/0.2.2 (default-export vs named-import churn) went undetected because nothing exercises the v5 surface.

## Proposed Action

Once named imports land (Workstream B of plans/fix-shipped-but-broken.md), add a CI job to `.github/workflows/ci.yml` that:

1. Installs `maplibre-gl@5` in `packages/core` (override/`pnpm add -D maplibre-gl@5 --filter @maplibre-yaml/core` in the job, without committing a lockfile change).
2. Runs the core test suite (`pnpm --filter @maplibre-yaml/core test`) against it.

This locks in that the import style and API usage are compatible with the newest advertised peer major, so the peer range can't silently rot again.

## Acceptance Criteria

CI has a job that runs core tests against maplibre-gl v5 and fails if the v5 import surface breaks.

## Work Log

- 2026-07-04: Created during Workstream G (repo hygiene) of plans/fix-shipped-but-broken.md. Blocked on Workstream B (named imports) landing first.
