---
status: pending
priority: p1
issue_id: 014
tags: [code-review, performance, correctness]
dependencies: []
---

# Concurrent `loadFeatureFile` calls double-parse the same file

## Problem Statement

`loadFeatureFile` (`feature-ref-loader.ts:115-198`) is async with multiple `await` points (`stat`, `readFile`) before the cache `set`. Astro 5's content-collection rendering parallelizes page builds via Vite's worker pool. Two concurrent calls for the same uncached file will both pass the `cached === undefined` check at line 135, both read+parse, and the second `set` clobbers the first.

For a 50MB file that's ~2s of parse time and ~500MB peak heap **twice** — potentially OOMing the build worker on memory-constrained CI runners. Smaller files: just wasted work, not corruption.

There's also a related TOCTOU between `stat` and `readFile`: file replaced mid-call means the cached `mtimeMs` reflects the prior file while contents reflect the new one. The mtime check on the next call self-heals this, but it's worth being aware of.

Reviewer: performance-oracle (P1), data-integrity-guardian (P2 wasted-work). Architecture-strategist also flagged the cache lifecycle concern.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:115-198` — `loadFeatureFile`

## Proposed Solutions

### Option A: In-flight Promise dedupe (recommended)

Add a sibling `Map<absPath, Promise<FeatureCollection>>` for in-flight loads. On cache miss, set the Promise before awaiting; subsequent callers await the same Promise; clean up in `.finally`.

```typescript
const inFlight = new Map<string, Promise<FeatureCollection>>();

async function loadFeatureFile(srcPath: string): Promise<FeatureCollection> {
  const absPath = resolve(process.cwd(), srcPath);
  const pending = inFlight.get(absPath);
  if (pending) return pending;

  const promise = doLoad(absPath).finally(() => inFlight.delete(absPath));
  inFlight.set(absPath, promise);
  return promise;
}

async function doLoad(absPath: string): Promise<FeatureCollection> {
  // existing stat / readFile / parse / cache.set logic
}
```

- Pros: guaranteed single parse per file per build; minimal API surface change; ~15 LOC
- Cons: adds a second module-level Map; in-flight entries live until promise resolves
- Effort: Small
- Risk: Low

### Option B: Synchronous lock via shared Promise

Same idea but with explicit lock/unlock semantics (more verbose).

- Pros: more explicit
- Cons: more code than A
- Effort: Small
- Risk: Low

### Option C: Document as "concurrent calls may double-parse"

Don't fix; just document.

- Pros: zero code change
- Cons: real OOM risk on large files in parallel builds
- Effort: Trivial
- Risk: Medium-High depending on file size and build parallelism

## Recommended Action

(Filled during triage — Option A. The fix is small and the OOM risk is real for files >50MB.)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-loader.ts`

**Test additions:**
- Concurrent `Promise.all([loadFeatureFile(p), loadFeatureFile(p)])` — verify only one `readFile` happens (mock fs or count via a wrapper)

## Acceptance Criteria

- [ ] Two parallel calls to `loadFeatureFile(samePath)` with cache cold result in exactly one `readFile` and one `JSON.parse`
- [ ] Both callers receive the same parsed FeatureCollection instance
- [ ] If the in-flight call rejects, both callers receive the rejection
- [ ] `clearFeatureCache()` clears in-flight Promises too (or documents that it doesn't affect them)

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:performance-oracle`
- Review by `compound-engineering:review:data-integrity-guardian`
