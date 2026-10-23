---
status: pending
priority: p1
issue_id: 029
tags: [code-review, security, path-traversal]
dependencies: []
---

# Symlink inside project root bypasses path-traversal containment

## Problem Statement

`resolveSourcePath` in `packages/astro/src/utils/feature-ref-loader.ts` (lines 175-208) checks for `..`-style traversal in the resolved relative path BEFORE canonicalizing symlinks via `realpath`. A symlink that lives inside the project root but points OUT defeats the containment check.

Reproduction: place `src/data/oops.geojson` as a symlink to `/etc/passwd` (or any file outside the project root). The frontmatter `feature_ref: { source: "./src/data/oops.geojson" }`:

1. Passes `isAbsolute("./src/data/oops.geojson")` → not absolute, enter branch
2. `resolve(cwd, "./src/data/oops.geojson")` → `<cwd>/src/data/oops.geojson`
3. `relative(cwd, "<cwd>/src/data/oops.geojson")` → `"src/data/oops.geojson"` (no `..`)
4. Containment check passes
5. `realpath("<cwd>/src/data/oops.geojson")` → `/etc/passwd`
6. Loader reads, parses, errors out with path leaked in error message

This is exploitable when content collections accept any author-supplied or CMS-supplied `feature_ref` value, or when a build pipeline syncs symlinks from upstream sources.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:184-196` — containment check on pre-realpath path
- `packages/astro/src/utils/feature-ref-loader.ts:203-207` — realpath after the check; result can resolve outside `projectRoot`
- The fix is mechanical: re-check containment against the realpath result, not the pre-realpath resolved path

## Proposed Solutions

**Option 1: Re-check containment on the realpath result (recommended)**

```typescript
const resolved = resolve(projectRoot, srcPath);
if (!isAbsolute(srcPath)) {
  const rel = relative(projectRoot, resolved);
  if (rel.startsWith("..")) throw new GeoJSONLoadError(...);
}
let canonical: string;
try {
  canonical = await realpath(resolved);
} catch {
  return resolved; // file doesn't exist yet; subsequent stat will error
}
// Re-check after canonicalization — symlinks inside projectRoot may
// point OUT, and we still don't want to read those.
if (!isAbsolute(srcPath) && relative(projectRoot, canonical).startsWith("..")) {
  throw new GeoJSONLoadError(
    `feature_ref.source symlink resolves outside the project root. ` +
      `Got: "${srcPath}" -> "${canonical}". Reject the symlink or use an absolute path.`,
    canonical,
  );
}
return canonical;
```

- Pros: minimal change, preserves the absolute-path-allowed semantics
- Cons: adds one more `relative()` call
- Effort: S
- Risk: Low

**Option 2: Re-check unconditionally (also reject absolute symlinks pointing outside)**

Drop the `!isAbsolute(srcPath)` guard on the post-realpath check. Forces ALL paths (relative and absolute) to canonicalize inside `projectRoot`.

- Pros: simpler invariant — "canonical path is always inside projectRoot"
- Cons: breaks the deliberate "absolute paths allowed for tests/monorepos" carve-out, which several existing tests rely on
- Effort: S
- Risk: Medium — coordinated test updates

## Recommended Action

Option 1. Adds a 5-line re-check, preserves existing carve-outs, closes the bypass.

## Technical Details

- **Affected files**: `packages/astro/src/utils/feature-ref-loader.ts` (lines 175-208)
- **Test additions**:
  - `tests/utils/feature-ref-loader.test.ts` — new test that creates a symlink inside tmpdir pointing OUTSIDE tmpdir, asserts `GeoJSONLoadError` thrown before any read
  - Edge case: dangling symlink (realpath rejects) — current code already falls back to non-canonical path; verify the fallback doesn't bypass
- **No schema change**

## Acceptance Criteria

- [ ] Creating a relative symlink inside `cwd` that points outside `cwd` throws `GeoJSONLoadError` with a clear message
- [ ] Absolute-path tests (using tmpdir realpath) still pass
- [ ] Dangling symlinks still produce a clear ENOENT error (not silently bypass)
- [ ] All 248 existing tests pass

## Work Log

- 2026-05-11: Identified by security-sentinel during post-P2 code review

## Resources

- Code review session in PR #20
- Original P1-013 fix: `c6670ad` — first iteration of the containment check
