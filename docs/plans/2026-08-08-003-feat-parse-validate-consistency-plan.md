---
title: Parse/Validate Consistency for Consumers - Plan
type: feat
date: 2026-08-08
topic: parse-validate-consistency
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Parse/Validate Consistency for Consumers - Plan

## Goal Capsule

- **Objective:** Make the library's canonical YAML parse options and validation entry a supported public API, so a consumer parses and validates a document exactly the way the library's own read path does — closing a live drift in Astro's loader and giving map-party's write path a consistent parse/validate seam.
- **Product authority:** Mario (owns both maplibre-yaml and map-party). This reframes bead `ml-0fg`.
- **Open blockers:** None.

---

## Product Contract

### Summary

The library parses YAML with two non-default options that matter for correctness: `merge: true` (YAML merge keys, `<<: *base`) and a custom `!html` scalar tag. Those options live in a **module-private** `YAML_PARSE_OPTIONS` inside the core parser. Because they aren't public, consumers re-declare them and drift: Astro's loader has its own copy that is **missing the `!html` tag**, so Astro parses `!html`-tagged values differently from core *today*. map-party's write path parses with the plain `yaml` API (neither option) and does not validate through the library's schema + DoS guard before writing. This work makes the canonical parse options and the validation entry **public, single-source-of-truth API**, points existing consumers at them, and documents the supported way to parse and validate — so read, write, and every consumer agree on what a document means.

This is a deliberate reframing. `ml-0fg` began as a "comment- and format-preserving write seam" whose premise — that map-party hand-rolled *format-preserving* serializers this would consolidate — turned out inverted: map-party's writers are intentionally lossy `parse → mutate → stringify` paths, Yjs-coupled, carrying model-logic a library seam cannot absorb. The real, defensible library value is not fidelity; it is **parse/validate consistency**. That is what this delivers.

### Problem Frame

A document only has one meaning if everything that reads it parses it the same way. The library encodes that meaning in `YAML_PARSE_OPTIONS` — `merge: true` and the `!html` tag change what a document *is*. But those options are private, so the guarantee is unenforced across the boundary: any consumer that parses YAML re-implements the options and can get them wrong.

It is not hypothetical. Astro's loader already carries a drifted copy (`merge: true`, no `!html` tag) whose own comment admits it "mirrors" core's — so an `!html` value that the core read path resolves to a safe structural marker is parsed differently on the Astro path. That is a real inconsistency shipping today, born entirely of the options being copyable rather than importable.

map-party is the same shape one step further: its write path parses with the bare `yaml` API and writes back without validating through the library's schema — so a GUI edit can produce a document the library's own reader would reject, and map-party won't know until read time. The fix for both is the same and small: publish the canonical parse options and a validation entry, and have consumers import the one source of truth instead of re-declaring it. No new mutation API, no comment-preservation capability, no consumer-serializer consolidation — just close the drift.

### Requirements

**Public, single-source parse options**

- R1. The library exposes its canonical YAML parse options (`merge: true` + the `!html` scalar tag) as a supported public export, so a consumer parses a document the same way the library's read path does.
- R2. The `!html` scalar tag is available to consumers as part of that public surface (it is half of what makes parsing consistent; exporting the options without the tag would reproduce exactly Astro's current drift).

**Consistent validation entry**

- R3. A consumer can validate a document (or a mutated value) through the library's map schema and its merge-fan-out DoS guard via a supported public entry — the same validation the read path runs — without reaching into private internals.

**Close the existing drift**

- R4. Astro's loader parses through the library's canonical options (imported, not re-declared), so its `!html` handling matches core's — the live divergence is removed.
- R5. No second copy of the parse options remains in the codebase; the canonical export is the only definition.

**Honesty about scope**

- R6. This ships no mutation/write-handle API, no comment- or format-preservation capability, and does not claim to consolidate map-party's serializers. map-party keeps owning its mutation, Yjs coupling, and model-logic; it adopts only the parse options + validation entry (adoption is a follow-up in map-party's repo, not a criterion provable here).

### Acceptance Examples

