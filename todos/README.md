# `todos/` is RETIRED — beads (`bd`) is the source of truth

**Retired 2026-07-24** by the beads migration (modeled on map-party's
2026-07-13 migration; see that repo's `todos/README.md` and
`docs/plans/completed/2026-07-12-beads-migration-inventory.md` for the
method).

## Do not add, edit, or close files in this directory.

All **open** work that lived here was imported into beads on 2026-07-24.
These files remain **only as a historical record** — the closed ones are
the audit trail, and the open ones are the provenance for the beads
issues that replaced them.

| | |
|---|---|
| Files here | 39 (`001`–`041`; **039 and 040 never existed** — see below) |
| Open at migration | 14 pending |
| Flipped complete by the pre-import audit | 1 (`003` — shipped with `002`) |
| Imported into beads | **13** (as issues under themed epics) |
| Recovered from prose, no todo number ever | **~57** (plans, brainstorms, PR bodies, GitHub issues, test skips) |
| Beads total at import | 81 (11 epics + 70 issues, prefix `ml-`) |

Each imported issue records its origin in its description as
``Migrated from todos/NNN-...md (todo #NNN)`` or a source-doc pointer,
so a bead can always be traced back to where it came from.

## Where work lives now

```bash
bd ready                 # what's actionable right now (nothing blocking it)
bd list --limit 0        # everything
bd show ml-xxxx
bd create "..." -t bug -p 2 -l schema
```

New work goes in `bd`, not here. See the Beads section of `CLAUDE.md` —
including the **public-ledger rule**: this repo is public and the issue DB
syncs to `refs/dolt/data` on it, so bead descriptions are public in
principle. GitHub Issues remains the community-facing tracker; beads
mirrors carry `gh-NN` external refs.

## Three things worth knowing

**Numbers 039 and 040 were cited but never existed.** The release-train
plan (`docs/plans/2026-07-08-001`) refers to "todo 039" (standalone-block
`$ref`) and "todo 040" (nested `$ref` resolution) as if filed; the files
were never created — the ledger skipped from 038 to 041. Both are now
beads (under the schema-truthfulness and feature-refs-v2 epics). If you
meet a bare "todo 039/040" reference in old prose, it means those beads.

**The ledger was never the whole picture.** The migration sweep found an
entire *active release-train plan* — 13 fully-specified work units gating
0.4.0 (U3–U15) — tracked by **zero** todo files, plus ~40 more deferrals
living only in plan "Deferred" sections, brainstorms, PR bodies, and a
fully-skipped integration test suite. A numbered-file ledger only tracks
what someone remembered to number; that is why this directory was retired
rather than tidied.

**One pending todo had already shipped.** `003` claimed a misleading test
name; the fix rode in with `002` months earlier. Audit before you trust a
status prefix — which is also now moot, because beads statuses are live.
