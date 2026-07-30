#!/usr/bin/env sh
# Route the gate through the box's machine-wide test lane when present
# (box-infra: bin/test-lane, installed at ~/.local/bin/test-lane on opti).
# ONE flock serializes presubmits across ALL projects on the box —
# concurrent runs queue instead of double-bursting a 12-core/16 GiB host —
# and a load/memory guard aborts fast (clearly marked as an environment
# problem, not a code failure) when a run would produce garbage signal.
# `test-lane status` shows the holder; LANE_FORCE=1 skips (emergencies).
#
# On machines without the wrapper (CI, fresh clones elsewhere), run the
# gate directly — the lane is a box concern, not a repo requirement.
set -e
if command -v test-lane >/dev/null 2>&1; then
  exec test-lane --label maplibre-yaml -- "$@"
fi
exec "$@"
