---
title: JSON and TOML map documents — research
type: design
date: 2026-10-26
topic: alternative-document-formats
beads: ml-4cn (epic); ml-4cn.1–ml-4cn.8
target: JSON (phases 0–1) in the next minor; `mlym convert` after; TOML parked pending demand
status: research — recommendation awaiting maintainer decision (§16)
---

# JSON and TOML map documents — research

**The question.** A prospective power user and promoter asked whether map
documents could be written in **TOML** or **JSON** instead of YAML. This
document reports what already works, what each format would cost to support,
and what to do about it. It contains no product code.

Everything was measured against `origin/main` at `353278b` (core 0.9.x,
cli 0.6.1, Astro 5.16.6), in a scratch folder outside the repo. Some tests used
temporary files in a worktree; those were removed afterwards, and nothing in
this PR is a prototype. §17 explains how to reproduce the results.

---

## 1. Summary

| | JSON | TOML |
|---|---|---|
| Works today? | **Almost everywhere.** JSON is a subset of YAML 1.2, so core's parser already reads it. That covers the CLI (validate, preview, emit), `<ml-map src>`, `<ml-scrollytelling src>`, Astro (`loadMapConfig`, `<Map src>`, collections) and the playground. | **No**, with one exception: Astro content collections already accept `.toml` map documents, because Astro parses TOML itself. Their diagnostics have no positions. |
| Diagnostics | Line and column positions and did-you-mean suggestions work, for pretty and minified JSON alike. Some messages are worded for YAML. | A prototype adapter reaches parity by validating the parsed value and then re-attaching positions by path (§8). |
| Gaps | A top-level `$schema` key draws a warning, and VS Code rejects it. Folder discovery skips `.json`. Inline `<script type="application/json">` is ignored. YAML-worded errors. No docs. | No `null`. No anchors or merge keys. No tags. Datetimes. Dotted keys nest silently unless quoted. Plumbing everywhere. A permanent extra cost for every docs page and test. |
| Effort | **≈4–5 days** | **≈8–11 days**, plus ongoing upkeep |
| Recommendation | **Make it official now** (phases 0–1). | **Park it** until there is real demand. Offer `mlym convert` first. Ship the cheap "this looks like TOML" hint now. |

YAML stays canonical in the docs and examples. JSON gets one documented home,
not a second tab on every snippet (§12, §13).

---

## 2. JSON: where it works today, end to end

Every row below was **actually run**, not inferred from code. Browser rows used
Playwright (Chromium with swiftshader) against `e2e/server.mjs` on port 5101.
That server sends `.json` as `application/json` and `.toml` as
`application/octet-stream`.

| Path | Result | Notes |
|---|---|---|
| `mlym validate m.json` (pretty) | ✅ | Errors and warnings carry `line`/`column`, e.g. `config.zoom` at 9:13 and `Unknown key "paitn". Did you mean "paint"?` at 49:7. |
| `mlym validate m.json` (minified, one line) | ✅ | The same findings, at `1:73` and `1:149`. Column positions are correct in flow style. |
| `mlym validate story.json` | ✅ | |
| `mlym validate <folder>` | ❌ | `FOLDER_PATTERN = '**/*.{yaml,yml}'` (`cli/src/lib/glob.ts:51`). A folder holding only JSON prints `✗ File not found: .`, which is misleading because the folder exists (§5). |
| `mlym validate '**/*.json'` | ⚠️ | Validates the documents, but also reports `package.json`, `style.json` and GeoJSON as errors (§5). |
| `mlym preview m.json --port 5100` | ✅ | The server parses the file and inlines the config, so the page renders. Hot reload on a `.json` file was not exercised. |
| `mlym emit m.json` | ✅ | Gives the same `style.json` as the YAML source. `emit story.json` is refused exactly as `emit story.yaml` is. |
| `mlym init` | — | Templates are YAML only. `--format json` is possible but low value (defer). |
| `<ml-map src="m.json">` | ✅ | The content type is ignored; only an HTML body is rejected (`looksLikeHtml`). |
| `<ml-scrollytelling src="story.json">` | ✅ | |
| `<ml-map config='{…}'>` | ✅ | Already validated like YAML (ml-jh6). |
| `<ml-map><script type="application/json">` | ❌ | The "No configuration provided" error card. `ml-map.ts` reads only `script[type="text/yaml"]`. **The same is true of `application/yaml`**, even though `components/styles.ts` hides all three types. That is a latent bug (ml-4cn.2). |
| `<ml-map><script type="text/yaml">{json}</script>` | ✅ | |
| `<ml-scrollytelling><script type="application/json">` | ❌ | Reads `text/yaml` and `application/yaml` only, which differs from `<ml-map>`. |
| Astro `loadMapConfig('m.json')` | ✅ | Goes through `YAMLParser.safeParseMapBlock`. |
| Astro `<Map src="/m.json">` | ✅ | Hands `src` to `<ml-map>`. |
| Astro content collection of `.json` + `getMapSchema()` | ✅ | Verified with a real `astro build` of `examples/astro/minimal` (temporary collection, since reverted). Astro parses JSON itself. |
| Astro dev reload | ✅ | `integration.mjs:65` already watches `.json` under `public/`. |
| Playground: paste JSON | ✅ / ⚠️ | Parsing, diagnostics and rendering all work, because the same `safeParseAny` runs. Three weak spots: `schemaNameFor()` matches only `^type:\s*scrollytelling`, so a JSON story gets map completions. Schema assist is indentation-based, so it offers nothing useful inside JSON. Download writes `map.yaml`, with a YAML modeline, around JSON content. |

**Semantics.** All *valid* JSON parses identically under `yaml.parse(…,
YAML_PARSE_OPTIONS)` and `JSON.parse`. That includes `\/` and `\u` escapes,
surrogate pairs, `1e5`, `-0`, 20-digit integers (both round them the same way)
and empty keys. The YAML parser is **more lenient** than JSON: it accepts
trailing commas, unquoted keys, `0x10`, `.5`, a BOM and `#` comments. It is
**stricter** on duplicate keys, which it rejects ("Map keys must be unique") where
`JSON.parse` keeps the last one. Neither difference is harmful.

## 3. JSON diagnostics

The CST-based checks (`document-checks`, `format-checks`, `reserved-prefix`,
`source-refs`, `classify/checks`, `cog-checks`, `validation-utils`) all reach
positions through two functions, `positionForPath` and `positionForKey`. Both
call `doc.getIn(path, true)` on the yaml `Document`, which has nodes and ranges
for flow collections just as it does for block ones. **Positions are therefore
correct for flow-style JSON, including minified JSON.**

The weaknesses are all in the wording:

