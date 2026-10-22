---
status: pending
priority: p2
issue_id: 031
tags: [code-review, architecture, security]
dependencies: [029]
---

# `process.cwd()` is the wrong project-root boundary in monorepos

## Problem Statement

`resolveSourcePath` uses `process.cwd()` as the project-root boundary (`packages/astro/src/utils/feature-ref-loader.ts:176`). In a pnpm/Yarn workspace where the Astro project lives at `packages/site/` but the build runs from the repo root, `cwd` equals the repo root. A relative path `../other-package/secrets.json` then resolves cleanly inside the boundary, because the boundary is the wrong directory.

The correct boundary is Astro's `config.root` (typed `URL`, accessible from the integration), which is the directory containing `astro.config.mjs`.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:176` — `const projectRoot = process.cwd();`
- The loader is decoupled from the Astro integration, so it has no direct way to read `config.root`. Plumbing it through is the right shape but requires API changes
- Consumers using the package outside Astro (direct calls to `loadFeatureFile` from a build script) are not affected — they already pick `cwd` deliberately

## Proposed Solutions

**Option 1: Accept `projectRoot` as a parameter; default to `cwd` with a warning**

```typescript
export async function loadFeatureFile(
  srcPath: string,
  options?: { projectRoot?: string },
): Promise<FeatureCollection> { ... }
```

The Astro integration (in `astro-integration.ts` or similar) passes Astro's `config.root` through. Direct callers can override.

- Pros: explicit, testable, no magic
- Cons: API surface change on a documented function
- Effort: M
- Risk: Low (additive parameter)

**Option 2: Set via module-level setter (e.g., `setProjectRoot`)**

Called once by the integration at startup. Subsequent `loadFeatureFile` calls read it.

- Pros: no per-call API change
- Cons: module-level mutable state (the exact pattern we just removed in P1-012)
- Effort: S
- Risk: High (anti-pattern we just deleted)

**Option 3: Read from `process.env.ASTRO_PROJECT_ROOT` set by the integration**

- Pros: minimal API surface
- Cons: env-var coupling between integration and loader; brittle
- Effort: S
- Risk: Medium

## Recommended Action

Option 1. Threading the project root through is honest about the dependency.

## Technical Details

- **Affected files**: `packages/astro/src/utils/feature-ref-loader.ts`, `packages/astro/src/utils/feature-ref-builder.ts` (call site), `packages/astro/src/utils/entry-builder.ts` (call site)
- **Integration plumbing**: requires the Astro integration entry to expose Astro's `config.root` to the builders. Investigate current integration shape.

## Acceptance Criteria

- [ ] `loadFeatureFile`, `buildFeatureMapConfig`, `buildMapConfigFromEntry` accept an optional `projectRoot` (or settle on a different name like `cwd`)
- [ ] When called from Astro context, the integration passes `config.root.pathname`
- [ ] When called from direct code (tests, scripts), `cwd()` remains the default
- [ ] Tests cover both monorepo case and standalone case

## Work Log

- 2026-05-11: Identified by security-sentinel during post-P2 code review

## Resources

- Astro integration types: https://docs.astro.build/en/reference/integrations-reference/
