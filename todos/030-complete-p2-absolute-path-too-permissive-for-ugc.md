---
status: pending
priority: p2
issue_id: 030
tags: [code-review, security, path-traversal]
dependencies: [029]
---

# Absolute paths bypass containment entirely; risky for UGC contexts

## Problem Statement

`resolveSourcePath` allows absolute `source` values unconditionally (`packages/astro/src/utils/feature-ref-loader.ts:184`). The rationale ("deliberate user intent for tests, monorepos") holds when the schema author controls all frontmatter. It does NOT hold when frontmatter comes from user-generated content (CMS, decap-cms, contentlayer-style importers, MDX uploads).

In a UGC context, an author submitting `feature_ref: { source: "/etc/passwd", featureId: "x" }` reaches `loadFeatureFile`, which reads the file and emits a parse error containing the absolute path. The error message becomes an oracle for file existence + size on the build server.

## Findings

- `packages/astro/src/utils/feature-ref-loader.ts:184` — `if (!isAbsolute(srcPath))` short-circuits containment for absolute paths
- The README does not currently document this as a security property of the schema

## Proposed Solutions

**Option 1: Require explicit opt-in for absolute paths**

Add an option (or env var, or `getCollectionItemWithFeatureRefSchema({ allowAbsoluteFeatureRefs: true })`) that gates absolute path acceptance. Default: reject.

- Pros: secure by default, opt-in for legitimate use cases
- Cons: existing tests using tmpdir paths break unless they pass the flag
- Effort: M
- Risk: Medium

**Option 2: Document the constraint, leave behavior unchanged**

Add a prominent security note in `packages/astro/README.md` and the JSDoc for `FeatureRefSchema` warning that absolute paths bypass containment, and that consumers exposing the schema to untrusted content must validate `source` themselves.

- Pros: zero behavior change, no breaking tests
- Cons: relies on consumers reading docs; the schema is still unsafe by default
- Effort: S
- Risk: Low (in terms of code regressions); High (in terms of consumer footguns)

**Option 3: Auto-restrict to repo-relative when an environment signal is present**

Detect Astro's content-collection context (e.g., presence of `astro:content` import in the call chain or a known env var) and apply stricter rules there. Tests and direct callers retain the carve-out.

- Pros: keeps tests easy, locks down the production path
- Cons: hard to detect reliably; adds magic
- Effort: M
- Risk: High (detection fragility)

## Recommended Action

Pending. Lean toward Option 1 (opt-in flag) since this PR introduces the surface; locking it down now is cheaper than later. Worth a design discussion: is `feature_ref` ever expected to legitimately resolve outside the project root in production?

## Technical Details

- **Affected files**: `packages/astro/src/utils/feature-ref-loader.ts`, `packages/astro/src/utils/feature-ref-schema.ts`, tests
- **Dependency on 029**: the symlink fix should land first; this finding tightens the absolute-path carve-out the symlink fix preserves

## Acceptance Criteria

- [ ] Default behavior rejects absolute `source` values
- [ ] Opt-in path (config option or schema-factory parameter) is documented
- [ ] Existing tests using tmpdir absolute paths updated to use the opt-in
- [ ] README documents the security property

## Work Log

- 2026-05-11: Identified by security-sentinel during post-P2 code review

## Resources

- See todo 029 for related symlink finding