| Input | Message today | Problem |
|---|---|---|
| Missing comma | `YAML syntax error: Missing , between flow map items at line 3, column 3` | Says "YAML" and uses YAML terms ("flow map"). The position is right. |
| `"circle-color": #ff0000` | `YAML syntax error: Flow map in block collection must be sufficiently indented…` + `Hint: … YAML reads an unquoted # as the start of a comment` | Both lines are YAML-specific. A JSON author needs "strings must be quoted". |
| `// comment` line | `warning // comment "id": Unknown key "// comment "id""` plus spurious "missing id/config" errors | JSONC comments merge into the next key. A dedicated hint is needed. |
| Missing key | `The document is missing id: — add id: a-short-name.` | The fix is written in YAML syntax. It is understandable, but a JSON author would expect `"id": "…"`. |
| Duplicate key | `YAML syntax error: Map keys must be unique` | Correct and positioned, but says "YAML". |
| Tabs | (valid) | Tabs are fine in JSON, and the YAML parser accepts them in flow context. The tab hint never fires for JSON. |

ml-4cn.4 fixes this. The fix: detect JSON input (by file extension in the CLI
and Astro, or by a first non-space character of `{` for text) and say
"JSON syntax error". Drop the YAML-only `#` hint. Add a "JSON has no comments"
hint. Keep the yaml library's line and column.

## 4. `!html`, `$schema` and `$ref` in JSON

### 4.1 `!html` → `{"$html": "…"}`

The `!html` tag resolves to the structural `HtmlMarker` `{ $html }`
(`utils/html.ts`), so the same value can be **written** directly:

```json
{ "p": [{ "str": { "$html": "<b>bold</b>" } }] }
```

- **Validation.** `mlym validate` reports no warnings. `safeParseMapBlock`
  yields `{"p":[{"str":{"$html":"<b>bold</b>"}}]}`, which is byte-identical to
  the `!html` result. The emitted JSON Schema accepts it, and
  vscode-json-languageservice reports no diagnostic.
- **Trust gating still applies.** `popup-builder.ts` `renderStr` checks
  `isHtmlMarker(str)` and then `allowsHtml(policy)` at the sink. How the marker
  was spelled does not matter, so the JSON spelling grants nothing extra.
- **It works in YAML** (`str: { $html: … }`) **and in TOML**
  (`str = { "$html" = "…" }`).
- **It is undocumented.** ml-4cn.5 covers that.

### 4.2 `$schema`

JSON has no modeline comment, so a top-level `"$schema"` key is **the** way to
tie a JSON document to its schema in an editor. Today:

- core validates the document but warns `$schema: Unknown key "$schema"`;
- the emitted schema's root is `additionalProperties: false`, has no `$schema`
  property (only `patternProperties: {"^x-": {}}`), and
  **vscode-json-languageservice reports `Property $schema is not allowed.`**
  at 2:3. That was tested against `packages/core/schemas/map.schema.json`.

ml-4cn.1 fixes both. It accepts an optional root `$schema` string and strips it
before render and emit. It also adds `"$schema": {"type": "string"}` to each
root schema. yaml-language-server honours a `$schema` key too, so YAML authors
benefit as well. As an alternative that leaves files untouched, VS Code's
`json.schemas` with `fileMatch` also works and belongs in `editor-setup.mdx`.

### 4.3 `$ref`

`resolveReferences` (`#/layers/x`, `#/sources/x`) is format-neutral. In JSON it
is `"$ref": "#/layers/x"`. In TOML the key must be quoted: `"$ref" = "…"`.

## 5. Folder validation: picking up `.json` without picking up everything

A real project folder is full of JSON that is not a map document:
`package.json`, `tsconfig*.json`, `style.json` (a MapLibre style, which has
`layers`), `*.geojson`, FeatureCollections saved as `.json`, and
`maplibre-yaml.config.json`. Running `mlym validate '**/*.json'` on a fixture
folder gives:

```
✗ package.json      error Unable to determine document type. …
✗ style.json        error type: The document is missing type: at the top — add type: map …
✗ sub/points.json   error type: Unknown block type: "FeatureCollection". …
✓ sub/quake.json
✓ sub/story.json
```

YAML discovery already has a milder version of this problem. A stray `ci.yml`
in the folder fails with "Unable to determine document type". Dot folders such
as `.github` are spared only by `dot: false`.

| Option | For | Against |
|---|---|---|
| Naming convention (`*.map.json`, `*.story.json`) | Explicit and cheap. | Invents a rule nobody else uses. A misnamed document is silently skipped. Docs and templates must teach it. |
| `--ext json` flag | Opt-in, so no surprises. | A folder of JSON maps needs the flag forever. A bare `mlym validate maps/` still skips them. |
| **Content sniff** (recommended) | No new rule to learn. Package, style and GeoJSON files can never qualify. | One read and parse per `.json` file, which validation does anyway. Needs a size cap. |

**Recommendation (ml-4cn.3).** Under a *folder* argument, a `.json` file joins
the run only when it parses to an object that meets one of these conditions:

- `type` is `"map"` or `"scrollytelling"`;
- it has a top-level `pages` array;
- its `$schema` points under `docs.maplibre-yaml.org/schema/`.

Skip anything over about 5 MB without parsing it. Report the number of skipped
files under `--verbose`. Files and globs named **explicitly** keep today's
behaviour, so a broken document is never hidden. Also replace the "File not
found: ." message for a folder with no documents. Whether YAML discovery should
get the same sniff is open question 3.

## 6. Emit, round trip and conversion

- **`mlym emit`** works on a parsed value and does not care about the input
  format. JSON emits the same `style.json` as YAML.
- **Round trip YAML → JSON → YAML** is lossless for data, but loses:
  - **comments**, since JSON has none;
  - **anchors, aliases and merge keys**, which are expanded at parse time;
  - **the `!html` spelling**, which becomes `{"$html"}`. A converter can turn it
    back into `!html`.