- AE1. Astro and core agree on `!html`
  - **Covers R1, R2, R4.**
  - **Given:** a document with an `!html`-tagged value.
  - **When:** it is parsed through Astro's loader and through the core read path.
  - **Then:** both resolve the `!html` value identically — Astro no longer mishandles it, because it imports the canonical options including the tag.

- AE2. One definition of the parse options
  - **Covers R5.**
  - **Given:** the codebase after this work.
  - **When:** you search for the parse-options definition (`merge` / `customTags`).
  - **Then:** there is exactly one — the public canonical export; Astro's private copy is gone.

- AE3. A consumer validates the way the reader does
  - **Covers R3.**
  - **Given:** a mutated document value a consumer is about to write.
  - **When:** the consumer validates it through the public validation entry.
  - **Then:** it gets the same result (including schema errors and merge-fan-out DoS rejection) the library's read path would give the serialized form — no access to private internals required.

### Scope Boundaries

**Deferred to Follow-Up Work**

- map-party's actual adoption — swapping its write path onto the public parse options + validation entry. That lands in map-party's repo; this epic ships the API and closes the in-repo (Astro) drift.
- `ml-0fg.2` (sugar provenance) — unchanged: still deferred, still blocked on `ml-4jq` (sugar normalization), and still orthogonal to this work (there is no model→serialize path here for it to matter to).

**Outside this work**

- A `MapDocument` mutation handle / path-based write API. map-party owns its mutation; the library provides parse+validate consistency, not an edit surface.
- Comment- and format-preserving round-trip. map-party's writer is lossy by design and does not want fidelity today; this is not the value.
- Consolidating map-party's two serializers. They carry Yjs coupling and model-logic a library API cannot absorb; the original success criterion is retired.

### Outstanding Questions

**Deferred to planning**

- The exact public shape — a single exported `YAML_PARSE_OPTIONS` object plus the existing schema entry points (e.g. the map-block validators), versus a small dedicated `validate()` convenience wrapper. `ce-plan` decides the surface; the requirement (R3) is only that consistent validation is reachable publicly without private internals.
- Whether map-party should also import the parse options *and* validate, or just parse consistently first — a map-party-side sequencing question, resolved when map-party adopts.

### Sources / Research

- `packages/core/src/parser/yaml-parser.ts` — `YAML_PARSE_OPTIONS` (module-private, `merge: true` + the `htmlTag` `customTags`), `toJSSafe`/`rejectMergeFanOut` (the DoS guard), and the schema validators the read path uses.
- `packages/astro/src/utils/loader.ts` — the drifted copy (`const YAML_PARSE_OPTIONS = { merge: true }`, no `!html` tag) whose comment says it "mirrors" core's — the live inconsistency R4 closes.
- `~/dev/map-party/packages/ui/src/hooks/useYAMLUpdater.ts` and `useStoryEditor.ts` — map-party's write paths: plain `parse`/`stringify`, Yjs-coupled, model-logic-heavy; the consumer this consistency serves (adoption is theirs to land).
- `docs/brainstorms/2026-07-24-library-direction-requirements.md` — R6, the original (now-reframed) write-seam epic.
- Reframing provenance: a `ce-plan` + `ce-doc-review` pass on the original write-seam framing verified against map-party's real code that the "format-preserving serializers" premise was inverted; this brainstorm redefines the epic around the value that survived — parse/validate consistency.

---

## Planning Contract

**Product Contract preservation:** unchanged. Planning confirmed the requirements against the code and *narrowed* the surface — it added no product scope. One requirement (R3, a public validation entry) turned out already satisfied: `YAMLParser` (with `safeParseMapBlock`/`safeParseAny`/etc.) is already public via `packages/core/src/parser/index.ts`, so no new validation API is authored — the plan documents the existing entry. This matches the brainstorm decision to "fix the leak, no new seam" (the thin `validate()` convenience was explicitly declined).

### Key Technical Decisions

**KTD1. Export the two private constants; author no new API.** The gap is exactly `YAML_PARSE_OPTIONS` and `htmlTag` being module-private in `parser/yaml-parser.ts`. Export them (through the existing `parser/index.ts` barrel, which `core/index.ts` re-exports with `export *`), and that closes the reusability hole. Validation is already public (`YAMLParser`), so no `MapDocument`, no `validate()` wrapper, no mutation surface — consistent with the brainstorm's "fix the leak, no new seam".

