---
status: pending
priority: p3
issue_id: "006"
tags: [code-review, testing, naming]
dependencies: []
---

# Test variable `global` shadows Node.js built-in

## Problem Statement

In `packages/core/tests/utils/config-resolver.test.ts`, some test variables are named `global` which shadows the Node.js built-in `global` object. While this doesn't cause bugs in practice (the tests don't use Node's `global`), it triggers lint warnings and is confusing.

## Proposed Solutions

### Option A: Rename to `globalCfg` or `globalConf`
```typescript
const globalCfg = makeGlobalConfig({ ... });
const result = resolveMapConfig(config, globalCfg);
```

- **Effort**: Small
- **Risk**: None

## Acceptance Criteria

- [ ] No test variables named `global`
- [ ] All tests still pass

## Resources

- File: `packages/core/tests/utils/config-resolver.test.ts`
