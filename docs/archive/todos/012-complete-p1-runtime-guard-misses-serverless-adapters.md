---
status: pending
priority: p1
issue_id: 012
tags: [code-review, architecture, correctness]
dependencies: []
---

# Runtime-environment guard misses real serverless adapters

## Problem Statement

`ensureBuildTimeContext` (`feature-ref-builder.ts:184-195`) checks `typeof process === "undefined" || typeof process.cwd !== "function"`. This misses the actually-dangerous deployment contexts:

- **Vercel Node runtime, Netlify Functions, AWS Lambda Node** — all have `process.cwd` defined; the guard does NOT fire. The function then fails later inside `loadFeatureFile` with a confusing `ENOENT` because the source file isn't bundled into the deployment.
- **Cloudflare Workers** — `process` may be polyfilled by the adapter or shimmed by Wrangler; behavior unpredictable.

The guard catches one narrow case (browser/edge with no Node shim) and misses the bigger class (deployed serverless where `cwd === "/var/task"` or similar). This makes the guard false advertising — the docs/JSDoc claim "build-time only" enforcement, but the runtime check doesn't actually enforce it.

## Findings

- `packages/astro/src/utils/feature-ref-builder.ts:184-195` — Current guard implementation
- `packages/astro/src/utils/feature-ref-builder.ts:148` — `buildFeatureMapConfig` calls the guard
- Plan-documented intent: "throws an actionable error if `buildFeatureMapConfig` is invoked in a deployed SSR adapter context"

Reviewer: architecture-strategist (P1).

## Proposed Solutions

### Option A: Soften the message; let `loadFeatureFile`'s ENOENT path do the work (recommended)

Remove or downgrade `ensureBuildTimeContext`. When `loadFeatureFile` hits ENOENT, dress the error message with deployment-context hints when `process.cwd()` looks suspicious (`/var/task`, `/tmp`, no `package.json` upward).

```typescript
} catch (cause) {
  const cwd = process.cwd();
  const looksLikeServerless = cwd === "/var/task" || cwd === "/tmp" || ...;
  const hint = looksLikeServerless
    ? "This appears to be a deployed serverless context (cwd is /var/task or similar). " +
      "buildFeatureMapConfig is build-time only -- resolve the feature ref at build time " +
      "and pass the resulting MapBlock to the page."
    : "Path is resolved from project root (cwd: " + cwd + ").";
  throw new GeoJSONLoadError(`Cannot find GeoJSON file: ${absPath}. ${hint}`, ...);
}
```

- Pros: more accurate (catches the actual failure case); removes false advertising
- Cons: doesn't catch the case proactively — only when load is attempted
- Effort: Small
- Risk: Low

### Option B: Strengthen the guard with serverless-context detection

Detect known serverless cwd patterns and throw upfront:

```typescript
function isServerlessContext(): boolean {
  const cwd = process.cwd();
  return (
    cwd === "/var/task" ||             // AWS Lambda
    cwd === "/var/runtime" ||          // older Lambda
    cwd === "/tmp" ||                  // various
    process.env.VERCEL === "1" ||
    process.env.NETLIFY === "true" ||
    process.env.CLOUDFLARE_WORKER === "true" ||
    !!process.env.LAMBDA_TASK_ROOT
  );
}

function ensureBuildTimeContext(source: string): void {
  if (INTERNAL_ALLOW_RUNTIME) return;
  if (typeof process === "undefined" || typeof process.cwd !== "function" || isServerlessContext()) {
    throw new GeoJSONLoadError(/* clear message */, source);
  }
}
```

- Pros: proactive; clear error before any I/O attempted
- Cons: list of serverless detections may go stale; false positives for unusual setups
- Effort: Small-Medium
- Risk: Medium — false positives could block legitimate use

### Option C: Keep as-is, document the limitation

Accept that the guard is imperfect; document in JSDoc that runtime detection is best-effort.

- Pros: zero code change
- Cons: continues false advertising
- Effort: Trivial
- Risk: Medium

## Recommended Action

(Filled during triage — Option A is most defensible: focus on producing actionable error messages when the failure actually surfaces, rather than predicting it. Option B layered on top is also worth considering.)

## Technical Details

**Affected files:**
- `packages/astro/src/utils/feature-ref-builder.ts` (guard logic)
- `packages/astro/src/utils/feature-ref-loader.ts` (ENOENT message — Option A)

## Acceptance Criteria

- [ ] When `buildFeatureMapConfig` is called in a deployed serverless context (where source files aren't bundled), the user gets a clear, actionable error message identifying the situation
- [ ] The error message names the offending source path AND suggests the build-time resolution pattern
- [ ] If the guard is removed, JSDoc/README updated to remove the "throws guard" claim

## Work Log

(Empty — pending triage)

## Resources

- Review by `compound-engineering:review:architecture-strategist`
