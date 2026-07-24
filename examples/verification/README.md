# Phase 1 verification

Bare assertion files for the fixes in `plans/fix-shipped-but-broken.md` (PR: phase-1/integration). Each check states its PASS condition; anything else is a FAIL and a reason not to merge.

## Setup (once, from the repo root)

```bash
pnpm install
pnpm --filter @maplibre-yaml/core build
pnpm --filter @maplibre-yaml/cli build
```

## A — Global config inheritance (`defaultZoom`/`defaultCenter`/`defaultMapStyle`)

```bash
cd examples/verification
pnpm verify:inheritance
```

**PASS:** `ALL CHECKS PASSED`, exit 0. The script asserts: defaultZoom(8) inherits into point/polygon builders (was hardcoded 12), explicit zoom still wins, defaultMapStyle inherits, behavior without a global config is unchanged, and missing-style-everywhere throws `ConfigResolutionError`.

## E — CLI validates and previews every block type

From the repo root (`CLI=node packages/cli/dist/cli.js`):

```bash
node packages/cli/dist/cli.js validate examples/verification/configs/story.yaml        # scrollytelling
node packages/cli/dist/cli.js validate examples/verification/configs/root-pages.yaml   # root pages: doc
node packages/cli/dist/cli.js validate examples/verification/configs/controls-legend.yaml
node packages/cli/dist/cli.js validate examples/verification/configs/unknown-type.yaml # must FAIL well
```

**PASS:** the first three exit 0 ("valid"); the last exits 1 with an error that **lists the valid types** (`map, scrollytelling`, …) — not `Invalid literal value, expected "map"`.

```bash
node packages/cli/dist/cli.js validate examples/verification/configs/story.yaml -f sarif | grep '"version"'
```

**PASS:** the SARIF `tool.driver.version` is the real CLI version (e.g. `0.1.12`), not `0.1.0`.

```bash
node packages/cli/dist/cli.js preview examples/verification/configs/controls-legend.yaml
```

**PASS:** the page's import map points at `/__maplibre-yaml/register.js` (view source) — i.e. the **locally installed** core, not `esm.sh/@maplibre-yaml/core@0.1.2`. Bonus: `preview configs/story.yaml` shows "visual preview currently supports only type: map" instead of a validation error.

Scaffold round-trip (was broken — init told you to run commands that failed):

```bash
cd "$(mktemp -d)" && node <repo>/packages/cli/dist/cli.js init my-story --template story
node <repo>/packages/cli/dist/cli.js validate my-story/story.yaml   # exit 0
```

## B, C, D — Browser checks (one static server for all three)

```bash
cd examples/verification
pnpm serve   # serves the repo root at http://localhost:4174
```

