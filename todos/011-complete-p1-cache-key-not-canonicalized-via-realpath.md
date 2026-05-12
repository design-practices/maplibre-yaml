---
status: pending
priority: p1
issue_id: 011
tags: [code-review, architecture, correctness]
dependencies: []
---

# Cache key not canonicalized via realpath; symlinks bypass cache

## Problem Statement

`loadFeatureFile` resolves `srcPath` via `path.resolve(process.cwd(), srcPath)` and uses the result as both the file path and the cache key. `path.resolve` does NOT follow symlinks. Two consequences:

1. **Double-cache**: two refs pointing at the same physical file via different symlinks become two cache entries holding distinct parsed objects (memory waste, potential drift).

2. **Lazy index defeated**: `matchByProperty` (`feature-ref-loader.ts:351-357`) compares cached `entry.fc !== fc` by reference — a reload through a symlinked path returns a different `fc` object, so the index path silently falls back to linear scan even on the second access.

A reload through a symlinked path produces a fresh `CacheEntry` with empty `indexByProperty` and `propertyAccessCount`, defeating the lazy-index optimization for files that have it.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:118` — `resolve(process.cwd(), srcPath)` does not call `realpath`
- `packages/astro/src/utils/feature-ref-loader.ts:351` — `matchByProperty` re-resolves the same way; reference equality check at line 353 silently falls through

Reviewer: architecture-strategist (P1). Related security concern in todo 013 (symlink can also enable path traversal).

## Proposed Solutions

### Option A: Use `fs.realpath` to canonicalize the cache key (recommended)

```typescript
import { realpath } from "fs/promises";

async function loadFeatureFile(srcPath: string): Promise<FeatureCollection> {
  const absPath = await realpath(resolve(process.cwd(), srcPath))
    .catch(() => resolve(process.cwd(), srcPath));  // fall back to non-canonical path on broken symlinks
  // ... rest as before
}
```

- Pros: correct handling of symlinks; index works as intended
- Cons: extra syscall per load (~10-50µs); behavior with broken symlinks needs the fallback
- Effort: Small (~10 LOC)
- Risk: Low

### Option B: Document symlink behavior as "not supported"

Don't fix; just warn users.

- Pros: zero code change
- Cons: surprises users who legitimately use symlinks (e.g., monorepo workspaces with linked data dirs); silent index bypass remains
- Effort: Trivial
- Risk: Medium

### Option C: Add `lstat` check and reject symlinks

Throw if the resolved path is a symlink.

- Pros: forces user to use canonical paths
- Cons: hostile to legitimate symlink use; no graceful path
- Effort: Small
- Risk: High

## Recommended Action

(Filled during triage — Option A)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-loader.ts`

**Test additions:**
- Add a symlink test: write `/tmp/foo.geojson`, create symlink `/tmp/bar.geojson` → `/tmp/foo.geojson`, load both paths, verify same cache entry returned

## Acceptance Criteria

- [ ] `loadFeatureFile("./real.geojson")` and `loadFeatureFile("./symlink.geojson")` (where symlink → real) share a cache entry
- [ ] Lazy index works correctly across symlinked paths
- [ ] Broken symlinks produce `GeoJSONLoadError`, not raw fs errors
- [ ] Test covers the symlink scenario

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:architecture-strategist`
- Related: todo 013 (path traversal — symlink is one of the vectors)
