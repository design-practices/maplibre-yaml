---
status: pending
priority: p3
tags: [docs, roadmap, release, dx]
dependencies: []
---

# Public roadmap + release-history page on the docs site

## Problem Statement

Release history and forward direction live only in scattered internal artifacts (`plans/`, `todos/`, per-package `CHANGELOG.md`, the auto-memory roadmap file). There is no single user-facing page that says what shipped in each release, what each release accomplished, and where the library is headed. Both maintainers and the ~600 weekly installers lack a canonical "what's here / what's next" reference, and the internal roadmap has no public mirror.

## Proposed Action

Add a roadmap page to the Starlight docs site (e.g. `docs/src/content/docs/roadmap.mdx`, linked in the sidebar) that carries two halves:

1. **Release history** — one entry per published release (0.3.0, 0.3.1, 0.4.0, …) summarizing the changelog in user terms, linking each to its package `CHANGELOG.md` / GitHub release. Keep it appendable at release time (a step in the Operational Notes release checklist, or a docs build step that reads the changesets output).
2. **Where things are headed** — a lightweight, honest forward view mirroring the phased roadmap (stabilization → JSON Schema/validation → positioning & examples → versioning RFC → GeoJSON alignment), plus the parallel perf track. Framed for users, not just maintainers; no hard dates.

Coordinate with Phase 3 (`plans/docs-positioning-and-examples.md`) — this page is part of the positioning/docs work and shares the "what is this for / where is it going" narrative. Decide whether the forward view is generated from the meta-plan or hand-maintained.

## Acceptance Criteria

A single docs-site page lists every published release with a user-facing changelog summary and a forward-looking roadmap section, discoverable from the sidebar, with a defined update step so it stays current at each release.

## Work Log

- 2026-07-08: Created at Mario's request during the quality/adoption release-train planning, to keep release history and direction visible to users and maintainers. Related: the release-train plan (`docs/plans/2026-07-08-001-feat-quality-adoption-release-train-plan.md`) and Phase 3 docs work.