**KTD2. Astro imports the canonical options; it does not keep a corrected copy.** The fix for Astro's drift is not "add `customTags: [htmlTag]` to Astro's copy" — that would leave two definitions free to drift again (R5). Astro deletes its local `YAML_PARSE_OPTIONS` and imports the canonical export from core, so there is exactly one definition and the `!html` handling can never diverge again.

**KTD3. Prove the fix with a parse-parity test, not a browser demo.** The behavioral surface is "core and Astro resolve `!html` identically" — an assertion on parsed output, not a rendered page. A unit/integration test comparing the two parse paths on an `!html` document is the right, cheaper proof; the browser-tests-as-demos preference does not apply to an internal API-export + de-duplication change with no new user-facing surface. (Noted so the absence of a browser demo is a decision, not an oversight.)

---

## Implementation Units

### U1. Export the canonical parse options and the `!html` tag

- **Goal:** `YAML_PARSE_OPTIONS` and `htmlTag` become supported public exports — the single source of truth for how the library parses a map document.
- **Requirements:** R1, R2, R5.
- **Dependencies:** none.
- **Files:** `packages/core/src/parser/yaml-parser.ts` (export the two `const`s), `packages/core/src/parser/index.ts` (re-export them from the parser barrel), `packages/core/tests/parser/yaml-parser.test.ts` or a small new `packages/core/tests/parser/parse-options.test.ts` (export-surface test).
- **Approach:** Add `export` to `YAML_PARSE_OPTIONS` (`{ merge: true, customTags: [htmlTag] }`) and `htmlTag` (the `!html` ScalarTag) in `yaml-parser.ts`, and re-export them from `parser/index.ts` alongside `YAMLParser`. `core/index.ts` already does `export * from "./parser"`, so the public barrel picks them up with no edit there — confirm this and do not widen `core/index.ts` by hand. Keep the JSDoc; these are now contract, so note in a comment that they are the canonical definition consumers import rather than re-declare.
- **Patterns to follow:** the existing `parser/index.ts` named re-exports (`YAMLParser`, `parseYAMLConfig`, …) — add the two constants to that list.
- **Test scenarios:**
  - The two symbols are importable from `@maplibre-yaml/core` (the main entry; there is no `./parser` package subpath, so the public import path is the root barrel) and have the expected shape — `YAML_PARSE_OPTIONS.merge === true` and its `customTags` includes the `!html` tag.
  - `htmlTag.resolve("x")` yields the structural marker `{ $html: "x" }` (pinning the exported tag's behavior as contract).
  - `Test expectation: the JSON-schema snapshot is untouched — this exports runtime constants, not schema.` (confirm no snapshot regen is needed.)
- **Verification:** the constants are public API; a consumer can import them; the parser's own tests still pass unmodified.

### U2. De-drift Astro's loader onto the canonical options

- **Goal:** Astro's loader parses through core's canonical options, so its `!html` handling matches core's and the second definition is gone.
- **Requirements:** R4, R5.
- **Dependencies:** U1.
- **Files:** `packages/astro/src/utils/loader.ts` (delete the local `YAML_PARSE_OPTIONS`, import core's), `packages/astro/tests/` (a parse-parity regression test — locate the existing loader test dir).
- **Approach:** Delete `const YAML_PARSE_OPTIONS = { merge: true } as const` (loader.ts:53) and import `YAML_PARSE_OPTIONS` from `@maplibre-yaml/core`, using it at the existing `parseYAML(contents, YAML_PARSE_OPTIONS)` call sites (loader.ts:164, :431). The loader already imports from `@maplibre-yaml/core`, so this is an import swap, not new coupling. Its stale mirror comment goes away with the constant.
- **Execution note:** Regression-first — write the failing parse-parity test before the swap. Today an `!html` document parsed through the Astro loader resolves the value differently from core (Astro drops the tag); the test asserts they agree, fails on the current drifted copy, and passes once Astro imports the canonical options. That failing-then-passing test *is* the proof the live bug existed and is fixed.
- **Patterns to follow:** how core's parser tests assert `!html` resolution to `{ $html }`; mirror that against the Astro loader's parse path.
- **Test scenarios:**
  - Covers AE1. An `!html`-tagged value parsed through the Astro loader resolves to the same structural marker core produces — not a dropped/literal tag. (Fails before the swap, passes after.)
  - Covers AE2. There is exactly one `YAML_PARSE_OPTIONS` definition in the tree afterward (a grep/import-graph assertion, or simply that Astro's file no longer declares one).
  - A merge-key (`<<: *base`) document still loads correctly through the Astro loader (the `merge: true` behavior the old copy had is preserved by the canonical options).
  - Existing Astro loader tests pass unmodified (no behavioral regression on non-`!html` documents).
- **Verification:** the parity test passes; Astro has no local parse-options copy; `grep` finds one canonical definition.

### U3. Document the supported parse/validate consistency pattern

- **Goal:** A consumer knows the supported way to parse and validate a document consistently with the library.
- **Requirements:** R3, R6.
- **Dependencies:** U1.
- **Files:** a short docs page under `docs/` (the consumer/integration guide area — locate the existing docs structure), and/or JSDoc on the exported constants.
- **Approach:** Document that a consumer parsing YAML itself should import `YAML_PARSE_OPTIONS` (so `merge` + `!html` match the library) and validate through the already-public `YAMLParser` entry points (`safeParseMapBlock`/`safeParseAny`) — which run the map schema through the merge-fan-out DoS guard. State plainly what is *not* provided (no mutation/write handle, no comment-preservation) so a reader doesn't expect the retired write-seam. Keep it short — a paragraph and a code-free description of the two touchpoints.
- **Patterns to follow:** the existing docs pages' shape and the `docs:validate-snippets` convention (if the page includes a YAML snippet, it must validate).
- **Test scenarios:**
  - `Test expectation: none — docs-only. Replacement verification: any YAML snippet in the new page passes `docs:validate-snippets` (part of presubmit).`
  - **AE3 disposition:** AE3 ("a consumer validates the way the reader does") needs no new test — it is already covered by core's existing `YAMLParser` validation tests (`tests/parser/`), since R3's public validation entry (`safeParseMapBlock`/`safeParseAny`, running the schema through the `toJSSafe` DoS guard) is pre-existing, not authored here. This unit documents that entry; it does not re-test it.
- **Verification:** the docs page exists, describes the two touchpoints and the non-goals, and `docs:validate-snippets` stays green. AE3 is satisfied by the existing `YAMLParser` validation tests (no new coverage needed — recorded so the acceptance example is not orphaned).

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Full gate | `pnpm presubmit` | Every unit |
| Export surface | `pnpm --filter @maplibre-yaml/core test -- tests/parser/` | U1 |
| Astro parse parity (the bug fix) | `pnpm --filter @maplibre-yaml/astro test` | U2 — AE1, AE2 |
| Docs snippets | `pnpm docs:validate-snippets` | U3 |

`pnpm presubmit` routes through the box-wide test lane — one at a time; a load-guard abort is an environment condition, wait rather than retry.

---

## Definition of Done

- All three units land with `pnpm presubmit` green.
- `YAML_PARSE_OPTIONS` and `htmlTag` are public exports of `@maplibre-yaml/core` — the single canonical definition (R1, R2, R5).
- Astro's loader imports the canonical options and no longer declares its own; an `!html` document parses identically through the Astro loader and core — the live drift bug is closed, proven by a regression test that failed before the swap (R4, AE1, AE2).
- Exactly one `YAML_PARSE_OPTIONS` definition exists in the tree (R5, AE2).
- The supported parse/validate-consistency pattern is documented, pointing at the exported options + the already-public `YAMLParser` validators, and stating the non-goals (R3, R6).
- No new mutation/write API, no comment-preservation, no `MapDocument` — scope held (R6).
- Beads: `ml-0fg.1` closes onto this reframed work; `ml-0fg` closes when U1–U3 land; `ml-0fg.2` stays open (deferred, blocked on `ml-4jq`).