- **A converter is useful** (ml-4cn.6). Agents and APIs emit JSON
  (vault: `concepts/agent-driven-map-publishing.md`). Some pipelines are JSON
  only. And while TOML is parked, a converter is the honest answer to "can I
  write TOML?". Two traps:
  1. **Convert the authored value, not `result.data`.** The validated data has
     defaults filled in (`pitch: 0`, `visible: true`, `fetchStrategy: runtime`
     all appear in the preview page's inlined config), and sugar is expanded.
  2. **`JSON.stringify(v, null, 2)` explodes expressions.** The quick-start
     example grows from 32 lines of YAML to 75 lines of JSON, because
     `["get", "mag"]` spreads over four lines. A converter needs a printer that
     keeps short arrays and expressions inline. The hand-formatted JSON in §10
     is 40 lines.

## 7. TOML: choosing a parser

All sizes were measured the same way: `esbuild --bundle --minify --format=esm
--platform=browser`, then `gzip -9`, importing `parse` only unless noted.
Compliance was tested on MapLibre-shaped input.

| Parser (version) | gzip | License | Last release | Weekly downloads | Heterogeneous arrays | TOML 1.1 multi-line inline tables | Value positions |
|---|---|---|---|---|---|---|---|
| **smol-toml** 1.9.1 | **5.5 KB** (6.7 KB with `stringify`) | BSD-3-Clause | 2026-10 | ~20.9M | ✅ | ✅ | ❌ (errors only: `line`/`column`) |
| **toml** 5.0.1 (BinaryMuse; rewritten in 2026) | 9.0 KB | MIT | 2026-10 | ~20.1M | ✅ | ✅ | ❌ (errors only) |
| **toml-eslint-parser** 1.0.3 | 10.2 KB (parse + `getStaticTOMLValue`) | MIT | 2026-01 | ~1.0M | ✅ | ✅ (1.1 is the default; the README still calls it "experimental") | ✅ **full AST, `loc` and `range` on every key, value, header and element; `resolvedKey` on tables, including array-of-tables indices** |
| @ltd/j-toml 1.38.0 | 16.9 KB | **LGPL-3.0** | 2023-01 | ~0.5M | ✅ | ❌ | ❌ |
| @iarna/toml 2.2.5 | 6.7 KB | ISC | 2020-04 | ~5.5M | ❌ **"Inline lists must be a single type"**, so it fails on `["interpolate", ["linear"], …]` and on 2 of the 4 sample documents | ❌ | ❌ |

For comparison, the yaml library is **31.4 KB** gzip on the same measure.
`register.browser.js` is **184 KB** gzip, and the existing lazy chunks range
from 6.8 KB (`protomaps-basemap`) to 132 KB (`cog`).

Other observations:

- **Astro 5.16 already depends on smol-toml**, which it uses for `.toml`
  content entries and the `file()` loader. An Astro consumer would pay no extra
  install cost for it.
- **Datetimes.** Bare TOML datetimes become objects: smol-toml returns a
  `TomlDate` (whose `toJSON` keeps the local-date form, `"2024-01-02"`), `toml`
  returns a `Date` for offset datetimes and a string otherwise, and
  toml-eslint-parser returns a `Date` (losing the local form). See §9.
- **The `LOADERS`/`getDecoder` seam fits** (`formats/decoders.ts`). A
  `toml: () => import("…")` line gives a third-party-only chunk about the size
  of `pmtiles` (7.6 KB). The catch is that text parsing is **synchronous**
  today (`safeParseMapBlock(text)`), so a lazy parser makes the TOML path
  async. That is fine for `src=`, which is already awaited. For inline scripts
  it means one extra `await`. Node (CLI, Astro) can import the parser
  statically. Inlining smol-toml instead would add about 3% to the browser
  bundle, so lazy loading is preferable but not essential.

**Pick.** If TOML ever ships, use **toml-eslint-parser**. It provides values
and exact positions in one pass, and diagnostics are this product's main
strength. The fallback is smol-toml with the line scanner from §8, which is
smaller and line-accurate on machine-written TOML. Exclude @iarna/toml (no
heterogeneous arrays) and @ltd/j-toml (LGPL, no TOML 1.1).

## 8. TOML: source positions (prototype)

Diagnostics need a `line`/`column` for each **value path**, the same contract
as `positionForPath`: the exact node if there is one, otherwise the nearest
ancestor. Three options:

- **(a) A parser that exposes positions.** Walk the toml-eslint-parser AST and
  index every key, value, inline-table entry, array element, table header and
  implicit parent. Exact by construction (about 50 lines).
- **(b) A lightweight tokenizer.** Scan lines for `[table]`, `[[array]]` and
  `key = value`. Track array-of-tables counters, implicit parents, open
  multi-line arrays and inline tables (bracket depth), and multi-line strings.
  Values inside an inline array or table fall back to their key's line. About
  100 lines; parse values with smol-toml separately.
- **(c) Paths only.** No positions at all, as Astro collections give today
  (`bad.toml:0:0`).

**Accuracy of (b) against (a):**

| Corpus | Paths | (b) same line as (a) | (b) exact node | (b) no position | Time for (smol / AST / scan) |
|---|---|---|---|---|---|
| 237 repo documents (every `examples/**/*.yaml` and every full map or story fenced in `docs/**/*.mdx`), machine-converted with `smol-toml.stringify` | 11,783 | **100.0%** | 70.2% | 0% | 12 ms / 70 ms / 20 ms |
| The 4 hand-written documents of §10 | 214 | **89.7%** | 67.8% | 0% | 2 ms / 8 ms / 1 ms |

The scanner's misses are all **elements of multi-line inline arrays**, such as
the popup `p = [ … ]` spread over three lines. Those land one or two lines too
early, on the line that opens the array. Machine-written TOML keeps inline
arrays on one line, so it scores 100%.

**End-to-end prototype.** The pipeline was: TOML text → smol-toml → coerce
datetimes → core's existing **value** entry point
(`YAMLParser.safeParseMapBlockValue`) → re-attach positions by path from
index (a). Run on the quick-start example with four planted mistakes:

```
✗ err/bad.toml
  error config.zoom: Expected number, got string
    at line 7, column 8
  warning layers.0.paitn: Unknown key "paitn". Did you mean "paint"?
    at line 19, column 1
  warning layers.0.interactive.click.popup.1.p.1.format.max-fraction-digit: Unknown key "max-fraction-digit". Did you mean "max-fraction-digits"?
    at line 35, column 55
```

With `type = "circel"`, the result was `Unknown layer type "circel" … Did you
mean "circle"?` at 14:1, the `[[layers]]` header. With index (b), every line is
the same except the last finding, which lands at 33:5 (the `p = [` line)
instead of 35:55.

**Why this works without refactoring core.** The value entry points already run
the whole pipeline (sugar, schema, did-you-mean, every check). They report
paths, but no positions, because they validate a YAML string synthesized from
the value. So a format adapter can stay **outside** the YAML-specific position
machinery:

- `positionForPath` and `positionForKey` take a yaml `Document` and
  `LineCounter`, at 12 call sites in 8 files;
- `findHashCommentValues` and `yaml-errors.ts` are YAML-only, and correctly so;
- `classify/category-order.ts` reads the YAML AST to keep the authored order of
  integer-like `categories` keys. **This one is a real gap for TOML.** It can be
  restored from AST (a).

A shared `SourceIndex` interface (`positionOf(path)`, `keyPositionOf(path,
key)`) would be the deeper refactor. It is only needed if TOML-specific checks
ever need the tree.

## 9. TOML: semantic gaps compared with YAML

**Inventory.** These figures come from scanning the same 237 documents. Every
one converted to TOML.

| Gap | Where maplibre-yaml needs it | Assessment |
|---|---|---|
| **No `null`** | Found 5 times in 237 documents. Four are story `setFilter` with `filter: null` (`examples/scrollytelling/story.yaml`, `verification/cloud-native/story.yaml`, `schema/scrollytelling.mdx`, `astro-stories.mdx`). One is a GeoJSON property, `pop: null` (`verification/configs/classify.yaml`). Schema-level nullables: `ChapterAction.filter` (also `.optional()`), GeoJSON `Feature.geometry` and `Feature.properties`. MapLibre expressions can contain null (`["==", ["get","x"], null]`, `["literal", null]`, a `coalesce` fallback); none of the 237 documents does. | **Mostly a non-issue.** *Omitting* `filter` already clears it (`scrollytelling/engine.ts`: `map.setFilter(layer, action.filter ?? null)`), so the TOML idiom is "leave the key out", which needs documenting. Null properties are equivalent to absent ones for `["get"]`. Null-comparing expressions need rewriting (`["!", ["has","x"]]`). A null-geometry Feature cannot be written. `classify` `noData: hide` is a string sentinel, so there is no gap there. Writing `filter = null` in TOML gives a generic `invalid value` syntax error, which needs a hint. |
| **No anchors or merge keys** | `guides/reuse.mdx` (anchors, aliases, `<<: *base`). Corpus: 1 document uses anchors, 0 full documents use merge keys; the guide's examples are snippets. | A real loss for anyone who reuses blocks. TOML authors get named sources and `$ref` only. A converter expands anchors with a warning. |
| **No custom tags** | `!html` | Covered: use the structural `str = { "$html" = "…" }` (§4.1), which already works. |
| **Datetimes** | None in the corpus (no date-like strings at all). YAML 1.2's core schema keeps `2024-01-02` as a **string**. | In TOML a *bare* date becomes an object, and a string-typed schema field then fails with "Expected string". The adapter should coerce every datetime to the RFC 3339 text as written, for example via smol-toml's `TomlDate.toJSON`, or from the source text when using the AST. Quoted dates stay strings. |
| **Integer vs float** | No schema distinguishes them. `classes`, `zoom` and similar are numbers. | `1.0` becomes 1 in every parser, which is a non-issue. Integers above 2^53: `toml` throws unless `bigint: true`, while smol-toml returns a lossy number. Not seen in documents; feature ids are where it would show up. |
| **Key quoting** | Bare keys allow `A-Za-z0-9_-`, so `circle-color`, `text-field`, `fill-extrusion-height` and `max-fraction-digits` are all fine bare. **These need quotes:** every `locale` key (`"NavigationControl.ZoomIn"`, `"Popup.Close"`, `"maplibre-yaml.Legend.Title"`, `"Map.Title"`, …), plus `"$ref"`, `"$html"`, `"$schema"`, and font names with spaces such as `"Noto Sans Regular"` used as keys. | **A silent trap.** Unquoted `maplibre-yaml.Legend.Title = "x"` is *valid TOML* that nests as `{maplibre-yaml: {Legend: {Title: "x"}}}`. Core then reports `config.locale.maplibre-yaml: Expected string, got object`. That message is correctly positioned but baffling. The fix is either a TOML-specific hint or flattening nested tables under `locale` (open question 6). |
| **Deeply nested arrays of tables** | `layers[]` → `interactive.click.popup[]` → element lists; `chapters[]` → `onChapterEnter[]`. | They work, but the structure is **implicit**. `[[layers.interactive.click.popup]]` attaches to the *most recent* `[[layers]]`. Once a sub-table such as `[layers.paint]` has been opened, any later plain key lands in that sub-table, not in the layer. So a layer's scalar keys must all come before its first sub-table. This is the classic TOML complaint for nested data (StrictYAML's "Why not TOML"; NestedText's alternatives page). |
| **Common typos** | `circle-color = #fff` (unquoted colour) | Gives the generic syntax error `invalid value` (smol) or `Unspecified values are invalid` (toml-eslint-parser). The adapter should add the same quoting hint YAML has. |

## 10. Side by side

Four real documents, translated **by hand** into idiomatic TOML 1.0. Every one
also parses under TOML 1.1. Each TOML file was parsed, deep-compared with the
YAML value (identical, except where §9 says otherwise), and validated through
core's value entry point.

| Document | YAML lines | TOML lines (non-blank) | JSON lines (`JSON.stringify(…, 2)`) |
|---|---|---|---|
| Quick-start earthquake map | 32 | 29 | 75 |
| `classify` choropleth with popup | 40 | 37 | 76 |
| Story: 3 chapters with actions | 57 | 56 | 108 |
| `locale:` translation table | 22 | 24 | 40 |

### 10.1 Quick-start earthquake map (`getting-started/first-map.mdx`)

```yaml
type: map
id: earthquake-map
config:
  center: [-160, 20]
  zoom: 1
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
layers:
  - id: earthquakes
    type: circle
    source:
      type: geojson
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"
    paint:
      circle-radius: ["interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20]
      circle-color: "#e74c3c"
      circle-opacity: 0.7
      circle-stroke-width: 1
      circle-stroke-color: "#ffffff"
    interactive:
      hover:
        cursor: pointer
      click:
        popup:
          - h3:
              - property: place
          - p:
              - str: "Magnitude "
              - property: mag
                format: { max-fraction-digits: 1 }
controls:
  navigation: true
  scale: true
```

```toml
#:schema https://docs.maplibre-yaml.org/schema/latest/map.schema.json
type = "map"
id = "earthquake-map"

[config]
center = [-160, 20]
zoom = 1
mapStyle = "https://tiles.openfreemap.org/styles/liberty"

[controls]
navigation = true
scale = true

[[layers]]
id = "earthquakes"
type = "circle"
source = { type = "geojson", url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson" }

[layers.paint]
circle-radius = ["interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20]
circle-color = "#e74c3c"
circle-opacity = 0.7
circle-stroke-width = 1
circle-stroke-color = "#ffffff"

[layers.interactive.hover]
cursor = "pointer"

[[layers.interactive.click.popup]]
h3 = [{ property = "place" }]

[[layers.interactive.click.popup]]
p = [
  { str = "Magnitude " },
  { property = "mag", format = { max-fraction-digits = 1 } },
]
```

The same document in JSON, formatted by hand the way a converter should print
it (40 lines, compared with 75 from `JSON.stringify`):

```json
{
  "$schema": "https://docs.maplibre-yaml.org/schema/latest/map.schema.json",
  "type": "map",
  "id": "earthquake-map",
  "config": {
    "center": [-160, 20],
    "zoom": 1,
    "mapStyle": "https://tiles.openfreemap.org/styles/liberty"
  },
  "layers": [
    {
      "id": "earthquakes",
      "type": "circle",
      "source": {
        "type": "geojson",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"
      },
      "paint": {
        "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20],
        "circle-color": "#e74c3c",
        "circle-opacity": 0.7,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff"
      },
      "interactive": {
        "hover": { "cursor": "pointer" },
        "click": {
          "popup": [
            { "h3": [{ "property": "place" }] },
            { "p": [
              { "str": "Magnitude " },
              { "property": "mag", "format": { "max-fraction-digits": 1 } }
            ] }
          ]
        }
      }
    }
  ],
  "controls": { "navigation": true, "scale": true }
}
```

(The `$schema` line needs ml-4cn.1 before it stops warning.)

**Verdict.**
- **TOML** is pleasant for the flat parts (`[config]`, `[controls]`, `paint`),
  and expressions read exactly as they do in YAML. The popup is the weak spot.
  Each popup row becomes a `[[layers.interactive.click.popup]]` header that
  repeats the full path and is no longer visibly *inside* the layer. With a
  second layer, readers have to know that these headers bind to the last
  `[[layers]]`.
- **JSON** is noisier but unambiguous.

### 10.2 `classify` choropleth with a popup (`guides/thematic-maps.mdx`, plus a popup)

```yaml
type: map
id: income-choropleth
config:
  center: [-75.19, 39.936]
  zoom: 12
  mapStyle: "https://tiles.openfreemap.org/styles/positron"
sources:
  tracts:
    type: geojson
    url: /data/classify/sample-tracts.geojson
layers:
  - id: income
    type: fill
    source: tracts
    label: Median household income
    classify:
      field: median_income
      method: quantile
      classes: 5
      palette: Blues
      noData: hide
      format: { currency: USD, max-fraction-digits: 0 }
    paint:
      fill-opacity: 0.85
      fill-outline-color: "#ffffff"
    interactive:
      hover:
        cursor: pointer
        highlight: true
      click:
        popup:
          - h3:
              - property: NAME
          - p:
              - str: "Median income: "
              - property: median_income
                format: { currency: USD, max-fraction-digits: 0 }
                else: "no data"
legend:
  position: bottom-left
```

```toml
#:schema https://docs.maplibre-yaml.org/schema/latest/map.schema.json
type = "map"
id = "income-choropleth"

[config]
center = [-75.19, 39.936]
zoom = 12
mapStyle = "https://tiles.openfreemap.org/styles/positron"

[sources.tracts]
type = "geojson"
url = "/data/classify/sample-tracts.geojson"

[legend]
position = "bottom-left"

[[layers]]
id = "income"
type = "fill"
source = "tracts"
label = "Median household income"

[layers.classify]
field = "median_income"
method = "quantile"
classes = 5
palette = "Blues"
noData = "hide"
format = { currency = "USD", max-fraction-digits = 0 }

[layers.paint]
fill-opacity = 0.85
fill-outline-color = "#ffffff"

[layers.interactive.hover]
cursor = "pointer"
highlight = true

[[layers.interactive.click.popup]]
h3 = [{ property = "NAME" }]

[[layers.interactive.click.popup]]
p = [
  { str = "Median income: " },
  { property = "median_income", format = { currency = "USD", max-fraction-digits = 0 }, else = "no data" },
]
```

**Verdict.** `[layers.classify]` is arguably *clearer* in TOML than in YAML,
since it is a flat, settings-like block, which is what TOML is designed for.
Every string must be quoted (`"quantile"`, `"Blues"`, `"hide"`), which is noisier
for students but removes YAML's quoting ambiguity, including the `#` colour
trap. The popup has the same problem as in 10.1.

### 10.3 Story with 3 chapters and actions (`examples/scrollytelling/story.yaml`, trimmed)

```yaml
type: scrollytelling
id: ring-of-fire
theme: dark
config:
  mapStyle: "https://demotiles.maplibre.org/style.json"
  center: [160, 10]
  zoom: 1.5
layers:
  - id: volcanoes
    type: circle
    source:
      type: geojson
      url: ./volcanoes.geojson
    paint:
      circle-radius: 7
      circle-color: "#fbbf24"
chapters:
  - id: intro
    title: The Ring of Fire
    description: >-
      <p>Three quarters of the world's active volcanoes sit on a
      40,000 km horseshoe around the Pacific.</p>
    center: [160, 10]
    zoom: 1.5

  - id: japan
    title: "Japan: the tall ones"
    description: <p>Volcanoes above <strong>2,500 m</strong> turn red.</p>
    center: [137, 35]
    zoom: 5
    pitch: 45
    onChapterEnter:
      - action: setPaintProperty
        layer: volcanoes
        property: circle-color
        value: "#ef4444"
      - action: setFilter
        layer: volcanoes
        filter: [">=", ["get", "elevation"], 2500]
    onChapterExit:
      - action: setFilter
        layer: volcanoes
        filter: null
      - action: setPaintProperty
        layer: volcanoes
        property: circle-color
        value: "#fbbf24"

  - id: pacific
    title: The whole basin
    description: <p>A <code>fitBounds</code> action frames the rim.</p>
    center: [-170, 10]
    zoom: 2
    onChapterEnter:
      - action: fitBounds
        bounds: [100, -50, 290, 62]
        options:
          padding: 40
          duration: 1500
```

```toml
#:schema https://docs.maplibre-yaml.org/schema/latest/scrollytelling.schema.json
type = "scrollytelling"
id = "ring-of-fire"
theme = "dark"

[config]
mapStyle = "https://demotiles.maplibre.org/style.json"
center = [160, 10]
zoom = 1.5

[[layers]]
id = "volcanoes"
type = "circle"
source = { type = "geojson", url = "./volcanoes.geojson" }
paint = { circle-radius = 7, circle-color = "#fbbf24" }

[[chapters]]
id = "intro"
title = "The Ring of Fire"
description = """
<p>Three quarters of the world's active volcanoes sit on a \
40,000 km horseshoe around the Pacific.</p>"""
center = [160, 10]
zoom = 1.5

[[chapters]]
id = "japan"
title = "Japan: the tall ones"
description = "<p>Volcanoes above <strong>2,500 m</strong> turn red.</p>"
center = [137, 35]
zoom = 5
pitch = 45

[[chapters.onChapterEnter]]
action = "setPaintProperty"
layer = "volcanoes"
property = "circle-color"
value = "#ef4444"

[[chapters.onChapterEnter]]
action = "setFilter"
layer = "volcanoes"
filter = [">=", ["get", "elevation"], 2500]

[[chapters.onChapterExit]]
action = "setFilter"
layer = "volcanoes"
# no `filter` key: TOML has no null, and an omitted filter clears it

[[chapters.onChapterExit]]
action = "setPaintProperty"
layer = "volcanoes"
property = "circle-color"
value = "#fbbf24"

[[chapters]]
id = "pacific"
title = "The whole basin"
description = "<p>A <code>fitBounds</code> action frames the rim.</p>"
center = [-170, 10]
zoom = 2

[[chapters.onChapterEnter]]
action = "fitBounds"
bounds = [100, -50, 290, 62]
options = { padding = 40, duration = 1500 }
```

**Verdict.** This is the hardest case for TOML.
- **Implicit binding.** `[[chapters.onChapterEnter]]` binds to the most recent
  `[[chapters]]`, so chapter boundaries are visible but the *ownership* of each
  action is not.
- **Ordering constraint.** Moving `pitch = 45` below the first action header
  silently makes it a key of that action. Unknown-key warnings would catch it,
  but YAML's indentation makes the mistake impossible in the first place.
- **No null.** The absence of `filter` has to be explained in a comment.
- **Folded text.** YAML's `>-` becomes `"""…\` line continuations, which work
  but are fussier to write.

This is the "deeply nested arrays of tables" problem that TOML's own community
acknowledges (§13.2).

### 10.4 `locale:` translation table (`examples/verification/i18n/titled.yaml`, trimmed)

```yaml
type: map
id: calor
title: Vulnerabilidad al calor en el Bronx
config:
  center: [-73.88, 40.84]
  zoom: 11
  mapStyle: "https://tiles.openfreemap.org/styles/positron"
  locale:
    NavigationControl.ZoomIn: Acercar
    NavigationControl.ZoomOut: Alejar
    NavigationControl.ResetBearing: Restablecer la orientación
    Popup.Close: Cerrar
    maplibre-yaml.Legend.Title: Leyenda
    maplibre-yaml.Notice.Title: Parte de este mapa no se pudo cargar
    maplibre-yaml.Notice.Dismiss: Cerrar este aviso
controls:
  navigation: true
legend:
  title: Distritos
  items:
    - { color: "#fee08b", label: Bajo, shape: square }
    - { color: "#d73027", label: Alto, shape: square }
```

```toml
#:schema https://docs.maplibre-yaml.org/schema/latest/map.schema.json
type = "map"
id = "calor"
title = "Vulnerabilidad al calor en el Bronx"

[config]
center = [-73.88, 40.84]
zoom = 11
mapStyle = "https://tiles.openfreemap.org/styles/positron"

[config.locale]
"NavigationControl.ZoomIn" = "Acercar"
"NavigationControl.ZoomOut" = "Alejar"
"NavigationControl.ResetBearing" = "Restablecer la orientación"
"Popup.Close" = "Cerrar"
"maplibre-yaml.Legend.Title" = "Leyenda"
"maplibre-yaml.Notice.Title" = "Parte de este mapa no se pudo cargar"
"maplibre-yaml.Notice.Dismiss" = "Cerrar este aviso"

[controls]
navigation = true

[legend]
title = "Distritos"
items = [
  { color = "#fee08b", label = "Bajo", shape = "square" },
  { color = "#d73027", label = "Alto", shape = "square" },
]
```

**Verdict.** Readable, but **every key must be quoted**, and forgetting the
quotes produces valid TOML with a different shape. Without quotes, the
prototype reports three `Expected string, got object` errors at the right
lines (12, 15 and 16). They are confusing unless the adapter explains that
TOML treats dots in keys as nesting.

**Overall readability.** TOML is roughly as short as YAML (within about 10%
of the line count), safer about quoting, and clearer for flat settings
blocks. It gets worse as nesting deepens: layers with popups, and stories with
actions, are exactly the shapes maplibre-yaml documents are made of. JSON is
about twice as long in lines and noisy, but never ambiguous, and every tool
and agent already speaks it.

## 11. TOML: detection and plumbing

### 11.1 What happens today (ml-4cn.7)

A user who tries TOML gets YAML parser noise:

| Where | Message |
|---|---|
| `mlym validate quake.toml` | `Unable to determine document type. Expected a block with "type: map"…` |
| The same file with a `#:schema` line | `YAML syntax error: Implicit keys need to be on a single line at line 2` |
| `<ml-map src="map.toml">` | Error card: `Expected object, got string (line 1)` |

A cheap sniff fixes this whether or not TOML ever ships. It looks for table
headers or `key = value` lines with no `key:` lines, and replaces the noise
with "This looks like TOML…".

### 11.2 If TOML ships (ml-4cn.8)

- **Detection:**
  - file extension `.toml`;
  - content type `application/toml`;
  - inline `<script type="application/toml">`;
  - in text with no other hint, the sniff from 11.1.
- **Core:** a `parseDocumentText(text, { format })` front door. YAML and JSON
  keep the current path. TOML goes through the adapter in §8.
- **Browser:** a `LOADERS` chunk. The TOML path becomes async.
- **CLI:**
  - folder discovery picks up `.toml` files that carry `type =` (the ml-4cn.3
    sniff);
  - `validate`, `preview` and `emit` go through the front door;
  - `init --format toml` is optional.
- **Astro:** `loadMapConfig` and `loadFromGlob` dispatch on the extension.
  Collections already work but with weak diagnostics; document that.
- **Playground:** a language toggle. CodeMirror has a TOML legacy mode. Schema
  assist would need a TOML path finder, but the §8 scanner already is one.
- **Editors:** Taplo / Even Better TOML reads a `#:schema <url>` directive at
  the top of the file, or `toml.schema.associations`, and can use the existing
  JSON Schemas. That needs ml-4cn.1, and a check that Taplo tolerates the `^x-`
  `patternProperties`.

## 12. Maintenance cost

| Cost | JSON | TOML |
|---|---|---|
| Parser | None (the yaml library) | +1 dependency, lazily loaded in the browser |
| Diagnostics | Wording only | An adapter, hints, datetime coercion, the category-order gap |
| Tests | A handful of wording and discovery tests | Every check needs TOML fixtures, plus a converter to generate them from the YAML fixtures |
| Docs | One section, editor setup, an llms.txt line | One page (gaps, quoting, null idioms, `#:schema`), and pressure to show TOML next to every example |
| Support | Low; agents and tools already emit JSON | A third syntax in issues and Discord; examples fragment |
| llms.txt | "JSON is accepted and validates identically" | The same, plus the TOML gaps, or agents will write `filter = null` |

The fragmentation risk is real. Hugo documents every configuration snippet in
three tabs (TOML, YAML, JSON) and pays for it on every page. ESLint went the
other way: after years of `.eslintrc.{json,yaml,yml,js}` it consolidated onto
one format in v9 and removed eslintrc in v10. This library's docs are its main
teaching surface, so a second tab on every snippet would be a large tax.
**Keep YAML canonical. JSON and TOML each get one page.**

## 13. Alternatives and prior art

### 13.1 `mlym convert` (keep YAML canonical) — ml-4cn.6

Command: `mlym convert <file> --to json|yaml [--out]`, adding `toml` later.

- **Input:** validate first, then convert the **authored** value (§6), keeping
  expressions inline.
- **Loss report on stderr:**
  - comments dropped (counted through the CST);
  - anchors and merge keys expanded;
  - for TOML later, nulls. smol-toml's `stringify` **silently drops null table
    values and throws on null array items** (measured), so the converter must
    find nulls itself first.
- **Effort:** about 1.5–2 days for YAML⇄JSON, plus about 1 day for TOML.
- **What it gives you:**
  - every format can produce a canonical document;
  - nothing extra to maintain in core;
  - a ready answer for the TOML-curious.
- **What it costs:** authors who *maintain* documents in TOML still get no
  editor diagnostics from maplibre-yaml. Taplo plus the JSON Schema gives them
  most of that anyway.

### 13.2 How comparable tools handle formats

| Tool | Formats | Lesson |
|---|---|---|
| **Vega-Lite / Vega** | JSON only. Every spec carries `$schema` (`https://vega.github.io/schema/vega-lite/v6.json`) for editor validation and autocomplete. Altair (Python) and other bindings *generate* JSON. | One canonical wire format. Variety lives in builders, not parsers. `$schema` in the document is normal and expected. |
| **Kepler.gl** | A saved map is a JSON blob `{datasets, config, info}` with a `version`. `KeplerGlSchema` migrates old versions. | Effort went into **versioning**, not syntax. |
| **deck.gl** (`@deck.gl/json`) | JSON only, with string sigils resolved against a registry: `"@@type"`, `"@@function"`, `"@@="` expressions, `"@@#"` constants. | A data format can't carry functions, so a whitelisted registry is the escape hatch. It is format-independent and the same idea as `$html`. |
| **MapLibre style spec** | JSON only. Expressions are heterogeneous nested arrays. | Expressions map one-to-one onto JSON and YAML flow, and onto TOML inline arrays only with a TOML 1.0+ parser (§7). |
| **Observable Framework** | Config is JS/TS only (`observablehq.config.js`); page front matter is YAML. | Code config, not format plurality. |
| **Hugo** | `hugo.toml` / `.yaml` / `.json` (TOML first in precedence). Front matter in TOML, YAML or JSON. Docs show every snippet in three tabs. | Supporting several formats is feasible. The cost is documentation, forever. |
| **Astro** | `astro.config.*` is JS. Content collections accept JSON, YAML and TOML data (TOML through smol-toml; the `file()` loader treats each top-level table as an entry). Every format normalizes into one Zod schema. | **Normalize at the parse boundary and validate once.** This is the pattern §8 uses. Because of it, maplibre-yaml documents already work as TOML in collections. |
| **Docker Compose / Kubernetes** | YAML preferred, with JSON accepted "interchangeably" because YAML is a JSON superset. | **This is exactly maplibre-yaml's JSON position.** Say so in the docs and stop there. |
| **Netlify, Cargo, pyproject (PEP 518)** | TOML only. PEP 518 picked TOML over YAML (spec size, safety) and over JSON (no comments). | TOML suits flat tool configuration, not deeply nested documents. |
| **Prettier / cosmiconfig** | Prettier accepts JSON, YAML, JSON5, TOML and JS. cosmiconfig needs a custom loader for TOML. | Multi-format config is mostly a *config-file* phenomenon, not a *document* phenomenon. |
| **ESLint** | Moved from `.eslintrc.{json,yaml,yml,js}` to `eslint.config.js` only (v9 default, eslintrc removed in v10, Feb 2026). | Format plurality was walked back to cut maintenance. |
| **Taplo / Even Better TOML** | A `#:schema <url>` directive (in a comment, top of file, one per file) or `toml.schema.associations`. | TOML editor support reuses the JSON Schema with no file pollution. |
| **VS Code JSON** | An in-file `$schema` key, or `json.schemas` `fileMatch` settings. VS Code's docs note that `$schema` is VS Code behaviour, not part of the JSON Schema spec, and that it changes the data. | Accept and strip `$schema` (§4.2). Document `json.schemas` too. |
| **TOML itself** | No null. toml-lang/toml#30 settled on "leave it out". TOML 1.1.0 (released 2025-12-18) allows newlines and trailing commas in inline tables. | 1.1 helps expression-heavy layers. smol-toml, toml and toml-eslint-parser support it; @iarna and j-toml do not. Null will never come. |

Sources: vega.github.io/vega-lite/docs/spec.html;
docs.kepler.gl (saving and loading with schema);
deck.gl/docs/api-reference/json; maplibre.org/maplibre-style-spec/expressions;
observablehq.com/framework/config; gohugo.io/configuration/introduction;
docs.astro.build (content collections, content loader reference);
docs.docker.com/compose; kubernetes.io (configuration overview);
peps.python.org/pep-0518; prettier.io/docs/configuration;
eslint.org/blog/2023/10/flat-config-rollout-plans;
taplo.tamasfe.dev/configuration/directives;
code.visualstudio.com/docs/languages/json;
github.com/toml-lang/toml/issues/30 and its CHANGELOG;
hitchdev.com/strictyaml/why-not/toml; nestedtext.readthedocs.io (alternatives).
Observable's history and Hugo maintainers' own view on fragmentation could not
be verified.

## 14. Recommendation and phasing

**Phase 0: quick wins that help YAML too (≈1.5 days).**
- ml-4cn.1: accept `$schema`.
- ml-4cn.2: inline `application/yaml` and `application/json` scripts. This is a
  bug fix.
- ml-4cn.7: the "this looks like TOML" hint.

**Phase 1: JSON becomes official (≈3.75 days).**
- ml-4cn.3: folder discovery by content sniffing.
- ml-4cn.4: format-aware errors, docs, llms.txt and the playground fixes.
- ml-4cn.5: `$html` docs.

**Phase 2: `mlym convert` YAML⇄JSON (≈2 days).**
- ml-4cn.6.

**Phase 3: TOML, parked (≈8–11 days).**
- ml-4cn.8, which depends on ml-4cn.3 and ml-4cn.6.
- **Un-park only when** a concrete adopter is blocked and convert has been
  offered and judged insufficient. When un-parked, use toml-eslint-parser with
  the value-path adapter from §8, behind a lazy chunk. Give TOML one docs page
  and no per-snippet tabs.

**For the user who asked.** JSON works today; say so and point at `$schema`
once Phase 0 lands. For TOML, the honest answer is:
- TOML can express nearly every document (§10), but deep nesting reads worse
  and null and anchors are missing;
- Astro collections already accept it, with weak errors;
- write it and convert it, or tell us it blocks you.

## 15. Effort

| # | Work | Bead | Packages | Effort |
|---|---|---|---|---|
| 0a | Top-level `$schema` (zod + emitted JSON Schema + test) | ml-4cn.1 | core | 0.5 d |
| 0b | Inline `application/yaml` and `application/json` scripts in both elements | ml-4cn.2 | core | 0.5 d |
| 0c | "Looks like TOML" hint (core text entry points + CLI extension) | ml-4cn.7 | core, cli | 0.5 d |
| 1a | Folder discovery sniff + no-documents message | ml-4cn.3 | cli | 1 d |
| 1b | JSON-aware syntax wording, JSONC hint | ml-4cn.4 | core (+astro) | 1 d |
| 1c | JSON docs section, editor setup, llms.txt | ml-4cn.4 | docs | 1 d |
| 1d | Playground: JSON story detection, assist guard, download as `.json` | ml-4cn.4 | docs | 0.5 d |
| 1e | `$html` structural marker docs | ml-4cn.5 | docs | 0.25 d |
| 2 | `mlym convert` YAML⇄JSON with loss report | ml-4cn.6 | cli | 1.5–2 d |
| | **JSON total (0a, 0b, 1a–2)** | | | **≈6.25–6.75 d** (≈4.75 d without convert) |
| 3a | TOML adapter: parser, datetime coercion, positions by path, hints (`#`, null, dotted keys), category order | ml-4cn.8 | core | 3–4 d |
| 3b | TOML plumbing: CLI, Astro, browser lazy chunk + `application/toml` | ml-4cn.8 | core, cli, astro | 2–3 d |
| 3c | TOML docs page, playground toggle, fixtures for every check, llms.txt | ml-4cn.8 | docs, tests | 2–3 d |
| 3d | `mlym convert --to toml` / from TOML | ml-4cn.6 / .8 | cli | 1 d |
| | **TOML total** | | | **≈8–11 d**, plus ongoing upkeep |

**Risks.**
- **JSON:** low. A content sniff could skip a JSON document whose `type` is
  misspelled. That is mitigated by explicit file arguments always validating.
- **TOML:**
  - silent dotted-key nesting;
  - ordering bugs in array-of-table documents;
  - fragmented examples and support;
  - an async parse path in the browser;
  - one more dependency to watch, since TOML 1.1 support is young in
    toml-eslint-parser.

## 16. Open questions

1. **Ship JSON as "official" in the next minor?** That means documenting it and
   committing to keep it working. It is already true in practice.
2. **Where does JSON documentation live?** A section in
   `guides/parsing-and-validating.mdx`, or a short `guides/json.mdx`? Either
   way, no per-snippet JSON tabs.
3. **Should the folder sniff apply to YAML too?** That would quietly skip
   `ci.yml`, `docker-compose.yml` and similar. The cost: a YAML document whose
   `type:` line was deleted has a dedicated error today (ml-aot.62). The sniff
   would have to keep it, by sniffing on `chapters`, `config` or `layers` too.
4. **Should `$schema` be stripped or preserved** in `result.data`? The
   proposal is to strip it, so it never reaches the renderer or emit.
5. **Should convert's YAML output be opinionated** (flow-style expressions, a
   modeline) or a plain `yaml.stringify`?
