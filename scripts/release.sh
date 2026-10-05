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

#
# Maintenance lines: the workflow also runs on `release/<major>.<minor>.x`
# branches. Publishing a 0.6.x patch under `latest` after 0.7.0 shipped would
# move every unpinned install back a minor, so on such a branch the tag is
# `latest` only while that line is still the newest one on npm (compared on
# @maplibre-yaml/core, the package every line releases), and
# `release-<major>.<minor>` once main has moved past it. RELEASE_DIST_TAG
# overrides the computed tag when set.

set -euo pipefail

tag=latest
if [ -f .changeset/pre.json ]; then
    tag=$(jq -r '.tag // empty' .changeset/pre.json)
    if [ -z "$tag" ]; then
        echo "::error::.changeset/pre.json exists but has no tag field; refusing to publish blind." >&2
        exit 1
    fi
elif [ -n "${RELEASE_DIST_TAG:-}" ]; then
    tag="$RELEASE_DIST_TAG"
else
    branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
    case "$branch" in
        release/*)
            line="${branch#release/}"
            line="${line%.x}"
            published=$(npm view @maplibre-yaml/core dist-tags.latest 2>/dev/null || true)
            if [ -z "$published" ]; then
                echo "::error::cannot read @maplibre-yaml/core's latest dist-tag; set RELEASE_DIST_TAG to publish from $branch." >&2
                exit 1
            fi
            published_line=$(echo "$published" | cut -d. -f1,2)
            newest=$(printf '%s\n%s\n' "$line" "$published_line" | sort -V | tail -n1)
            if [ "$newest" = "$line" ]; then
                tag=latest
            else
                tag="release-$line"
            fi
            ;;
    esac
fi
echo "Publishing with dist-tag: $tag"

pnpm publish -r --access public --tag "$tag"
changeset tag
git push origin --tags