| Page | Asserts | PASS |
|---|---|---|
| [01-cdn-map.html](http://localhost:4174/examples/verification/01-cdn-map.html) | B: documented CDN pattern loads in a plain browser | world map + red dot near NYC; no module-resolution or `Dynamic require of "process"` console errors |
| [02-controls-legend.html](http://localhost:4174/examples/verification/02-controls-legend.html) | C: `controls:`/`legend:` render | zoom buttons (top-right), scale bar (bottom-left), "Legend renders!" box (top-left) |
| [03-mapstyle-error.html](http://localhost:4174/examples/verification/03-mapstyle-error.html) | D: missing `mapStyle` → friendly error | error card naming `config.mapStyle` with an example URL; no blank map, no uncaught exception |

01 uses the local build (`../../packages/core/register.js`). After publishing, swap in `https://unpkg.com/@maplibre-yaml/core/register.js` (comment in the file) and re-check — that is the true post-release CDN assertion, also enforced by `scripts/verify-alpha-publish.sh`.

## F — Docs match code

```bash
node scripts/validate-doc-snippets.mjs
```

**PASS:** `28 snippet(s) validated … All map/scrollytelling YAML snippets are valid.` Spot-check that [packages/core/README.md](../../packages/core/README.md) shows `interactive:` popups as a tag array (not `interactions:` with `{{ }}`).

## G — Hygiene

- `git log -1 -- packages/core/CHANGELOG.md` shows the added 0.2.2 entry (the named-imports revert).
- `.github/workflows/release.yml` contains the `check-publish.sh` gate; `ci.yml` has Node 22 in the matrix and the honest `typecheck` job name.
- `pnpm --filter @maplibre-yaml/core test` — includes 3 new abort-signal tests; the dead legacy refresh path in `layer-manager.ts` is gone.

## v5 sanity (Workstream B, optional)

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i maplibre-gl@5 <repo>/packages/core >/dev/null
node -e "import('@maplibre-yaml/core').then(m => console.log('core imports under maplibre-gl v5:', typeof m.YAMLParser === 'function' ? 'OK' : 'FAIL'))"
```

**PASS:** `OK` — the named-import interop works against maplibre-gl v5 (this exact pattern broke both previous attempts).

---

# Phase 2 verification (validation ergonomics + JSON Schema)

Setup: `pnpm install && pnpm --filter @maplibre-yaml/core build && pnpm --filter @maplibre-yaml/cli build` (the core build emits the JSON schemas). `CLI=node packages/cli/dist/cli.js` from the repo root.

## Validation ergonomics

**Typo → warning with did-you-mean + line/column:**
```bash
$CLI validate examples/verification/configs/typo-warning.yaml
```
PASS: exit 0, one warning `Unknown key "circle-radis". Did you mean "circle-radius"?` with `at line 26, column 7`.

**CI promotes warnings to errors (D9):**
```bash
CI=true $CLI validate examples/verification/configs/typo-warning.yaml   # exit 1
CI=true $CLI validate --no-strict examples/verification/configs/typo-warning.yaml  # exit 0
```

**Unknown layer type lists valid types + suggestion:** change a layer's `type:` to `circl` in any config and validate — expect `Unknown layer type "circl". Valid types: circle, line, ... Did you mean "circle"?`.

**`$ref` sources resolve (todo 035):**
```bash
$CLI validate examples/verification/configs/ref-sources.yaml   # exit 0, valid
```
Change `#/sources/quakes` to a missing name and re-run → `Source reference not found ... Did you mean ...? Defined sources: quakes.`

**Legacy refresh fields warn:** a source using top-level `refreshInterval:` (instead of the `refresh:` block) now emits a deprecation warning naming the replacement.

**Browser diagnostics (D11, console-only):** load `01-cdn-map.html` but remove the `ml-map { height }` CSS → console warns about zero height; remove the MapLibre CSS `<link>` → console warns CSS is missing. No on-map badge.

## JSON Schema + agent affordances

**`mlym schema` prints the schema for each block type:**
```bash
$CLI schema map | head -5          # draft-07 JSON, title "maplibre-yaml map block"
$CLI schema scrollytelling --out /tmp/s.schema.json && head -3 /tmp/s.schema.json
```

**Schemas ship in the core package (generate-on-build, D7):**
```bash
ls packages/core/schemas/*.json                    # map/scrollytelling/root/any (gitignored, built)
git check-ignore packages/core/schemas/map.schema.json   # confirms it's ignored, not committed
```

**Docs publish stable URLs + llms.txt:**
```bash
pnpm --filter docs build
ls docs/dist/schema/latest/*.schema.json docs/dist/llms*.txt
```

**Editor autocomplete:** open any `docs/public/configs/*.yaml` (or a CLI-scaffolded file) in VS Code with the Red Hat YAML extension — the `# yaml-language-server: $schema=` modeline gives autocomplete + inline validation. See `docs` guide "Editor setup".

**ajv round-trip (converter fidelity):** `pnpm --filter @maplibre-yaml/core test` includes 26 tests validating every docs config + CLI template against BOTH the Zod parser and the generated JSON Schema.
