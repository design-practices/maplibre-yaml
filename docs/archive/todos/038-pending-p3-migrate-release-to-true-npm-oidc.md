---
status: pending
priority: p3
tags: [release, ci, npm, security]
dependencies: []
---

# Migrate release publishing to true npm OIDC trusted publishing

## Problem Statement

`release.yml` was written for npm OIDC trusted publishing (`id-token: write`, no token), but the publish command runs through pnpm, and the repo pins `pnpm@9.4.0` — OIDC trusted-publishing support landed in pnpm 10.13. The unauthenticated PUT was masked by npm as `E404 Not Found`, which blocked the first-ever automated publish (0.3.0). Interim fix: a granular npm automation token as the `NPM_TOKEN` secret, passed as `NODE_AUTH_TOKEN`.

## Proposed Action

1. Upgrade `packageManager` to pnpm >= 10.13 (test the workspace thoroughly: pnpm 10 changes lifecycle-script defaults; lockfile stays v9).
2. Configure Trusted Publisher on npmjs.com for @maplibre-yaml/core, /astro, /cli (GitHub Actions: design-practices/maplibre-yaml, release.yml).
3. Remove `NODE_AUTH_TOKEN` from release.yml and revoke the automation token.
4. Verify with an alpha publish through the workflow itself (the local-alpha flow bypasses this path).

## Acceptance Criteria

A release publishes from CI with no npm token secret in the repository.

## Work Log

- 2026-07-05: Created while unblocking the 0.3.0 publish (E404 diagnosis).