6. **TOML `locale` keys:** a hint ("quote dotted keys") or flatten nested tables
   under `locale` automatically? Locale values must be strings, so a nested
   table is never valid there and flattening is safe, but it is magic.
7. **TOML parser:** toml-eslint-parser (exact positions, 10 KB) or smol-toml
   plus scanner (about 6.5 KB, line-accurate except multi-line arrays)?
8. **What counts as "demand" for un-parking TOML?** For example: one adopter,
   or N requests on GitHub.

## 17. Evidence and reproduction

All prototypes lived in a scratch folder outside the repo and are **not**
committed. To reproduce:

- **Parser sizes.** `npm i smol-toml toml @iarna/toml @ltd/j-toml
  toml-eslint-parser yaml esbuild`. For each parser, a one-line entry that
  imports `parse` (and `getStaticTOMLValue` for toml-eslint-parser), run
  through `esbuild --bundle --minify --format=esm --platform=browser`, then
  `gzip -9 | wc -c`.
- **Compliance.** Eight MapLibre-shaped cases (heterogeneous arrays in `get`,
  `interpolate`, `match` and `case` with an inline table; a TOML 1.1 multi-line
  inline table; dotted and quoted keys; datetime; int and float) plus the four
  §10 documents, run through each parser.
- **Corpus.** Every `examples/**/*.yaml`, and every fenced `yaml` block in
  `docs/src/content/docs/**/*.mdx`, that parses to a map, story or root
  document: 237 in total. Each was converted with `smol-toml.stringify` and
  scanned for nulls, anchors, merge keys, `!html`, date-like strings and keys
  needing quotes.
