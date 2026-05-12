---
status: pending
priority: p2
issue_id: 016
tags: [code-review, security, performance, dos]
dependencies: []
---

# No file-size cap before readFile (DoS / OOM risk)

## Problem Statement

`loadFeatureFile` calls `readFile(absPath, "utf-8")` (line 142) without checking `stats.size`. The plan documents a 100MB hard cap and 50MB warning, but neither is enforced.

A 200MB file: `readFile` allocates ~200MB string buffer, `JSON.parse` produces ~600MB-2GB object graph (5-10× expansion). On a 4GB CI runner with Astro/Vite already at ~1GB, this OOMs the build. Above ~512MB, `readFile` throws `ERR_STRING_TOO_LONG` (gracefully caught), but the silent OOM zone is 100-512MB.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:122-151` — `stat` call already happens at line 122, but `stats.size` is not checked before `readFile` at 142

Reviewers: security-sentinel (P2), performance-oracle (P2).

## Proposed Solutions

### Option A: Check `stats.size` between `stat` and `readFile` (recommended)

```typescript
const SOFT_WARN_BYTES = 50 * 1024 * 1024;
const HARD_ERROR_BYTES = 100 * 1024 * 1024;

if (stats.size > HARD_ERROR_BYTES) {
  throw new GeoJSONLoadError(
    `GeoJSON file ${absPath} is ${(stats.size / 1024 / 1024).toFixed(1)}MB, ` +
    `which exceeds the 100MB build-time limit. Pre-process to a smaller file or use a runtime tile/vector source.`,
    absPath,
  );
}
if (stats.size > SOFT_WARN_BYTES) {
  console.warn(`[maplibre-yaml] Large GeoJSON file: ${absPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
}
```

- Pros: enforces the documented budget; no surprise OOMs
- Cons: thresholds may need tuning per platform
- Effort: Trivial (~10 LOC)
- Risk: Low

### Option B: Make thresholds configurable via global config

Allow consumers to override.

- Pros: flexibility
- Cons: more API surface
- Effort: Small-Medium

## Recommended Action

(Filled during triage — Option A)

## Acceptance Criteria

- [ ] Files >100MB throw `GeoJSONLoadError` before `readFile` is called
- [ ] Files >50MB log a warning
- [ ] Test covers the threshold behavior

## Resources

- Review by `compound-engineering:review:security-sentinel`
- Review by `compound-engineering:review:performance-oracle`
