# Project Instructions for AI Agents

maplibre-yaml — declarative MapLibre web maps from YAML. pnpm monorepo
publishing `@maplibre-yaml/core`, `@maplibre-yaml/astro`, and
`@maplibre-yaml/cli` to npm. This library is the map engine consumed by
the sister project **map-party** (`~/dev/map-party` on this box); changes
here ripple into that product, and both projects share the same tracking
(beads) and knowledge (vault) infrastructure.

## Pre-submit checklist

Before declaring any task complete:

```bash
pnpm presubmit
```

`presubmit` = `build && typecheck && lint && test && docs:validate-snippets`,
fail-fast via `&&` — the first failure is the diagnostic. There is no
browser-e2e suite in this repo (no `[no-e2e: ...]` marker convention
either — that is a map-party mechanism; do not import it into commit
messages here). If any step fails, fix it before saying "done."

Releases go through changesets (`pnpm changeset` → release PR); never
`npm publish` by hand.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Beads conventions specific to this repo

- **The ledger is public in principle.** This is a public GitHub repo and
  the issue DB syncs to `refs/dolt/data` on it — anyone can fetch and
  reconstruct it. No secrets, no tokens, no candid references to private
  parties in bead descriptions. (The JSONL exports are gitignored so
  ledger content never renders in the tree, but the sync ref is still
  fetchable.)
- **`ready-for-agent` is a human-only label.** It is the gate the
  unattended agent loop dispatches on (box-infra `agent-loop.sh`). Agents
  never apply it; file discovered work unlabeled for human triage.
- **GitHub Issues stays the community-facing tracker.** Beads is the
  internal/agent ledger. When a bead mirrors a GitHub issue (or vice
  versa), cross-reference both ways (`GH #NN` in the bead, `ml-xxxx` in a
  GH comment).
- **Provenance:** beads migrated from the retired `todos/` ledger carry a
  `Migrated from todos/NNN-...md` line; see `todos/README.md` for the
  retirement record.

## Knowledge vault (`~/vault`)

Cross-project curated knowledge — decisions and their reversals, entity and
status pages, concepts — compiled nightly from session transcripts and notes.
It is **not** a substitute for this repo's own docs: code structure and
conventions live here and in git history. The vault is for the *why* that
never got written down — what was decided, when, and what it superseded —
including decisions made in **map-party** sessions that shape this library
(map-party is this engine's biggest consumer; its feature requests often
arrive as beads here).

Consult it when the task turns on a past decision or on context outside this
repo:

```bash
cat ~/vault/index.md              # the catalog — always start here
cat ~/vault/decisions/<page>.md   # then read only the pages the index points at
```

Cite the pages you used. **Do not write to the vault from a project session** —
`raw/` is immutable and the derived layer is compiled by the nightly ingest
(box-infra: `vault-ingest.sh`). Knowledge worth keeping goes into a note under
`~/vault/raw/notes/`, which the next ingest compiles. Session transcripts from
this repo are exported to the vault automatically (nightly
`vault-export-sessions.sh`); you don't need to do anything for that.

## Architecture Overview

- `packages/core` — schemas (zod), YAML parser, renderer, `<ml-map>` web
  component. maplibre-gl stays a peer/external dep (import map on CDN).
- `packages/astro` — Astro components (Map, FullPageMap, Scrollytelling)
  built on core.
- `packages/cli` — validation, preview, scaffolding.
- `docs/` — Astro docs site. `examples/` — runnable examples.
- `plans/` — design plans (historical + active); open work items belong in
  beads, not in plan prose.
