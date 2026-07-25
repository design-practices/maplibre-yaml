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
| Files here | 41 (`001`–`041`; **039 and 040 arrived after retirement** — see below) |
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

**Numbers 039 and 040 post-date the retirement.** At migration time these
files did not exist — the release-train plan (`docs/plans/2026-07-08-001`)
cited them as if filed, and beads were created from that prose (under the
schema-truthfulness and feature-refs-v2 epics). PR #47, in flight during
the migration and merged the same day, then landed the actual files. They
are kept here as historical record like the rest; their live trackers are
`ml-itz.5` (039) and, for 040's five findings, `ml-7jc.7` (item 1),
`ml-ohh.13`–`.15` (items 2–4), `ml-ohh.16` + `ml-a50` (item 5). PR #47
also flipped `035` to complete (resolved by decision D10); its bead
`ml-pgb` is closed.

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
