#!/usr/bin/env bash
# Publish step for the Release workflow (invoked as `pnpm run release` by
# changesets/action). Kept as a script because the action's `publish:` input
# is split on whitespace and run without a shell -- chaining has to live
# where a shell interprets it (see the comment in release.yml / ml-5ym).
#
# `pnpm publish` (not `changeset publish`, which bypasses pnpm's
# workspace:-protocol rewriting -- issue #28) does not read
# .changeset/pre.json, so in prerelease mode it would publish under the
# default `latest` dist-tag. That happened with 0.6.0-alpha.0: cli's
# `latest` briefly pointed at the alpha and no `alpha` tag existed
# (ml-tfd.7). Derive the tag from pre.json when present.

set -euo pipefail

tag=latest
if [ -f .changeset/pre.json ]; then
    tag=$(jq -r '.tag // empty' .changeset/pre.json)
    if [ -z "$tag" ]; then
        echo "::error::.changeset/pre.json exists but has no tag field; refusing to publish blind." >&2
        exit 1
    fi
fi
echo "Publishing with dist-tag: $tag"

pnpm publish -r --access public --tag "$tag"
changeset tag
git push origin --tags
