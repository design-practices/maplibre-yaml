#!/usr/bin/env sh
# Align the beads issue database with the remote. Run from `prepare`, so it
# fires on every `pnpm install` — fresh clone, new machine, or routine pull.
# Adapted from map-party's scripts/beads-sync.sh (2026-07-13 migration).
#
# Fresh clone      -> `bd bootstrap` clones the DB from sync.remote (config.yaml)
#                     and wires the Dolt remote for future push/pull.
# Existing clone   -> `bd dolt pull` fast-forwards the local DB.
#
# THIS SCRIPT ALWAYS EXITS 0. Issue-tracker sync must never be able to break
# `pnpm install` — a developer with no `bd` on PATH, or offline on a plane,
# still needs a working repo. Failures are reported, not fatal.
#
# NOTE (public repo): the issue ledger syncs via refs/dolt/data on the same
# GitHub remote. It is fetchable by anyone; treat every bead description as
# public. The JSONL exports (.beads/issues.jsonl, interactions.jsonl) are
# deliberately gitignored so ledger content never renders in the public tree.

set -u

if ! command -v bd >/dev/null 2>&1; then
  echo "beads: bd not on PATH — skipping issue-db sync."
  echo "beads: install it to get the issue tracker (see todos/README.md)."
  exit 0
fi

# The Dolt remote registration lives inside .beads/embeddeddolt/, which is
# GITIGNORED. It is therefore per-machine: it does not arrive with a clone, and
# it can go missing. When it is absent, `bd dolt push` has nowhere to go and the
# pre-push hook silently no-ops. `bd dolt remote add` is idempotent, so
# re-assert it on every install from the URL that IS tracked, in config.yaml.
ensure_remote() {
  url=$(sed -n 's/^sync\.remote:[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}[[:space:]]*$/\1/p' \
    .beads/config.yaml 2>/dev/null | head -1)
  if [ -z "$url" ]; then
    echo "beads: no sync.remote in .beads/config.yaml — issue db will stay local."
    return 1
  fi
  bd dolt remote add origin "$url" >/dev/null 2>&1 || true
}

if [ -d .beads/embeddeddolt ]; then
  # Database already present: just align it with the remote.
  ensure_remote || exit 0
  if bd dolt pull origin >/dev/null 2>&1; then
    echo "beads: issue db synced with origin."
  else
    echo "beads: could not pull issue db (offline? no remote?) — continuing."
  fi
else
  # No database: clone it from the remote recorded in .beads/config.yaml.
  if bd bootstrap >/dev/null 2>&1; then
    echo "beads: issue db bootstrapped from origin."
  else
    echo "beads: bootstrap failed — run 'bd bootstrap' manually to get the issue db."
  fi
fi

exit 0
