---
title: Python package — write maps and their data from notebooks, preview inline (design)
type: design
date: 2026-10-23
topic: python-package
beads: ml-37r.2 (this spike; parent epic ml-37r)
target: a new `maplibre-yaml` package on PyPI, released at core's minor (0.9 → first release on the 0.9 line, or 0.10 if core moves first)
status: proposed 2026-10-23 — awaiting maintainer answers in §13
---

# Python package — design

**Goal (bead ml-37r.2, maintainer direction 2026-10-23):** an official Python
package for maplibre-yaml that lives **in this monorepo, done right**. Its
first audience is a course. Students do their analysis in Python notebooks
and publish maps with maplibre-yaml in an Astro site built from a template
repo (ml-37r.7). They author either from Python or directly in YAML/MDX. The
package must also serve general Python and GeoPandas users. It writes the
cloud-native files maplibre-yaml reads, and it builds and edits map and story
documents. It previews them inline in Jupyter, and it can never drift from the
library it targets.

This document holds the decisions, the evidence behind them, and the open
questions. It contains no production code. The evidence comes from a
throwaway prototype outside the repo, described in [§12](#12-prototype-evidence).
Several decisions below change because of what the prototype showed:

- the maplibre-gl 6 worker fails in opaque origins;
- relative data paths resolve against the page, not the YAML file;
- JSON Schema catches 3 of 8 common mistakes.

---

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Layout: `packages/python/`**, with a `pyproject.toml` (build backend **hatchling**), a committed **`uv.lock`** (uv is the dependency manager), `src/maplibre_yaml/`, `tests/`, and a **private npm stub `package.json`** (`"name": "@maplibre-yaml/python", "private": true`). The stub puts the package inside the pnpm workspace. Its `devDependencies` on `@maplibre-yaml/core` and `@maplibre-yaml/cli` (`workspace:*`) make `pnpm -r` build those first. Its `test`/`lint`/`typecheck` scripts call `scripts/python.mjs`, which runs uv when it is on PATH and prints a one-line skip when it isn't. uv_build is rejected because it has no build hooks, and D4's schema bundling needs one. |
| D2 | **Presubmit runs a fast Python leg** when uv is present (on opti it is): ruff, pyright, and pytest without the `slow` marker, plus the round trip through the freshly built CLI. That is a few seconds once the venv exists. CI has its own `python` job, which is the real gate: Python 3.12 and 3.14, all extras, a lowest-direct-deps leg, the round trip, and the browser check. pyright comes from the stub's npm `devDependencies`, so it is lockfile-pinned and needs no download at run time. |
| D3 | **Name: PyPI `maplibre-yaml`, import `maplibre_yaml`, written `import maplibre_yaml as mlym` in the docs** (the CLI's short name). `maplibre-yaml`, `maplibre_yaml` and `mlym` all return 404 on PyPI (checked 2026-10-23; PyPI treats `maplibre-yaml` and `maplibre_yaml` as the same name). It clashes with nothing: py-maplibregl is `maplibre`, and `lonboard`, `leafmap` and `maplibreum` use other names. **No `mlym` console script**, because it would shadow the Node CLI on PATH. |
| D4 | **Versioning: changesets versions the Python package through the private stub.** A Python change gets a normal `.changeset/*.md` entry (`"@maplibre-yaml/python": patch`), and changesets writes `packages/python/CHANGELOG.md`. hatchling reads the version straight from the stub's `package.json` (`[tool.hatch.version]` regex), so nothing is mirrored into `pyproject`. A new `scripts/sync-python-version.mjs` runs inside `version-packages` and keeps **Python's `major.minor` equal to core's**. When core's minor moves, Python moves to `X.Y.0`. When core ships a patch, Python gets a patch that re-bundles the schemas. Python's own patches stay independent. A `--check` mode in CI refuses a changeset that bumps Python's minor without core's. The build hook refuses to build when the minors differ. Prereleases map cleanly: `0.10.0-alpha.0` builds as PEP 440 `0.10.0a0`. |
| D5 | **Release: a `pypi` job in `release.yml`** (`needs: release`, `environment: pypi`, `id-token: write`). It **publishes only when the stub's version is missing from PyPI**, so it is idempotent like the npm side. It uses **trusted publishing** through `pypa/gh-action-pypi-publish`, which also produces attestations. This is a job, not a separate workflow, for three reasons. Tags pushed with `GITHUB_TOKEN` don't trigger workflows. `workflow_run` always runs the default branch's copy of the workflow, which complicates `release/*` lines. And PyPI does not accept reusable workflows as trusted publishers (warehouse#11096). `needs: release` guarantees that core and the CLI the package pins are already on npm. |
| D6 | **Schema sync at build time.** The hatchling hook copies `packages/core/schemas/{map,scrollytelling,any}.schema.json` into the package and stamps `_core.py` with `CORE_VERSION` and `CLI_VERSION`. Both the schemas and the stamp are gitignored and added to the wheel and sdist as hatch `artifacts`. A build from an sdist uses the copies it ships. The preview's CDN pin (`@maplibre-yaml/core@X.Y`) and the authoritative validator (`@maplibre-yaml/cli@<exact>`) both come from that stamp, so there is no hand-written pin to sync. |
| D7 | **Validation in three tiers.** (1) The helpers produce valid documents by construction, and CI proves it (D12). (2) `doc.validate()` checks against the bundled JSON Schema with `jsonschema`: offline, fast, and **advisory**. (3) `doc.validate(strict=True)` / `mlym.check(path)` runs **`npx --yes @maplibre-yaml/cli@<stamped> validate -f json`** when Node is present, and that check is **authoritative**. In the spike, JSON Schema caught **3 of 8** common mistakes and `mlym validate` caught **8 of 8** ([§5](#5-d6d7--schema-sync-and-validation)). The docs say so plainly. |
| D8 | **API v0: plain dicts with thin helpers, not a typed model of the schema.** A typed model would be a second copy of the zod schemas, and it would drift. `Map` / `Story` wrap a `doc` dict that you can always edit directly. They add `add()`, `chapter()`, `save()`, `to_yaml()`, `validate()` and the Jupyter repr. Alongside them: writers (`write_geoparquet`, `write_flatgeobuf`, `write_cog`, `write_pmtiles`), `classify()`/`breaks()` through mapclassify, story actions, `view()` (bounds → center/zoom), a GeoPandas-shaped `explore()`, and `load()` for editing hand-written YAML. Editing goes through a **ruamel.yaml round trip** that keeps comments, anchors, merge keys and `!html`. Core has no comment-preserving write seam: ml-0fg dropped that scope on 2026-08-08. ruamel is also YAML 1.2, which matches core's `yaml` parser; PyYAML is 1.1, where `yes`/`no`/`on` become booleans. |
| D9 | **Saved paths are site-relative.** Core resolves a relative `url:` against the **page** (in Astro, against `public/`), **not** against the YAML file. `save(dir)` therefore writes data beside the YAML, as `dir/data/<source>.<ext>`, but writes each `url:` relative to the **site root**. The site root is found automatically (the nearest `public/` above `dir`) or set with `mlym.site_root(...)`. Without a site root, the URL is relative to the YAML's folder, and the docs and the repr say that the page must sit beside the YAML. |
| D10 | **Inline preview: `_repr_mimebundle_` with a custom MIME type plus an HTML `srcdoc` fallback**, as Folium does. `application/vnd.maplibre-yaml+yaml` carries the **saved** YAML, with `{path, site_path, core}` in the output metadata, so the notebook→site converter emits `<ml-map src>` instead of an iframe. `text/html` is an iframe whose document loads `<ml-map>` (`<ml-scrollytelling>` for stories) from the CDN. The document is **gzip+base64** in the srcdoc, decoded with `DecompressionStream`. A small inline script **chooses maplibre-gl 6, or 5 in an opaque origin** (a `file://` export, a sandboxed output frame), because v6's worker cannot start there. Data is inlined with only the columns the map uses, at most 5,000 features per source by default. Breaks are explicit, so the classes still match the full data. Measured outputs are **4.1 KB** for the 96-tract choropleth and **128 KB** for 5,000 points. anywidget is Phase 2 (`[widget]` extra), and a "playground" link is Phase 2. |
| D11 | **Interop.** Python ≥ 3.12 (numpy 2.5, mapclassify 2.11 and rasterio 1.5 all require it; Colab runs 3.12). The base install has only two dependencies, `ruamel.yaml` and `jsonschema`, so the YAML/story path also works in Pyodide/JupyterLite. Extras: **`[geo]`** (geopandas ≥ 1.0, pyarrow ≥ 16; shapely 2 and pyogrio come with geopandas), **`[classify]`** (mapclassify ≥ 2.8), **`[raster]`** (rasterio ≥ 1.4), **`[widget]`** (anywidget, Phase 2), and **`[all]`**. `explore()` takes the arguments of `GeoDataFrame.explore()`, so a Folium user's one-liner keeps working. Lonboard-scale data (ml-37r.5, NYC PLUTO) goes to files read by view, or to PMTiles. It never goes inline. |
| D12 | **Tests and CI.** pytest on 3.12 and 3.14, plus a 3.13 base-only leg. The **round trip**: every document the examples and tests write is validated by the workspace CLI in strict mode, in one batched call. A **browser check** `e2e/python-output.spec.ts`: the CI `python` job writes GeoParquet, FlatGeobuf, COG and a story into `e2e/.generated/python/`, then Playwright loads them with `<ml-map>`. The spec skips when that directory is absent, so `pnpm verify:browser` stays hermetic. ruff (lint + format) and pyright (basic mode, `py.typed`). |
| D13 | **Docs.** A Starlight section **"Python & notebooks"** with three pages. "Maps from Python" is the guide; it takes over the scope of the ml-37r.4 guide. "Notebooks and your site" covers preview and the converter MIME. The third is the **API reference**, generated at docs build from a committed `docs/src/data/python-api.json` (a `griffe` dump, checked for freshness by the Python CI job), so the docs build still needs no Python. `llms.txt` gets a short "Python" section: install, a ten-line example, and a link. `llms-full.txt` gets the API summary. The PyPI README is pin-synced by adding `packages/python/README.md` to `sync-cdn-pins.mjs` ROOTS. |
| D14 | **Catalog hook, not catalog code.** `add()` accepts any object with `__maplibre_yaml_source__() -> dict`, and optionally `__maplibre_yaml_bounds__()` for framing. That is the seam the Portolan/STAC work (ml-37r.6) plugs into, for example a later `mlym.stac.asset(item, "data")`. This spike designs nothing else for catalogs. |
| D15 | **Phasing.** v0 for the course is about **16 working days** ([§11](#11-phasing-and-effort)). It covers the package, release and CI, writers, builder, classify, preview, validation, docs, and the e2e check. Phase 2 is about **9 days**: an anywidget with full-data preview and camera and clicks back to Python, a playground link, offline mode, and story preview polish. Phase 3 covers a JupyterLab MIME-renderer extension, catalog sources, and JupyterLite. |

---

## 1. Context and constraints

- **Epic ml-37r** (2026-10-23) reviewed the course's current setup
  (`mapping-systems/cdp-mapping-systems`). Its build script `build-content.py`
  converts `.ipynb` to `.md`. Lonboard and Folium maps go into the site as
  iframed HTML of **5–7 MB each**, and maplibre-yaml isn't used. The epic
  recommended option C, "a thin Python helper that writes GeoParquet +
  map.yaml and previews inline via a custom mimebundle". This spike settles
  the questions the maintainer put on ml-37r.2: where the package lives, its
  release, versioning, schema sync, CI, API scope, preview, docs and name.
- **Maintainer decisions on the epic:**
  - students start from a **template repo** (ml-37r.7, built elsewhere);
  - they author **both ways**;
  - **replace Lonboard and Folium** where possible;
  - course data lives on a **Portolan** (STAC) server (ml-37r.6);
  - the package lives **here, if done right**.
- **Vault.** `~/vault/index.md` has no decision about a Python package,
  notebooks or PyPI (checked 2026-10-23). Two related pages exist:
  - `decisions/2026-09-16-portolan-evaluation-vs-existing-import-queue.md`,
    which is ml-37r.6's concern;
  - `status/ml-5ym.md`, about release-workflow command chaining, which D5 must
    not reintroduce.
- **Precedent in the repo.** Python already lives here as uv inline-script
  fixtures: `scripts/fixtures/cloud-native.py` and `scripts/fixtures/cog.py`.
  They show the GeoParquet 1.1 writer settings (WKB, `write_covering_bbox`,
  Hilbert sort) and rasterio COG writing that the package's writers
  formalise. No `pyproject.toml` or Python CI exists yet.
- **What core reads**, from `docs/src/content/docs/guides/`:
  - **GeoParquet:** WKB only (GeoArrow is refused), lon/lat, a `bbox`
    covering column plus spatial sort for `load: viewport`, any common codec;
  - **FlatGeobuf:** a spatial index for `load: viewport`;
  - **COG:** **EPSG:3857 only**, with tiles and overviews;
  - **PMTiles:** vector or raster;
  - `classify:` `method:` is refused on sources read by view, so those need
    explicit `breaks:`.
- **Release machinery today:**
  - `version-packages` = `changeset version && node scripts/sync-cdn-pins.mjs`;
  - `release` = `scripts/release.sh`, which derives the dist-tag (including
    pre mode and `release/*` lines), runs `pnpm publish -r`, then `changeset tag`,
    then pushes the tags;
  - `release.yml` runs `changesets/action` on pushes to `main` and `release/**`.
    npm uses `NODE_AUTH_TOKEN`, because pinned pnpm 9 can't mint OIDC tokens.

---

## 2. D1/D2 — Layout and the pnpm workspace

```
packages/python/
  package.json          private npm stub: name, version, private, scripts, devDependencies
  pyproject.toml        hatchling; dynamic version from package.json; extras
  hatch_build.py        bundles core schemas + stamps _core.py; refuses minor drift
  uv.lock               committed; CI uses `uv sync --frozen`
  README.md             the PyPI page (pin-synced)
  CHANGELOG.md          written by changesets
  src/maplibre_yaml/    py.typed, schemas/ (gitignored), _core.py (gitignored)
  tests/
```

**Why a stub `package.json`.** It does four jobs at once:

- It is the **changesets handle** (D4).
- It is the **version file** that hatchling reads.
- It sets the **build order**. `devDependencies: { "@maplibre-yaml/core":
  "workspace:*", "@maplibre-yaml/cli": "workspace:*" }`, so `pnpm -r build`
  builds core (which emits the schemas) and the CLI before anything Python
  runs. changesets does not bump a package for its devDependencies.
- It is the **presubmit hook**: `pnpm -r test|lint|typecheck` reach it
  without any change to the root `presubmit:raw` line.

`pnpm publish -r` skips private packages, and `scripts/check-publish.sh`
lists its packages explicitly, so neither changes.

**`scripts/python.mjs <test|lint|typecheck>`** is about 30 lines. If `uv` is
not on PATH it prints `python: uv not found, skipped (CI runs the python job)`
and exits 0. That is what keeps the Node-only CI legs and contributors without
uv green. Otherwise it runs:

- `test`: `uv sync --frozen --extra geo --extra classify` (a no-op when
  current), then `uv run pytest -q -m "not slow"`. `MLYM_CLI` points at
  `packages/cli/dist`, so the round-trip tests use the CLI that presubmit just
  built.
- `lint`: `uv run ruff check` and `uv run ruff format --check`.
- `typecheck`: `pnpm exec pyright`, which is in the stub's devDependencies. It
  is resolved by pnpm and finds the venv through `pyrightconfig` `venvPath`. The
  PyPI `pyright` wrapper is not used, because it downloads Node pyright on
  first run, which would make the gate flaky offline.

**Cost to presubmit**, measured on the prototype: pytest 1.25 s for 3 tests,
ruff 0.3 s, pyright 1.2 s, and `uv sync` with all extras 2.3 s warm. A
realistic v0 suite of about 60 tests without `slow` should stay under about
10 s. Writing COGs, PMTiles, and the 20k-feature cases are marked `slow` and
run only in CI.

**Why hatchling over uv_build.** uv_build is faster and is uv's default, but
it has no build hooks. Schemas generated at build time (D6) need code at
build time. The alternative would be to commit a copy of the schemas, which
contradicts core's generate-on-build policy (`.gitignore`:
`packages/core/schemas/*.json`). hatchling's `artifacts` setting puts the
gitignored files into the wheel and sdist, and its regex version source reads
`package.json`. Both were confirmed in the prototype.

---

## 3. D3 — Name and import

| Candidate | PyPI (2026-10-23) | Notes |
|---|---|---|
| **`maplibre-yaml`** | free (404) | Matches the npm alias and the project. **Chosen.** |
| `maplibre_yaml` | free (404) | The same name to PyPI (normalised). It is the import name. |
| `mlym` | free (404) | The CLI's name. **Not registered** by default (Q1). |
| `maplibre` | taken: py-maplibregl 0.3.6, "Python bindings for MapLibre GL JS" | import `maplibre`; no clash |
| `lonboard` | taken: 0.17.0 | import `lonboard`; no clash |
| `maplibreum` | taken: 0.2.3, "like Folium but for MapLibre" | no clash |
| `leafmap` | taken: 0.63.1, has a MapLibre backend | no clash |

The docs write `import maplibre_yaml as mlym`. That puts one short name on
the project, the same one as `mlym validate`. Python's `mlym.validate()` and
the CLI's `mlym validate` do the same job, so the shared name helps more than
it confuses. The package installs **no console script**, because one named
`mlym` would shadow the Node CLI. A later `python -m maplibre_yaml validate`
can forward to the pinned npx (Phase 2).

---

## 4. D4/D5 — Versioning and release

### 4.1 The three options compared

| Option | Changelog | Version bump | Minor tracks core | Verdict |
|---|---|---|---|---|
| A. A changeset-like file of our own plus a script that bumps `pyproject` | a second format and tool to write | custom | custom | Reinvents changesets. Contributors learn two systems. |
| **B. A private npm stub that changesets versions** | **changesets writes `packages/python/CHANGELOG.md`** | **`.changeset/*.md`, as for every other package** | **a ~60-line script enforces it** | **Chosen.** One system, one release PR. The CI check that a version PR consumes every changeset covers Python for free. |
| C. Independent versioning (towncrier, a separate tag scheme) | towncrier | manual | not by construction | Breaks the requirement: the package pins a CDN line and a schema set, so its version must say which. |

changesets' own grouping features don't fit:

- **`fixed: [core, python]`** would republish core to npm for a Python-only fix.
- **`linked`** only aligns packages that already have changesets. When core
  moves 0.9 → 0.10 with no Python changeset, Python is left on 0.9.
- A **`dependencies`** entry on core bumps Python only by a patch when core's
  minor moves.

So the coupling is explicit, in `scripts/sync-python-version.mjs`.

### 4.2 `scripts/sync-python-version.mjs`

It runs after `changeset version` and `sync-cdn-pins` in `version-packages`.
It compares the working tree with `HEAD`:

1. **Core's minor moved** (0.9.x → 0.10.0): set Python to `0.10.0`, or
   `0.10.0-<tag>.N` in pre mode, following `.changeset/pre.json`. Prepend this
   entry to `packages/python/CHANGELOG.md`: "Tracks @maplibre-yaml/core 0.10:
   bundled JSON Schemas, preview CDN line and validator move to 0.10." Any
   Python changesets on the same release are folded in; changesets has
   already written their entries.
2. **Core got a patch and Python did not move:** give Python a patch, with the
   entry "Bundles the JSON Schemas of @maplibre-yaml/core 0.10.3." (Q3 asks
   whether to do this only when the schemas actually changed.)
3. **Python's minor ran ahead of core's** (a `minor` changeset on Python
   alone): fail with "a Python minor needs a core minor; use patch, or wait for
   core's next minor".

`--check` mode runs on every PR. It reads `changeset status --output=json` and
rejects case 3 at review time, so the release workflow never meets it. A
`--version core=0.10.0` override makes it testable, as `sync-cdn-pins.mjs` is,
and it gets a unit test beside that one.

The **build hook is the last guard**. Building Python 0.10.0 against core
0.9.1 failed in the prototype with "maplibre-yaml (Python) 0.10.0 must share
core's minor; core is 0.9.1". A prerelease `0.9.0-alpha.0` built as
`maplibre_yaml-0.9.0a0`, which is valid PEP 440 normalisation. pip ignores it
without `--pre`, the same behaviour as npm's `alpha` dist-tag.

**Pre-1.0 consequence:** a breaking change to the Python API can only land on
a core minor. Core's minors are frequent (0.4 → 0.9 in about three months), so
that is acceptable. Q2 asks the maintainer to confirm.

### 4.3 The release job

```yaml
  pypi:
    needs: release
    runs-on: ubuntu-latest
    environment: pypi            # PyPI trusted publisher: design-practices/maplibre-yaml, release.yml, env pypi
    permissions: { contents: read, id-token: write }
    steps:
      - checkout (same ref), setup pnpm/node, astral-sh/setup-uv
      - pnpm install --frozen-lockfile
      - pnpm --filter @maplibre-yaml/core --filter @maplibre-yaml/cli build
      - id: v  # PEP 440 form of packages/python/package.json "version"
      - name: Already on PyPI?
        run: curl -sf https://pypi.org/pypi/maplibre-yaml/${{ steps.v.outputs.pep440 }}/json && echo skip=1 >> $GITHUB_OUTPUT || true
      - if: "!skip": uv build (packages/python) → smoke: install the wheel in a fresh venv, import, write + validate a doc
      - if: "!skip": pypa/gh-action-pypi-publish@release/v1 (packages-dir: packages/python/dist)
```

- **Idempotent.** On an ordinary push, the `release` job only opens or updates
  the version PR. The `pypi` job finds `main`'s version already on PyPI and
  skips. On the version PR's merge, npm publishes and then Python publishes.
  The very first run bootstraps 0.9.0 (Q4).
- **Ordered.** With `needs: release`, the CLI version stamped into the wheel
  (D6) is already on npm when the wheel appears. A failed npm publish blocks
  the PyPI publish.
- **Maintenance lines.** The job runs on `release/*` pushes too. PyPI has no
  dist-tags, and pip takes the highest version, so publishing 0.9.5 after
  0.10.0 moves nobody back. The dist-tag logic in `release.sh` has no Python
  counterpart, and none is needed.
- **Tags.** Set `"privatePackages": { "version": true, "tag": true }` in
  `.changeset/config.json` so `changeset tag` creates
  `@maplibre-yaml/python@X.Y.Z`. `release.sh` already pushes tags. Nothing
  triggers on those tags (`GITHUB_TOKEN` pushes don't start workflows); they
  are a record and a GitHub-release anchor.
- **Setup, once:** register a *pending* trusted publisher on PyPI for
  `maplibre-yaml` (workflow `release.yml`, environment `pypi`). That reserves
  the name until the first publish. Do a first dry run against TestPyPI from a
  branch.
- **Not a separate workflow**, for the reasons in D5. A `pypi` job keeps all
  the shell chaining in steps, so the ml-5ym `publish:` input pitfall does not
  apply.

---

## 5. D6/D7 — Schema sync and validation

### 5.1 Bundling

At build time the hook copies `map`, `scrollytelling` and `any`. It skips
`root`, which is deprecated, as `llms.txt` already does. The schemas are
577 KB uncompressed, and the whole wheel was **63.6 KB**. The hook also writes:

```python
# _core.py — generated by hatch_build.py
CORE_VERSION = "0.9.1"
CLI_VERSION = "0.6.1"
```

These stamped values drive three things:

- the preview CDN URL `https://unpkg.com/@maplibre-yaml/core@0.9/register.js`;
- the validator command `npx --yes @maplibre-yaml/cli@0.6.1 validate`;
- the `core` field in the MIME metadata.

The CLI is pinned to an **exact** version, not a range. CLI 0.6.1 depends on
core `^0.9.1`, which npm resolves to the newest 0.9.x. When core moves to
0.10, changesets bumps the CLI only by a patch (0.6.2 → core `^0.10`). A
`~0.6` pin would therefore silently validate against the wrong minor.

**Core follow-up (proposed, small):** core's `emit-schema` also writes
`schemas/palettes.json` (palette names and colours from `palettes-data.ts`).
Two reasons:

- Python can then check palette names and expose `mlym.palettes` from the same
  source.
- The JSON Schema can carry `enum`s for `palette` and `method`. JSON Schema
  would then catch two more of the eight mistakes below, for every editor too.
  zod keeps its "did you mean" messages.

It changes the published `schemas/` folder, so it needs a minor changeset (Q5).

### 5.2 What JSON Schema catches: measured

The spike's Python `jsonschema` (Draft 7, `best_match`) and
`npx maplibre-yaml@latest validate -f json` (CLI 0.6.x, core 0.9.1) were run
on eight mutations of the generated choropleth:

| Mistake | Python `jsonschema` (bundled schema) | `mlym validate` |
|---|---|---|
| layer key typo `paitn:` | **missed**: layer objects are passthrough in the emitted schema | warning: Unknown key "paitn". Did you mean "paint"? |
| `palette: Blus` | **missed**: plain string | error: Unknown palette "Blus". Did you mean "Blues"? |
| `method: jenk` | **missed** | error: Unknown classification method "jenk". Did you mean "jenks"? … |
| `zoom: "twelve"` | caught | error |
| `type: fil` | caught, but the message prints the whole layer | error with the list of valid types |
| top-level `layer:` | caught (`does not match any of the regexes: '^x-'`) | warning: Did you mean "layers"? |
| layer uses undeclared source | **missed** (cross-field) | warning, with did-you-mean |
| `config: { zom: 3 }` | **missed**: config is passthrough | warning: not a map option … |

**3 of 8 against 8 of 8.** The reasons are already documented in
`emit-json-schema.ts`:

- `.passthrough()` objects stay permissive;
- `.refine()`/`.superRefine()` rules don't convert;
- did-you-mean, deprecations and "has no effect" warnings are zod-side
  behaviour.

### 5.3 The resulting rule

- **`doc.validate()`** is advisory and offline. It returns plain messages,
  narrowed by the layer's `type` so a typo in one field doesn't dump the whole
  layer. Its docstring and the docs say which kinds of mistakes it misses.
- **`doc.validate(strict=True)`** and **`mlym.check("map.yaml")`** run the
  pinned CLI through npx when `node` is on PATH. Without Node they warn once
  and fall back to the advisory check. This tier is authoritative, and it is
  what the course template runs in its site build.
- **By construction:** every helper's output passes strict `mlym validate` in
  CI (D12), so students who stay on the helpers never meet the gap.

---

## 6. D8/D9/D14 — API v0

### 6.1 Shape

| Area | v0 surface |
|---|---|
| Documents | `Map(id, *, basemap="positron", center=None, zoom=None, title=None, **config)` · `.add(data, *, id, type="fill", source=None, format="geoparquet", viewport=False, classify=None, popup=None, hover=None, paint=None, label=None, legend=None, fit=None, **layer)` · `Story(id, *, title, map, theme="light")` · `.chapter(id, title, text=None, *, html=None, frame=None, alignment="left", on_enter=None, on_exit=None, **camera)` · `.doc` (the dict) · `.to_yaml()` · `.to_dict()` · `.save(dir, name=None)` · `.validate(strict=False)` · Jupyter repr |
| Editing | `load(path)` → a document with ruamel round-trip state · `.save()` writes back in place |
| Data | `write_geoparquet(gdf, path, *, viewport=False, row_group_size=None, compression="snappy")` · `write_flatgeobuf(gdf, path)` · `write_cog(src, path, *, compress="DEFLATE", resampling="bilinear")` · `write_pmtiles(gdf, path, *, layer, minzoom=0, maxzoom=None)` |
| Classes | `classify(gdf, field, *, scheme="quantile", k=5, palette="viridis" or a list of colours, reverse=False, format=None, no_data=None, normalize=None)` → a `classify:` dict with **explicit `breaks:`** · `breaks(values, scheme, k)` · `categories(gdf, field, palette=…)` · `palettes` |
| Stories | `set_filter(layer, expr)`, `set_paint(layer, prop, value)`, `set_layout(…)` → action dicts |
| Helpers | `view(bounds_or_gdf, *, width=800, height=500)` → `{center, zoom}` · `explore(gdf, column=None, scheme=None, k=5, cmap=None, tooltip=True, popup=False)` → `Map` · `site_root(path)` · `check(path)` |
| Extension | `SourceLike` protocol: `__maplibre_yaml_source__() -> dict`, optional `__maplibre_yaml_bounds__()` (D14) |
| Constants | `CORE_VERSION`, `CLI_VERSION`, `schema(kind)` |

**What `add(data)` accepts:**

- a **GeoDataFrame**, written on `save()` in `format=`:
  - `geoparquet` (the default) or `flatgeobuf`;
  - `geojson` for tiny data;
  - `pmtiles` when tippecanoe is installed;
- a **path or URL**, referenced as it is;
- a **source dict**, used verbatim;
- any **`SourceLike`**.

**Why GeoParquet by default:**

- core reads only the columns the map uses (seen in the spike: 2 of 6 columns
  were read);
- it is the course's cloud-native format;
- a whole-file read works on any host;
- `viewport=True` adds Hilbert sort, small row groups and `load: viewport`.

**Defaults that validate:**

- `config.center`/`zoom` are framed from the first GeoDataFrame (with
  `fitTo: {source}`), or `[0, 0]`/`1`;
- the basemap is OpenFreeMap positron, which needs no key;
- a main colour is added when neither `paint` nor `classify` gives one;
- duplicate layer ids raise at `add()`;
- stories copy the map's sources and layers, and frame chapters with `view()`.

**Why `classify()` writes explicit breaks.** mapclassify is computed on the
**full** data in the notebook. Writing the result as `breaks:` keeps the
classes identical in four places:

- the analysis;
- a subsampled preview;
- a source read by view or from PMTiles, where core refuses `method:`;
- the site.

It also gives students mapclassify's full set of schemes (Fisher–Jenks,
HeadTail, StdMean, BoxPlot, …). Core only computes `quantile`, `equal` and
`jenks`. **Edge semantics:** mapclassify's `bins` are upper bounds that
include the value. MapLibre's `step` puts a value equal to a break in the
class *above*. The helper writes `bins[:-1]` and documents the edge, with the
same note the thematic-maps guide already gives for QGIS.

**YAML output style:**

- the `# yaml-language-server: $schema=…` modeline comes first, so the file
  gets completion in VS Code;
- keys appear in the docs' order;
- block style for mappings;
- **flow style for MapLibre expressions and short scalar lists**. The
  prototype's default printed `[">=", ["get", …], 115800]` as a block list,
  which is unidiomatic, and a custom representer fixes it.

**Editing hand-written YAML (authoring "both ways").** `load()` uses
ruamel.yaml round-trip mode with `preserve_quotes=True`. On a student file
with comments, an anchor, `<<: *brand` and `str: !html "<b>…</b>"`, an edit
of `zoom` and `fill-color` produced a three-line diff. Two lines were the
edits. The third was ruamel normalising `[{ str: x }]` to `[str: x]`, which
is still valid and is the one cosmetic loss. Core's ml-0fg write seam was
reframed to parse/validate consistency, and comment preservation was dropped
on 2026-08-08. So the Python package owns this capability, and there is no
core API to align with. If core ever grows one, `load()` keeps its signature.

### 6.2 D9 — Paths

The prototype's first browser check passed only because `index.html` sat
beside `map.yaml`. Core's rule, from `guides/data-sources.mdx` §"How paths
are read":

- `data/x` resolves against the **page**;
- in Astro it resolves against **`public/`** ("Relative paths mean 'from
  `public/`'", `guides/publishing.mdx`).

Here is how `save()` handles that:

- **Site root found** (the nearest `public/` above the target, or
  `mlym.site_root("site/public")`):
  - `m.save("site/public/maps/income")` writes
    `site/public/maps/income/map.yaml` and `.../data/income.parquet`;
  - the URL is **`url: maps/income/data/income.parquet`**, with no leading
    slash, so a GitHub Pages `base` still applies;
  - the repr metadata carries `site_path: maps/income/map.yaml`.
- **No site root:** the URL is `data/income.parquet` relative to the YAML's
  folder, and the repr's text line says "serve a page beside map.yaml"
  (the quick-start layout).
- **Q6** asks whether core should accept document-relative paths, for
  example `./data/x` relative to `src`, as an opt-in. That would make every
  saved folder portable, but it is a core behaviour change and outside this
  spike.

### 6.3 Four realistic examples

**Choropleth from a GeoDataFrame:**

```python
import geopandas as gpd, pandas as pd
import maplibre_yaml as mlym

tracts = gpd.read_file("data/tracts.geojson")
tracts["median_income"] = pd.to_numeric(tracts["median_income"], errors="coerce")

m = mlym.Map("income", title="Median household income")
m.add(tracts, id="income", type="fill", label="Median household income",
      classify=mlym.classify(tracts, "median_income", scheme="jenks", k=5, palette="Blues",
                             format={"currency": "USD", "max-fraction-digits": 0}),
      popup=["tract", "median_income"],
      paint={"fill-opacity": 0.85, "fill-outline-color": "#ffffff"})
m                                   # inline preview
m.save("site/public/maps/income")   # map.yaml + data/income.parquet; site-relative url
```

This is the prototype's actual cell. The written YAML (850 B) passed strict
`mlym validate`. In a browser, 96 tracts rendered with a five-class legend
plus "No data".

**A story from the same map:**

```python
base = mlym.Map("income").add(tracts, id="income",
                              classify=mlym.classify(tracts, "median_income", palette="Blues"))
rich = tracts[tracts.median_income >= 115_800]

story = mlym.Story("income-story", title="Income across the city", map=base)
story.chapter("overview", "The whole city", "Five classes of median household income.",
              frame=tracts, alignment="full")
story.chapter("richest", "The top class", "Tracts above $115,800.\n\nMost sit north of the centre.",
              frame=rich,
              on_enter=[mlym.set_filter("income", [">=", ["get", "median_income"], 115_800])],
              on_exit=[mlym.set_filter("income", None)])
story.save("site/public/stories/income")   # story.yaml + data/
```

It validated. In `<ml-scrollytelling>`, scrolling to chapter 2 applied the
filter at zoom 12.40, the value `view(rich)` computed.

**A COG from any raster:**

```python
mlym.write_cog("ndvi_utm.tif", "site/public/maps/ndvi/data/ndvi.tif")   # → EPSG:3857, COG, overviews
m = mlym.Map("ndvi", **mlym.view(bounds_4326))
m.add({"type": "raster", "url": "data/ndvi.tif",
       "colorRamp": {"palette": "YlGn", "min": 0, "max": 0.85}},
      id="ndvi", type="raster", paint={"raster-opacity": 0.9},
      legend={"label": "Vegetation index, 0 to 0.85", "color": "#41ab5d", "shape": "square"})
m.save("site/public/maps/ndvi")
```

In the spike, `write_cog` turned an EPSG:4326 GeoTIFF into an EPSG:3857 COG
(`LAYOUT=COG`, 256 px blocks, overviews), and it rendered with `colorRamp`.
v0 adds a `mlym.cog_source(path, color_ramp=…)` helper, so the dict above is
the escape hatch rather than the main path.

**Editing a student's YAML, and the Folium one-liner:**

```python
doc = mlym.load("site/public/maps/parks/map.yaml")   # comments, anchors, !html kept
doc.doc["config"]["zoom"] = 13
doc.doc["layers"][0]["classify"] = mlym.classify(parks, "acres", scheme="headtail")
doc.save()                                            # minimal diff
doc.validate(strict=True)                             # pinned mlym validate via npx

mlym.explore(gdf, column="pop_density", scheme="quantiles", k=5, cmap="viridis")   # same args as gdf.explore()
```

---

## 7. D10 — Inline Jupyter preview

### 7.1 Options compared

| | Mimebundle + HTML `srcdoc` (Folium-style) | anywidget | Open `mlym preview` / docs playground |
|---|---|---|---|
| Install | none (base package) | `anywidget` + a frontend widget manager | Node (preview), or a browser tab (playground) |
| Two-way (camera, clicks → Python) | no | **yes** | no |
| Exported notebook / nbconvert / site build | **renders**; the converter reads the custom MIME | needs saved widget state; otherwise blank | nothing in the notebook |
| Notebook size | the inlined data, **gzip+base64** (4.1 KB / 128 KB measured) | small (state not saved by default) | none |
| Offline | needs the CDN (as Folium does) | the ESM can be bundled in the wheel; basemap still remote | preview yes (local CLI), playground no |
| Trust prompt | untrusted notebooks strip it; re-run or "Trust" | widgets need a live kernel | n/a |
| JupyterLab / VS Code / Colab | all render `text/html` (Lab and nbconvert verified here; VS Code and Colab still to verify, Q7) | all support anywidget (Colab via its custom widget manager) | n/a |
| Large data | subsample (5,000 per source) | **full data**: send the GeoParquet bytes over the comm, then a `blob:` URL that core reads | full data from files |

**Chosen:** the mimebundle is v0, and it is the only one of the three that
survives export, which is what the course's notebook→site pipeline needs.
anywidget comes in Phase 2 as `mlym.Widget(m)`, for exploring big data and for
two-way state. Its repr returns the widget view *and* the same `text/html` +
custom MIME, so exports still work. The playground link (`#code/` share
fragment, inline-data documents only) is Phase 2, half a day.

### 7.2 How the bundle is built

- **`application/vnd.maplibre-yaml+yaml`:** the saved file's text. It is
  emitted only once the document is saved, because before that its data has
  no URL. The output metadata is `{path, site_path, core: "0.9"}`. It is a
  string MIME type (not `+json`), so the YAML, comments included, sits
  readable in the `.ipynb`. **The converter rule** for the template's
  `build-content.py`: an output with this MIME type becomes
  `<ml-map src="{site_path}">` (or the Astro `<Map>`), and its `text/html` is
  dropped. The site then serves the real files, not an iframe of inlined data.
  The current pipeline's 5–7 MB iframes disappear.
- **`text/html`:** `<iframe srcdoc="…" style="width:100%;height:420px;border:0" loading="lazy">`.
  The srcdoc page:
  - loads `register.js` from `unpkg.com/@maplibre-yaml/core@<stamped minor>`;
  - carries the document gzip-compressed and base64-encoded (no HTML escaping
    needed), decoded with `DecompressionStream('gzip')` and assigned to
    `el.config`;
  - inlines each GeoDataFrame source as GeoJSON with **only the used columns**
    (found the way core's column pruning does: `["get"]`, `property:`,
    `field`, `normalize`), with coordinates at 6 decimals and at most 5,000
    features sampled with a fixed seed. A note under the frame says "showing
    5,000 of 20,000 features".
- A Folium-style line under the frame shows when the iframe was stripped:
  "Run the cell (or File → Trust Notebook) to see the map".

### 7.3 The origin finding

The first prototype sandboxed the iframe (`sandbox="allow-scripts"`), and
every map failed with "Worker failed to load". A matrix in headless Chromium
(SwiftShader) with core 0.9.1:

| Host | maplibre-gl 6.15 (unpkg) | 6.15 + blob worker from fetched source | 5.24 (esm.sh) |
|---|---|---|---|
| srcdoc iframe, no sandbox, http page | ✓ | ✓ | ✓ |
| srcdoc iframe, `allow-scripts allow-same-origin` | ✓ | — | — |
| srcdoc iframe, `allow-scripts` only (opaque origin) | **✗ worker** | **✗** | ✓ |
| nbconvert HTML opened from `file://` (opaque) | **✗ worker** | **✗** | ✓ |

So the srcdoc page starts with a classic inline script. It writes the
import map and CSS for **v6 when `self.origin` is real, and v5 when it is
`"null"` or the protocol is `file:`**, before any module loads. Verified:
over http the preview ran 6.15.0, and from `file://` and in sandboxed frames
it ran 5.24.0. All three notebook outputs rendered in both cases. The iframe
is **not sandboxed** by default, for parity with the site (v6) and with
Folium. The content is generated by the package, and core's trust model
(`!html` off by default) still applies. `preview(sandbox=True)` is available
(it always runs v5).

**Core follow-up:** the friendly `file://` card in `student-messages.ts`
checks `location.protocol === "file:"`. Inside a srcdoc it sees
`about:srcdoc`, so the user gets the raw worker error. The check should also
look at `self.origin === "null"` (a small patch with a changeset).

### 7.4 Sizes (measured, prototype)

| Output | Before (HTML-escaped JSON srcdoc) | Shipped (gzip+base64) |
|---|---|---|
| Choropleth, 96 polygons, 2 used columns | 31,275 B | **4,077 B** |
| 5,000 of 20,000 points | 1,011,910 B | **128,053 B** |
| Whole executed notebook (5 cells, 3 maps) | 1,081,253 B | **142,997 B** |
| nbconvert HTML of it | 1,363,153 B | 424,593 B (mostly nbconvert's CSS) |
| Custom MIME payload (saved YAML) | — | 850 B |

`nbconvert --to notebook --execute` of that notebook took 7.3 s.

---

## 8. D11 — Interop

- **Python ≥ 3.12.** In October 2026, numpy 2.5, mapclassify 2.11 and
  rasterio 1.5 require 3.12. geopandas 1.2, shapely 2.2 and pyarrow 26 require
  3.11. Colab runs 3.12. Python 3.10 reached end of life this month. CI tests
  3.12 (the minimum, and Colab) and 3.14 (the newest), plus a base-only 3.13
  leg.
- **GeoPandas ≥ 1.0.** It added `write_covering_bbox`, `geometry_encoding`
  and GeoParquet 1.1 `schema_version`, and it requires **shapely 2**. pyarrow
  ≥ 16. pandas 3's default Arrow strings work; the spike ran on them. A
  `uv sync --resolution lowest-direct` CI leg tests the lower bounds.
- **Folium users.**
  - `gdf.explore(column=, scheme=, k=, cmap=, tooltip=)` becomes
    `mlym.explore(...)` with the same arguments, and it returns a `Map` that
    can be saved.
  - `folium.Map(location=[lat, lon], zoom_start=12)` becomes
    `mlym.Map(center=[lon, lat], zoom=12)`. The docs call out the
    coordinate-order swap.
  - `folium.Choropleth(geo_data, data, columns, key_on, fill_color, bins)`
    becomes a pandas `merge` plus `classify(..., palette=)`.
  - Tooltips become `hover=`; LayerControl becomes the layer list core already
    shows.
  - The full feature inventory is ml-37r.5's job.
- **Lonboard users.** Lonboard's strength is millions of features over
  GeoArrow in a widget. The v0 inline preview subsamples, and the site reads
  files: GeoParquet with `viewport=True`, or `write_pmtiles` for the largest.
  Where the switch to tiles has to happen (NYC PLUTO, about 850k polygons) is
  ml-37r.5's benchmark. Phase 2's widget closes the in-notebook gap by sending
  GeoParquet bytes to the browser, not inlined JSON.
- **The base install** (ruamel.yaml + jsonschema) needs no compiled wheels.
  Authoring YAML and stories therefore works in JupyterLite/Pyodide. The
  writers need `[geo]`. Course instructions:
  `pip install "maplibre-yaml[all]"`.

---

## 9. D12 — Testing and CI

The new `python` job in `ci.yml`:

1. `pnpm install`, then build core + CLI.
2. `astral-sh/setup-uv`, then `uv sync --frozen --all-extras`.
3. `ruff check`, `ruff format --check`, `pnpm exec pyright`.
4. `pytest`, including `slow`.
5. The **round trip**: a session fixture collects every document the tests
   and the docs examples write, then calls
   `node packages/cli/dist/… validate --strict -f json <all files>` once.
   One process, so it stays fast. Every file must be valid with no warnings.
   The docs' Python snippets run as tests too, like
   `validate-doc-snippets.mjs` does for YAML.
6. On the 3.12 leg: `uv run python packages/python/scripts/e2e_fixtures.py`
   writes into `e2e/.generated/python/`. That is GeoParquet (whole and
   viewport), FlatGeobuf, a COG, a story, and a page per map. Then
   `pnpm exec playwright test e2e/python-output.spec.ts` asserts, for each
   one:
   - features render;
   - only the used columns are read;
   - the classes and legend match Python's breaks;
   - the COG draws;
   - a chapter's `setFilter` applies on scroll.

   The spec is the demo page too (the browser-tests-as-demos rule). It skips
   when the directory is absent, so `verify:browser` stays hermetic and runs
   as it does today.
7. The griffe API-JSON freshness check (D13), and
   `sync-python-version.mjs --check`.

A preview test also renders the `text/html` output in Chromium, both over
http and from `file://`, and asserts the v6/v5 choice of §7.3, so a
maplibre-gl change can't silently blank notebook previews.

---

## 10. D13 — Docs

- A new sidebar group **"Python & notebooks"**, after "Put it in your site":
  - **Maps from Python:** install, the choropleth, writing each format and
    when to use it (sizes from the large-data guide), classify, stories,
    editing YAML, validation tiers, and paths/site root. This takes over
    ml-37r.4's scope, and that bead points here.
  - **Notebooks and your site:** the preview, what an export can and can't
    show, the custom MIME type and the converter rule (§7.2), and migrating
    from Folium and Lonboard.
  - **Python API reference:** generated at docs build by
    `docs/scripts/generate-python-reference.mjs` from a committed
    `docs/src/data/python-api.json`, written by `griffe dump maplibre_yaml`,
    which needs no import of the package. The docs build stays Node-only.
    Cloudflare Pages needs no Python.
- **llms.txt:** a "Python" section with `pip install "maplibre-yaml[all]"`,
  ten lines (choropleth + save), the rule "validate with `doc.validate(strict=True)`
  or `npx maplibre-yaml@latest validate`", and the page links.
  `llms-full.txt` adds the API summary from the griffe JSON. Both come from
  `generate-agent-assets.mjs`, and its test checks the snippet validates.
- **PyPI README:** short; it links to the docs. Its CDN pins go into
  `sync-cdn-pins.mjs` ROOTS (`packages/python/README.md`).

---

## 11. Phasing and effort

Effort is in focused working days for one developer, including tests.

### v0, for the course: about 16 days

| Unit | Work | Est. |
|---|---|---|
| Y1 | Skeleton: stub `package.json`, `pyproject`, hatch hook (schemas, stamp, drift guard), `uv.lock`, `scripts/python.mjs`, presubmit wiring, `.gitignore` | 1.5 d |
| Y2 | Versioning: `sync-python-version.mjs` (+ `--check`, `--version` override, unit test), changesets `privatePackages`, `version-packages` wiring | 1.5 d |
| Y3 | Release: `pypi` job, PyPI pending publisher, TestPyPI dry run | 1 d |
| Y4 | Writers: GeoParquet (whole and viewport), FlatGeobuf, COG, PMTiles (tippecanoe), tests | 1.5 d |
| Y5 | Documents: `Map`/`Story`, defaults that validate, site-root paths, YAML style representer, `load()`/save round trip, actions, `view()`, `SourceLike` | 2.5 d |
| Y6 | Classify: `classify`/`breaks`/`categories`; core `palettes.json` emit (core changeset) | 1 d |
| Y7 | Preview: mimebundle, v6/v5 picker, column pruning + subsample, story frame, trust line; manual pass in JupyterLab, VS Code, Colab | 2 d |
| Y8 | Validation tiers: advisory (messages narrowed by type) and pinned npx; `explore()` | 1 d |
| Y9 | CI `python` job, round-trip fixture, e2e fixtures + `python-output.spec.ts` | 1.5 d |
| Y10 | Docs: two guide pages, generated API reference, llms.txt section, README | 2 d |
| Y11 | Core patch: srcdoc/opaque-origin friendly card (changeset) | 0.5 d |

### Phase 2: about 9 days

- `mlym.Widget` (anywidget `[widget]`): GeoParquet bytes over the comm, then a
  `blob:` URL, for full-data preview; camera, click and selection traitlets
  back to Python; the repr keeps the HTML fallback. 4 d.
- A "playground" link for inline-data documents. 0.5 d.
- `python -m maplibre_yaml validate|preview`, forwarding to the pinned npx. 0.5 d.
- Offline preview: core and maplibre-gl 5 shipped in the wheel and served
  through a tiny Jupyter server extension. 2 d.
- `cog_source()`/`pmtiles_source()` helpers and the polish the course asks
  for. 2 d.

### Phase 3 (not estimated in detail)

- A JupyterLab MIME-renderer extension for `application/vnd.maplibre-yaml+yaml`.
  It would render natively with no iframe, and offline.
- Catalog-aware sources once ml-37r.6 decides (the `SourceLike` seam).
- JupyterLite / Pyodide packaging tested in CI.

---

## 12. Prototype evidence

The prototype was built outside the repo in `~/.cache/xh-tmp/py-spike/`. Its
heavy artefacts are deleted: the 759 MB venv, wheels, data, and executed
notebooks. Its source and notes (`NOTES.md`) are kept in the session
scratchpad (`python-spike/`). It is a mock monorepo:
`packages/core/{package.json, schemas/}`, with the schemas fetched from
`@maplibre-yaml/core@0.9.1` on unpkg, `packages/cli/package.json`, and
`packages/python/`.

- **Build:** hatchling 1.32 with the hook in D6. `uv build` built the sdist,
  then the wheel **from the sdist** (no `../core` visible), in 0.9 s. The wheel
  is 63.6 KB and the sdist 58.6 KB. The drift guard and prerelease
  normalisation were confirmed (§4.2).
- **Notebook:** five cells, executed with
  `uv run --with jupyter nbconvert --to notebook --execute` (7.3 s) and
  exported to HTML. The data was `docs/public/data/classify/sample-tracts.geojson`:
  96 tracts, with `median_income` deliberately messy (strings, `n/a`, blanks),
  coerced with `pd.to_numeric`. It made a Jenks/Blues choropleth, saved it,
  and saved 20k random points with `viewport=True`.
- **Validation:** `npx maplibre-yaml@latest validate` passed the choropleth,
  the points, the COG map and the story, with exit 0 in strict mode (`CI=1`).
  The 8-mutation table is in §5.2.
- **Browser** (Playwright 1.62, Chromium SwiftShader, `<ml-map src>` pages,
  maplibre-gl 6.15 from unpkg; ports 5020–5021):
  - choropleth: 96 features, only `median_income` and `tract` read, legend
    `$23,600–$54,300 … $115,800–$150,000, No data`;
  - points: 20,000 features from a 1.34 MB GeoParquet;
  - COG: rendered with `colorRamp` (served with Range support);
  - story: scrolling applied `setFilter` at zoom 12.40;
  - notebook HTML over http: three previews on maplibre 6.15.0;
  - the same HTML from `file://`: three previews on 5.24.0 (§7.3).
- **Round trip:** comments, an anchor, a merge key and `!html` all survived
  `load()` → edit → `save()` (§6.1).
- **Surprises, all folded into the decisions above:**
  - v6's worker fails in opaque origins (D10);
  - data paths resolve against the page (D9);
  - layers and config are passthrough in the JSON Schema, so key typos are
    invisible to `jsonschema` (D7);
  - HTML-escaping a JSON srcdoc inflates it about 1.6×, and gzip+base64 cuts
    it about 8× (D10);
  - the CLI must be pinned exactly (§5.1);
  - the classify legend's end labels in a preview come from the subsample's
    min/max. The breaks are unaffected; this is documented.

---

## 13. Questions for the maintainer

| # | Question | Recommendation |
|---|---|---|
| Q1 | Docs alias `import maplibre_yaml as mlym`? And register `mlym` on PyPI as a pointer package? | Yes to the alias. Don't register `mlym` unless someone squats it; a pending publisher on `maplibre-yaml` is enough. |
| Q2 | Python's minor is tied to core's, so a breaking Python API change waits for a core minor. OK before 1.0? | Yes. Core's minors are frequent. Revisit at 1.0. |
| Q3 | Re-release Python on **every** core patch, or only when the emitted schemas changed (hash compare)? | Every patch for v0: simple, and the changelog says why. Add the hash compare if PyPI release noise bothers anyone. |
| Q4 | First PyPI release: 0.9.0 now (core is 0.9.1), or wait for core 0.10 and start there? | Ship 0.9.0 when v0 is ready, whichever core line is current then. The sync script handles either. |
| Q5 | Accept the small core changes this needs: `schemas/palettes.json` (+ `palette`/`method` enums in the JSON Schema), and the opaque-origin friendly card? | Yes, both, each with a changeset. |
| Q6 | Should core gain opt-in document-relative paths (`./x` relative to `src`)? It would make any saved folder portable. | Not for v0. `save()` writes site-root-relative URLs. File a bead if the template hits friction. |
| Q7 | Who checks VS Code and Colab by hand before the course? Neither can be automated here. | Part of Y7. Needs someone with both set up. |
| Q8 | Python tests in presubmit when uv is present (fast subset), as proposed? Or CI-only? | In presubmit. It adds a few seconds and catches schema drift before CI does. |
| Q9 | Default data format for `add(gdf)`: GeoParquet always, or GeoJSON under about 1 MB? | GeoParquet always. It teaches the course's format, and column pruning is free. `format="geojson"` stays available. |
| Q10 | Should the "Python & notebooks" pages absorb ml-37r.4's guide? | Yes. Close ml-37r.4 into Y10. |
