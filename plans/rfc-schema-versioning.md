# RFC: YAML Schema Versioning & Deprecation Policy

**Phase:** 4 of the [meta-plan](./meta-plan-stabilization-and-roadmap.md)
**Status:** Accepted (Mario) — option B + C; dual-version parsing with shims; one-minor-cycle deprecation window
**Blocks:** [feat-geojson-schema-alignment.md](./feat-geojson-schema-alignment.md) and hard-strict validation

## Overview

maplibre-yaml's product is a *file format*. Users accumulate YAML files; those files must keep working, or fail with a migration path, as the schema evolves. Today there is no `version:` field, no deprecation policy, and no migration tooling — every schema change is an implicit, silent contract change. The GeoJSON alignment (Phase 5) is the first change large enough to make this untenable, so the policy must exist first.

## Problem Statement

Evidence this is already biting at small scale:

- The core 0.2.3 changeset had to *tighten* `source.data` validation (reject path-like strings) — a behavior change to authored files, handled with a hand-written round-trip test and careful message wording, but with no framework for "this file was valid, now it isn't."
- Legacy `refreshInterval`/`updateStrategy`/`updateKey` coexist with the `refresh:` block with no stated removal path (`source.schema.ts:298-317`).
- Phase 2 introduces published schema URLs — which themselves need a versioning scheme.
- Phase 5 will rename/reshape authoring surfaces (GeoJSON conformance), the canonical breaking change.

## Options

### Option A — No file version; package semver governs

The YAML contract is versioned implicitly by the core package version. Breaking schema changes = major (or pre-1.0, minor) package releases; docs/changelog carry migration notes.

- *Pros:* zero authoring overhead; no parser branching.
- *Cons:* a YAML file is not self-describing — a file found in a repo gives no clue which library version reads it; hosted schema URLs and CLI validation can't warn "this file predates the current contract." Files outlive lockfiles.

### Option B — Optional `version:` field in the document

Top-level optional `version: 1` (integer). Absent ⇒ current version assumed. Parser knows its supported version(s); a higher version errors ("upgrade the library"), a lower one triggers compatibility handling or migration hints.

- *Pros:* self-describing files; enables `mlym migrate`; cheap (one optional field).
- *Cons:* meaningful only once version 2 exists; risk of ceremony if bumped too eagerly.

### Option C — `$schema` URL as the version carrier

The Phase-2 modeline (`# yaml-language-server: $schema=…/schema/v1/map.schema.json`) doubles as the version declaration; no in-document field.

- *Pros:* one mechanism for editor tooling and versioning.
- *Cons:* it's a comment — trivially lost on copy-paste, invisible to the parser unless we scrape comments (fragile); couples the contract to a hosted URL.

## Recommendation: B + C, with a conservative bump policy

1. **Add optional integer `version:`** to every top-level block schema now, accepting only `1`, defaulting to `1` when absent. Cost: one field; benefit: the escape hatch exists *before* it's needed, and Phase-5 files can say `version: 2`.
2. **Version the published schema URLs** (`/schema/v1/…`, `/schema/latest/…`) in lockstep — the modeline is tooling sugar, `version:` is the contract.
3. **Bump policy:** `version` increments only for changes that make previously-valid files invalid or change their rendered meaning. Additive fields, new block types, and loosened constraints never bump. Expected cadence: v2 at GeoJSON alignment, then rarely.
4. **Deprecation policy** (applies to fields, not just versions):
   - Deprecated fields keep working for **at least one minor release cycle** while emitting warnings via the validation-ergonomics warning channel (with the replacement named).
   - Removal happens only at a `version` bump, and the parser's error for a removed field must name the migration (`refreshInterval was replaced by refresh.interval in version 2; run mlym migrate`).
   - First customers of the policy: `refreshInterval`/`updateStrategy`/`updateKey` (deprecated now, removed in v2) and whatever Phase 5 renames.
5. **`mlym migrate <file>`** (build alongside Phase 5, not before): rewrites v1 → v2 mechanically where possible, comments `# TODO(migrate):` where judgment is needed. The CLI already has the parse/format machinery; migration rules live next to the schema changes that create them.
6. **Semver mapping:** while pre-1.0, a `version` bump ⇒ minor release with loud changelog; the library reads its current version **and one version back** (v2 core still parses v1 files, applying the migration shims at parse time) so upgrades aren't flag days. Support for v1 parsing is dropped no earlier than core 1.0.

## What this RFC does not decide

- The actual v2 shape — that's [feat-geojson-schema-alignment.md](./feat-geojson-schema-alignment.md).
- Whether hard-strict validation is part of v2 (recommended in the validation plan, decided at Phase-5 scoping).

## Decisions (recorded)

1. **B + C accepted** (Mario): optional `version:` field + versioned schema URLs.
2. **Accepted**: parser reads current + previous version with shims — no flag-day upgrades.
3. **Confirmed**: one minor cycle of warnings is the deprecation window for the legacy refresh fields.