- **Positions.** Two indexes: (a) toml-eslint-parser AST and (b) a line
  scanner. Each path of every parsed value was looked up with an
  ancestor-fallback rule identical to `positionForPath`.
- **End to end.** smol-toml, then datetime coercion, then
  `YAMLParser.safeParseMapBlockValue` / `safeParseScrollytellingBlockValue`,
  then positions re-attached by path.
- **Browser.** Playwright against `VERIFY_PORT=5101 node e2e/server.mjs`, with
  scratch pages for:
  - `<ml-map src=.json>`;
  - inline `application/json`, `application/yaml`, and JSON inside
    `text/yaml`;
  - the `config` attribute;
  - `<ml-scrollytelling src=.json>` and inline JSON;
  - `<ml-map src=.toml>`.
- **Astro.** A temporary `maps` collection (`glob` over
  `**/*.{json,toml,yaml}` with `getMapSchema()`) and a page in
  `examples/astro/minimal`, built with `astro build`, then fully reverted.
- **Editor.** `vscode-json-languageservice` `doValidation` against
  `packages/core/schemas/map.schema.json`, for a document with `$schema` and a
  document with `{"$html"}`.

Vault context: `concepts/agent-driven-map-publishing.md` (agents and APIs
emitting map documents, which is why JSON matters). No prior decision on
document formats was found in `~/vault/index.md`.
