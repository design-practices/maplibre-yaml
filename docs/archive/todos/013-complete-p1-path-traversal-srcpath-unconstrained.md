---
status: pending
priority: p1
issue_id: 013
tags: [code-review, security]
dependencies: [011]
---

# Path traversal: `feature_ref.source` is unconstrained

## Problem Statement

`loadFeatureFile` calls `path.resolve(process.cwd(), srcPath)` and reads from whatever absolute path that resolves to. The `srcPath` value comes from frontmatter — which in many setups is user-supplied content (CMS-driven, open-PR workflows with external contributors, etc.). Without a containment check, a malicious frontmatter value can read arbitrary files:

- `../../etc/passwd` → `/etc/passwd`
- `/etc/passwd` → absolute paths win immediately under POSIX `path.resolve`
- `\\server\share\file.geojson` → on Windows, UNC paths bypass cwd
- Symlink that points outside project root (see todo 011)

For a build-time tool whose errors land in CI logs, this is a build-time oracle for filesystem reconnaissance against the CI runner. Worse, on a CI system with secrets in the filesystem (`.env`, `~/.ssh/`, GitHub Actions runner files at `/home/runner/work/_temp/*`), a malicious GeoJSON file dropped at a known path could be successfully parsed and used by the build, causing arbitrary attacker-influenced map content (or build-step crashes) keyed on private file presence.

Reviewer: security-sentinel (P2 — escalating to P1 because the threat model includes UGC-driven frontmatter).

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:118` — `loadFeatureFile`
- `packages/astro/src/utils/feature-ref-loader.ts:351` — `matchByProperty` re-resolves the same way

## Proposed Solutions

### Option A: Project-root containment check (recommended)

Reject any resolved path that escapes `process.cwd()`:

```typescript
import { resolve, relative, isAbsolute } from "path";

const projectRoot = process.cwd();
const absPath = resolve(projectRoot, srcPath);
const rel = relative(projectRoot, absPath);
if (rel.startsWith("..") || isAbsolute(rel)) {
  throw new GeoJSONLoadError(
    `feature_ref.source must resolve inside the project root. ` +
      `Got: ${srcPath} -> ${absPath}`,
    absPath,
  );
}
```

Apply the same check in `matchByProperty`'s re-resolution for defense-in-depth.

- Pros: simple, robust, well-known pattern
- Cons: blocks legitimate use cases like reading from a sibling repo via absolute path (rare)
- Effort: Small (~6 lines)
- Risk: Low

### Option B: Allowlist of source directories

Provide an option to configure allowed source directories:

```typescript
loadGlobalMapConfig({ ..., allowedFeatureSources: ["./src/data", "./public/data"] });
```

- Pros: more flexible than strict project-root containment
- Cons: requires global config plumbing; bigger API change
- Effort: Medium
- Risk: Low

### Option C: Document as "trusted input only"

Don't constrain; warn users that `feature_ref.source` should not come from untrusted input.

- Pros: zero code change
- Cons: contract is invisible; users with UGC-driven frontmatter unknowingly expose their CI
- Effort: Trivial
- Risk: High for any UGC scenario

## Recommended Action

(Filled during triage — Option A as default; consider Option B for future flexibility)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-loader.ts`

**Test additions:**
- Reject `../../etc/passwd`-style paths
- Reject absolute paths outside project root
- Reject UNC paths (Windows)
- Allow legitimate project-relative paths
- Allow paths under cwd that use `..` but resolve back inside (e.g., `./src/../src/data/x.geojson`)

## Acceptance Criteria

- [ ] `loadFeatureFile("../../etc/passwd")` throws `GeoJSONLoadError` before any file IO
- [ ] `loadFeatureFile("/etc/passwd")` throws `GeoJSONLoadError`
- [ ] `loadFeatureFile("./src/data/foo.geojson")` works as before
- [ ] Test covers each of the above

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:security-sentinel`
- Related: todo 011 (symlink handling, also affects path containment)
