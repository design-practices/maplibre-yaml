---
title: Docs playground — edit YAML, see the map live, share and download (design)
type: design
date: 2026-10-22
topic: docs-playground
beads: ml-vjs.17 (this spike; parent epic ml-vjs)
target: docs site, after 0.9 (no package release needed for the MVP)
status: accepted 2026-10-22 — maintainer answered §12; MVP in progress
---

# Docs playground — design

**Goal (bead ml-vjs.17, maintainer direction 2026-10-22):** a `/playground/` page on
the docs site where a newcomer — a student, or a general user who has never
installed anything — edits a map document and watches the map change as they
type. Mistakes are explained where they are made. A map can be shared as a
link and taken home as a folder that works. The site stays static (Cloudflare
Pages, no backend), and pages other than `/playground/` pay nothing for it.

This document holds the decisions, the evidence behind them, and the open
questions. It contains no production code. The measurements come from a
scratch bench and a throwaway prototype outside the repo, described in
[§11](#11-prototype-and-bench-evidence). The prototype runs at
`http://100.77.90.49:4544/playground/` (tailnet only).

---

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Editor: CodeMirror 6** (`@codemirror/view`/`state`/`language`/`commands`/`autocomplete`/`lint` + `@codemirror/lang-yaml`), **128 KB gzip** as a lazy chunk. Monaco + monaco-yaml is rejected: 794 KB gzip of editor and CSS plus 385 KB of workers, about 3× slower to start on a phone profile, officially unsupported on mobile browsers, and `monaco-yaml` 5.5.1 only worked with `monaco-editor` ≤ 0.52 in this spike. A plain `<textarea>` with an overlay is rejected as the primary editor, because it has no completion and keyboard handling would have to be rebuilt by hand. An optional "plain text" mode was proposed (Q3) and **skipped for now** by the maintainer. |
| D2 | **Schema help comes from a small in-house module, about 4 KB, that reads the published JSON Schema** (`/schema/latest/map.schema.json`, 14 KB gzip; `scrollytelling.schema.json` for stories). It provides key and value completion with descriptions, plus hover. It works out the YAML path from indentation, so it keeps working while the document is half-typed and won't parse, and it narrows layer unions by the sibling `type:`. `codemirror-json-schema` is rejected: 291 KB gzip because it pulls in shiki and markdown-it, its last release was 2025-04, and it lints the schema itself. `yaml-language-server` in a worker is rejected: 303 KB gzip, and it is a second validator. |
| D3 | **Diagnostics have one source of truth: core's `YAMLParser.safeParseAny`.** Errors and warnings keep their line/column, and "did you mean" becomes a one-tap quick fix. Schema help never lints, so nothing is reported twice. Problems the editor can see stay in the editor. Problems only the running map can see (data that didn't load, CORS, a layer MapLibre rejected) stay in the map's own notice. The playground does not set `debug`, so the notice never repeats the editor's author hints. |
| D4 | **Live preview reuses `<ml-map>`.** It re-renders 400 ms after typing stops, by assigning the document *as written* (raw YAML parsed to JS) to `el.config`, so the element validates it exactly as it would a `src=` file. A document with errors is **not** handed to the map: the last good map stays up with a "Showing your last working map" pill. **The camera is kept across edits** unless the edit changed `center`/`zoom`/`bearing`/`pitch`/`bounds`/`fitTo`. **Story files render in `<ml-scrollytelling>`** in the same pane. On phones, stories open a full-height preview. |
| D5 | **Starters come from the existing sources and are not copied.** A build-time manifest is generated from `docs/src/data/gallery.mjs` (the 83 `kind: "yaml"` gallery entries, each with its `public/configs/gallery/<slug>.yaml`) plus a short curated "Start here" list (the getting-started earthquake map, inline GeoJSON, classify + legend, a story). The playground loads a starter through `?src=/configs/…`, so a starter is always the file the docs page renders. A docs test checks the manifest against `gallery.mjs`. |
| D6 | **Share links put the document in the URL fragment:** `#code/<lz-string compressToEncodedURIComponent>`. The fragment never reaches the server or its logs. The measured starters encode to 665–1,279 characters. Over 2,000 characters the playground warns that some chat apps cut long links. Over 32,000 it refuses and points to Download. **Shared documents run untrusted, as everything in `<ml-map>` does:** `!html` renders as text and `click.emit` is dropped. This was confirmed in code and in the prototype. The playground adds an info note on `!html`/`emit` lines saying so, and a banner that lists the hosts the shared map will fetch from. |
| D7 | **Take it home with Download:** a zip built in the browser with `fflate` (4.4 KB gzip, loaded on click), containing `my-map/index.html`, `my-map/map.yaml` and `README.txt`. `index.html` is the quick-start page. It comes from a template under `docs/src`, so `scripts/sync-cdn-pins.mjs` keeps its `@maplibre-yaml/core@0.9` pin on the current minor. Site-relative data paths are rewritten to absolute docs URLs, which already send `Access-Control-Allow-Origin: *`. The README says how to serve the folder, because a `file://` page cannot start the map's worker (core already shows a card for that). **"Open in StackBlitz" is not planned for now (Q2).** |
| D8 | **"Try it" entry points.** MVP: the gallery footer (`GalleryFooter.astro`) and `LiveMap.astro` link to `/playground/?src=<their config>`. Phase 2: an Expressive Code / rehype step adds "Try it" to fenced ` ```yaml ` blocks that `validate-doc-snippets.mjs` already classifies as whole documents or wrappable fragments. It reuses that classifier and its placeholder wrapper. ` ```yaml no-validate ` fences get no link. |
| D9 | **Data files.** Remote URLs work when the host allows CORS, and the map's notice already explains a CORS failure. Inline GeoJSON works and compresses about 3.4:1 in a link. The preview sets `base="/"`, so `/data/…` and `data/…` resolve to the docs site's `public/` as they do in the starters. Phase 2 adds dropping a local file: it is listed as `./data/<name>` in the YAML and mapped to a `blob:` URL only at render time. A share link warns that it can't carry the file, and Download puts it in the zip. |
| D10 | **Bundle discipline.** Editor dependencies go in `docs/package.json` only, and nothing is added to `packages/*`. The editor is a dynamic import from the playground page's own script. A docs test fails the build if a page other than `/playground/` references a chunk that contains CodeMirror, and it holds the editor chunk to ≤ 140 KB gzip. In the docs build, the parser the playground imports is the same core `dist` chunk `<ml-map>` already loads, so diagnostics cost about 0 KB extra. |
| D11 | **Map-party: nothing to share today. Align on two patterns.** Map-party's editor is a React + Yjs Monaco wrapper with no diagnostics, no schema help and no share links, and it is not mounted on phones ([§9](#9-map-party-overlap)). We adopt its parse-and-debounce shape and its keep-the-camera-on-`config`-swap trick. The schema-help and diagnostics adapters are written framework-free, so map-party could adopt them later (Q6). |
| D12 | **Phasing.** The MVP is the editor, live map, diagnostics with quick fixes, starters, share, download, and gallery/LiveMap "Open in playground". Estimate: **about 11 working days**. Phase 2 is snippet "Try it", local file drop, a maplibre-free parser entry in core (Q5), and the screen-reader / real-phone pass if the MVP doesn't finish it. StackBlitz (Q2) and the plain-text mode (Q3) are not planned for now. Phase 3 is multi-file documents. See [§10](#10-phasing-and-effort). |

---

## 1. Context and constraints

- **History.** `docs/plans/docs-positioning-and-examples.md` calls a playground "the natural
  'student' on-ramp but … real infrastructure". The 2026-07-07 roadmap brainstorm
  (`docs/brainstorms/2026-07-07-quality-adoption-roadmap-requirements.md`, "Playground over
  VS Code extension as the adoption lever"; R13) routed it to the Phase 3 docs plan. The vault
  has **no recorded decision about a playground or editor choice** (`~/vault/index.md`,
  checked 2026-10-22). The trust model this design relies on is
  `decisions/2026-08-08-maplibre-yaml-v050-arc-complete-eject-guarantee.md`: structured popup
  content by default, raw markup only via an explicit `!html` tag under a default-deny policy.
- **Existing docs components.** `LiveMap.astro` (`<ml-map src>` + the maplibre-gl 6 worker
  shim), `YAMLBlock.astro`, `ConfigPreview.astro`. `YAMLEditor.astro` exists but is a
  read-only `<pre>` with a copy button that nothing imports. The playground replaces nothing
  and deletes that dead file.
- **Static hosting.** Cloudflare Pages, no functions. Every feature here runs in the browser.
  The schemas and `/data/` already go out with `Access-Control-Allow-Origin: *` (checked on
  `docs.maplibre-yaml.org`).
- **Audience.** Newcomers and students first. In practice this means the phone layout is
  first-class, messages are the parser's plain-language ones, and a broken document never
  blanks the map.

---

## 2. D1 — Editor choice

### 2.1 What was compared

Each candidate was built as the same lazy chunk. A host page dynamic-imports
the editor and the published schema, mounts the earthquake document (with one
deliberate `circle-colour` typo), then imports the diagnostics module and shows
its result. Builds use esbuild with minify and splitting. Sizes are `gzip -9`
of the chunks that only the editor import pulls in.

| Candidate | Editor chunk gz | Extra (CSS/fonts, workers) gz | Schema completion | Notes |
|---|---|---|---|---|
| Textarea + highlight overlay + problem list | **1.2 KB** | — | none (would be hand-built) | native a11y; no completion, no lint gutter, Tab handled by hand |
| **CodeMirror 6 + lang-yaml + lint + autocomplete + in-house schema help** | **128.4 KB** (br 110.2) | — | yes (keys, enum/const/boolean values, descriptions, hover) | chosen |
| CodeMirror 6 + `codemirror-json-schema/yaml` | 290.9 KB (br 247.9) | — | yes (keys only in our test: `pi` → `pitch`) | pulls shiki (193 KB raw of grammars), markdown-it, json-schema-library, json5; schema lint duplicates core |
| Monaco 0.52.2 (editor API + suggest/hover/codeAction/gotoError/folding contributions) + monaco-yaml 5.5.1 | 721.9 KB (br 580.0) | 71.6 KB CSS/codicon font; workers: editor 82.0 KB + yaml 303.2 KB | yes | **monaco-yaml failed with monaco-editor 0.54, 0.55.1 and 0.57** (worker never starts: `createWebWorker` changed under `monaco-worker-manager` 2.0.1, last published 2022) |
| Monaco 0.57 full `monaco-editor` entry | 1,052.3 KB | 140.4 KB CSS/font | (broken, see above) | for scale |
| Diagnostics: core `YAMLParser` bundled on its own from npm 0.9.1 | 111.9 KB | — | — | **in the docs build this is the same chunk `<ml-map>` already loads** |

The in-house schema helper is about 4 KB raw. It resolves `$ref` (257 internal
pointers in `map.schema.json`), flattens `anyOf` (475 of them), and narrows the
10 layer branches by the sibling `type:` value. In the prototype, `paint:` under
a `type: circle` layer offers `circle-radius`, `circle-color`, …, and under
`type: line` it offers `line-*`.

### 2.2 Time to interactive on a phone profile

Profile: Playwright Chromium, 390×844 at DPR 3, touch, **4× CPU throttle, 150 ms RTT,
1.6 Mbit/s down** (the Lighthouse mobile preset), cache disabled. Each figure is the
median of 3 runs. The bench page has the editor only, with no map. Times are from
navigation start.

| Candidate | Editor usable | First diagnostics shown | TTI (last long task) | Total blocking time | Transfer | Keystroke → doc change |
|---|---|---|---|---|---|---|
| Textarea | 678 ms | 1,663 ms | 1,663 ms | 61 ms | 131 KB | 3 ms |
| **CodeMirror 6** | **1,556 ms** | **2,560 ms** | **2,560 ms** | **187 ms** | **259 KB** | **9 ms** |
| CM6 + codemirror-json-schema | 2,543 ms | 3,757 ms | 3,756 ms | 702 ms | 416 KB | 9 ms |
| Monaco 0.52 + monaco-yaml | 4,922 ms | 6,411 ms | 6,411 ms | 563 ms | 963 KB* | 4 ms |

\* This excludes the 303 KB yaml worker, which Monaco only fetches on the first completion
request. A Monaco user therefore waits again on the first completion.

"First diagnostics" includes downloading and running the 112 KB standalone
parser. In the docs build that chunk is already shared with the map, so the gap
between "editor usable" and "diagnostics" shrinks to the parse itself: 1–3 ms
per parse for these documents in Node, and about 20 ms for the first, cold
parse.

**The real page, measured as well.** The prototype is the full page: map,
editor, `register.js` from unpkg, and USGS data. On the same phone profile the
editor was visible at **≈ 5.0 s** and the map loaded at **≈ 14.0 s**. The plain
quick-start page (the same map, no editor) loaded its map at **≈ 14.8 s**. So the
editor adds no measurable delay to the first map: its chunk loads alongside
maplibre-gl, tiles and data. The 5 s for the editor is inflated because the
prototype's bundled parser imports core's root entry, which imports
`maplibre-gl`, so the editor waits for maplibre to download. The production page
mounts the editor from a chunk with no maplibre dependency (Q5 / Phase 2 core
entry).

### 2.3 Mobile and touch (390×844)

Checked in Playwright with touch emulation, and on screenshots
(`~/crosshatch-proto/playground/`):

- **Tap to focus:** works on all three. CM6 focuses its `contenteditable`
  (`role=textbox`, `aria-multiline=true`). Monaco focuses its hidden textarea.
- **Typing through the IME path** (`Input.insertText`, which is how a virtual keyboard
  delivers text): works on all three.
- **Touch scrolling:** native for CM6 and the textarea (a raw touch drag scrolled
  them 286 px and 271 px). Monaco draws its own scrollbars and runs its own touch handling.
- **Completion on a phone:** CM6's popup fits at 390 px. Its info box
  overlapped the list in one screenshot; the fix is to place it below the list
  on narrow screens.
- **Monaco's own README**, under "Is the editor supported in mobile browsers or
  mobile web app frameworks?", answers "**No.**" Map-party agrees in practice: it doesn't
  mount its Monaco YAML editor on phones at all ([§9](#9-map-party-overlap)).
- **Font size 16 px on phones,** so iOS Safari does not zoom the page when the
  editor takes focus. Tap targets are ≥ 40 px.
- **What a headless run can't show:** real virtual-keyboard behaviour,
  autocorrect and autocapitalize, and selection handles. That is what the
  prototype URL is for. A real-phone pass (iOS Safari, Android Chrome) is in
  the MVP's definition of done.

### 2.4 Accessibility (screen reader, keyboard)

- **CM6:** `contenteditable` with `role=textbox`, `aria-multiline`, and our
  `aria-label` ("Map document (YAML)"). Completion is a listbox driven by
  `aria-activedescendant`. CM6 keeps a polite live region (`.cm-announced`). Diagnostics
  open in a keyboard-navigable panel (`Ctrl/Cmd-Shift-M`, `F8` for the next
  problem).
  - **Tab** indents, which YAML needs (`indentWithTab`). CM6's documented
    escape hatch is **Escape then Tab**, which moves focus out; the spike
    verified that focus leaves the editor. The page states this in a visible
    hint.
- **Monaco:** a hidden textarea with `role=textbox`. Tab is trapped until
  `Ctrl+M` toggles tab-focus mode (verified). It has a good screen-reader help
  dialog, but the mobile caveat still applies.
- **Textarea:** native, and the best baseline for screen readers, but nothing
  else.
- **Not done in this spike:** a manual NVDA/VoiceOver pass. Headless Chromium can
  check roles, names and focus, but not speech. The MVP includes one pass with
  VoiceOver on iOS and NVDA on Windows (moved to Phase 2 if the MVP can't do it).
  A plain-textarea mode for people who prefer it was proposed as Q3 and skipped
  for now.
- **Page-level:** the status line is `aria-live="polite"` ("Map updated · 1
  warning"). State is never shown by colour alone: there is a dot, then text.
  The map pane and the code pane are labelled regions.

### 2.5 Why CodeMirror 6

It is the only option that is fast on a phone, works with touch and virtual
keyboards, and gives schema completion and positioned diagnostics, at a size a
docs page can afford. Monaco gives the most IDE, but it costs about 6× the
bytes (9× counting its workers) and about 3× the start-up time, it isn't supported on phones, and its
YAML plugin is currently stuck on an old Monaco. The textarea is the right
baseline for screen readers and the wrong one for students who don't yet know
what keys exist.

---

## 3. D2/D3 — Diagnostics and schema help, without double-reporting

### 3.1 Who reports what

| Kind of problem | Found by | Shown in | Example |
|---|---|---|---|
| YAML syntax | `YAMLParser` (positioned `yaml-syntax` error) | editor (squiggle + gutter + status) | `Flow sequence … must end with a ]` at 5:3 |
| Schema/semantic error | `YAMLParser` errors | editor | `Unknown layer type "circel" … Did you mean "circle"?` |
| Advisory (unknown key, deprecation, swapped center, `=` prefix) | `YAMLParser` warnings (`kind`: deprecation/unimplemented/note) | editor (warning/info) | `Unknown key "circle-colour". Did you mean "circle-color"?` |
| Runtime: data didn't load, CORS, MapLibre rejected a layer, image missing | the running map | **map notice only** (`<ml-map>`'s 0.8 notice). The status line adds "1 problem on the map" from `ml-map:layer-data-error` / `ml-map:error`, without copying the text | `Part of this map didn't load` |
| Completion and hover | in-house schema helper | editor popups | `pitch — Camera pitch angle in degrees (0-85)` |

Rules that keep it single-sourced:

1. **The schema helper never produces diagnostics.** It reads the schema only for
   completion and hover. (Both rejected alternatives lint against the schema
   too, so they would need that switched off.)
2. **The playground never sets `debug` on `<ml-map>`.** Author hints show on the
   map only on `localhost` or with `debug`, and the editor already shows them,
   so the map stays clean on the docs site.
3. **An invalid document is never given to the map.** If it were, a typo would
   replace the map with an error card on every pause. The last good map stays,
   with a pill saying so, and the status line says how many errors there are.
   This departs from the bead's "editor diagnostics plus the map's own notice"
   on purpose: the notice is kept for what only the map can know.
4. **Quiet while typing.** In the prototype, a syntax error flashed on the line
   being typed (`pi` with no colon yet). The production rule: a `yaml-syntax`
   error on the line holding the cursor is held until 1.2 s of idle or until
   the cursor leaves the line. Errors on other lines show at once.

### 3.2 Mapping parser results to editor ranges

`ParseError`/`ValidationWarning` carry `line`, `column`, `path`, `message` and
`suggestion`. The adapter (about 40 lines):

- **Offset:** line/column becomes an offset, and the range covers the token
  there (the key, or the scalar).
- **Moving the range onto the value:** when a message quotes a value but is
  positioned on the enclosing object (`Unknown layer type "circel"` points at
  the layer's `- id:` line), the range moves to the quoted value if it appears
  within 30 lines. The quick fix then replaces the right token. The prototype
  does this. A cleaner fix is to position that error at `type:` in core
  (Phase 2 bead, core patch).
- **Quick fix:** `suggestion` plus "did you mean" becomes a lint action,
  "Change to `zoom`". On a phone it is a tappable button in the diagnostic
  tooltip/panel (screenshot `phone-3-diagnostics.png`).
- **No position:** errors without a line attach to line 1, which is how core
  already reports a missing `id:`.
- **`!html` and `emit`:** an extra **info** diagnostic, made by the playground
  rather than the parser, so it is never a duplicate: "Shown as text on
  `<ml-map>` (untrusted)" / "Does nothing on `<ml-map>`; use
  `ml-map:layer-click`". These are teaching notes that link to the
  popups guide.

### 3.3 Which schema

The playground picks the schema from the top-level `type:`:
`scrollytelling.schema.json` for `type: scrollytelling`, otherwise
`map.schema.json`. They are fetched from the same origin, `/schema/latest/…`,
which `generate-agent-assets.mjs` regenerates on every build. So completion can
never drift from the validator that ships with the site.

---

## 4. D4 — Live preview

**Pipeline.** An edit starts a 400 ms debounce, then `safeParseAny` runs once.
Its diagnostics are set on the editor. If there are no errors and the text
changed, the raw YAML is parsed with core's `YAML_PARSE_OPTIONS` (so `!html` is
still a tag), the camera is injected where it should be, and the result is
assigned to `el.config`. The element re-validates and renders. A
JSON-equal document is a no-op inside the element.

**The camera.** Before the swap the pipeline reads `getCenter/Zoom/Bearing/Pitch`
from `el.getMap()`. It writes them into the new document's `config` and drops
`bounds`/`fitTo`, **unless** the edit itself changed any of `center`, `zoom`,
`bearing`, `pitch`, `bounds` or `fitTo`. In that case the author is editing the
view, and the new view wins. Loading a starter or a share link resets it. The
prototype verified this: the camera was panned to Tokyo, a paint colour was
edited, and after the re-render the camera was still at `139.70, 35.70, z4`
(desktop and phone). This is the same idea as map-party's design-site
`PaletteMap.astro`.

**Re-render cost.** A `config` swap rebuilds the map: the style reloads and the
basemap flashes briefly. That is acceptable for the MVP. Map-party patches
sources and layers in place instead of rebuilding (`MapPreview.tsx`), but it
does so with `MapRenderer`, at the cost of the element's validation and notice.
Diff-and-patch inside `<ml-map>` is a separate core feature, not a playground
one, so it is not in scope here.

**Stories.** A `type: scrollytelling` document renders in `<ml-scrollytelling>`
in the preview pane. The spike checked that a story inside an `overflow:auto`
pane renders and advances chapters as the pane scrolls on desktop (the
gallery's Sherlock story moved from chapter 1 to chapter 6, Caulfield
Gardens, after six scrolls of the pane) (the
observer uses the viewport as its root, and that still works inside a scrolled
pane). On phones the pane is too short for the observer's band (`-40%` root
margin), so stories open a full-height "Preview" view with a "Back to code"
button. Camera keeping doesn't apply to stories: a story's camera belongs to
its chapters.

**Isolation.** We considered an `<iframe srcdoc>` preview, the exact page that
Download produces. It was not chosen as the default: it makes camera keeping a
`postMessage` protocol, and it reloads maplibre on every change. `<ml-map>` is
already untrusted by default ([§5](#5-d6--share-links-and-trust)), so the iframe
would buy no extra safety for what a document can express.

---

## 5. D6 — Share links and trust

**Format.** `/playground/#code/<payload>`, where the payload is lz-string's
`compressToEncodedURIComponent` (1.7 KB gzip, already in the editor chunk). A
format-version prefix (`code/`) leaves room for `#code2/…` later. The fragment
is never sent to Cloudflare, so shared maps don't show up in any server log,
and there's nothing to store or expire.

**Sizes measured** (length of the encoded payload):

| Document | YAML chars | Encoded |
|---|---|---|
| getting-started earthquakes | 806 | 665 |
| cities, inline GeoJSON | 2,068 | 1,279 |
| classify + legend | 1,076 | 904 |
| largest gallery doc (story, 5.6 KB) | 5,569 | 4,217 |
| 24 KB GeoJSON pasted inline | 24,015 | 6,963 |

**Limits.**
- **≤ 2,000 characters:** a plain "Link copied".
- **2,000–32,000:** copies the link, with a note that some chat apps, email
  clients and QR codes cut links this long.
- **> 32,000:** no link. The playground offers Download, or "Copy YAML" to paste
  elsewhere. Browsers accept far longer fragments; the limit is for the places
  people paste links.
- **`?src=`:** for any same-origin config. It only accepts paths starting with
  `/configs/`, and it gives short, stable links to every docs map.

**Trust.** Confirmed in three ways:
- **In code:** `<ml-map>` passes no capability policy to `MapRenderer`, so popups,
  markers and interactions fall back to
  `DEFAULT_POLICY = { trust: "untrusted" }`. `allowsHtml` is false and
  `allowsHostHook` is false.
- **In the docs:** "A layer's `click.emit` interaction does nothing under
  `<ml-map>`" (`reference/elements.mdx`).
- **In the prototype:** a share link whose popup holds
  `str: !html "<b id='pwn'>…"`, plus a feature property
  `<img src=x onerror=…>`. After a click the popup's HTML was escaped text,
  no `#pwn` element existed, and the `onerror` never ran.

The playground therefore adds no trust machinery of its own, and must **never**
pass a trusted policy, even for its own starters, so one code path runs
everything.

What a shared document can still do is make the viewer's browser **fetch URLs**:
data sources, `mapStyle`, images. That is the same exposure as clicking any
link, but it should be visible. The "Opened from a share link" banner lists the
hosts the document will contact (for example `earthquake.usgs.gov,
tiles.openfreemap.org`). The map still runs automatically; this is shown for
information, not as a gate (Q4).

---

## 6. D7 — Take it home

- **Download zip** (MVP). `fflate.zipSync` is about 4.4 KB gzip and loads on
  click. The zip holds:
  - `my-map/index.html`: the quick-start page, from a template file under
    `docs/src/` so that `sync-cdn-pins.mjs` (whose roots include `docs/src`)
    keeps `@maplibre-yaml/core@<minor>` current, with a `--check` guard in CI.
    The `maplibre-gl@6` pin matches the quick start's own. Stories get the
    story template (the extra `scrollytelling.css` link).
  - `my-map/map.yaml`, after URL rewriting: site-relative paths (`/data/…`,
    `/configs/…`) become `https://docs.maplibre-yaml.org/…`, which already
    sends `ACAO: *`. In Phase 2, a dropped local file goes in the zip as
    `data/<name>` and its path stays relative.
  - `README.txt`: three lines on serving the folder (`npx serve .` or
    `python3 -m http.server`). Opening it from a double-click (`file://`)
    doesn't start the map's worker, and core already shows a card explaining
    that. Both paths are covered by the quick start.

  The prototype implements this.
- **Open in StackBlitz** (not planned for now — Q2 answered "skip until someone asks").
  - **How it works:** `@stackblitz/sdk` 1.11.1 is 5.4 KB gzip. `openProject`
    submits a hidden form with `POST` to stackblitz.com (verified in the SDK
    bundle), so there is no backend on our side.
  - **Template:** either `'html'` (EngineBlock; needs `index.html`; text files
    only) for the plain page, or `'node'` (WebContainers) for an Astro project
    using `@maplibre-yaml/astro`.
  - **Terms:** StackBlitz says the WebContainer API is free for open-source and
    personal use, and that *embedding* WebContainers in a commercial product
    needs a licence. We would only link out to stackblitz.com, as many open-source
    docs do; the Terms of Service apply to the user's session there.
  - **Value:** low for students on phones, since WebContainers is heavy there.
    It suits an "Astro users" entry on desktop. Q2 asked whether it is worth
    building at all; the answer was not for now.

---

## 7. D8 — "Try it" entry points

| Where | MVP? | How | Component change |
|---|---|---|---|
| Gallery pages, `kind: "yaml"` (83 entries, all with a config file) | yes | "Open in the playground" link → `/playground/?src=/configs/gallery/<slug>.yaml` | `GalleryFooter.astro`: one link inside "Use this map", shown only for `kind === "yaml"` (the 25 `yaml-js` entries need their page JS) |
| Any `<LiveMap src="/configs/…">` (first-map, guides) | yes | small "Edit in playground" link under the figure | `LiveMap.astro`: optional `playground` prop, default on when `src` starts with `/configs/` and there is no `chrome` |
| Fenced ` ```yaml ` snippets in guides | Phase 2 | "Try it" link → `#code/<payload>`, computed at build time | Extract the document/fragment classifier and the placeholder wrapper from `scripts/validate-doc-snippets.mjs` into a shared module. A Starlight Expressive Code plugin (or a rehype step next to `rehype-heading-anchors.mjs`) uses it to add the link. Fragments are wrapped exactly as the validator wraps them, so every "Try it" is a document CI has already validated. `no-validate` fences get nothing. |

---

## 8. D9/D10 — Data files and bundle discipline

**Data.**
- **Remote URLs** are fetched by the reader's browser, so CORS decides. USGS,
  `docs.maplibre-yaml.org/data`, GitHub raw and most tile hosts allow it;
  many government portals do not. Core's notice already explains a blocked
  fetch, and the playground links that message to `/guides/data-sources/`.
- **Inline GeoJSON** works unchanged (the "cities" starter).
- **Relative paths:** the preview `<ml-map>` gets `base="/"`, so starters
  copied from `public/configs` resolve exactly as they do on their docs pages.
- **Local files** (Phase 2): the file is dropped or picked, the document gains
  `url: ./data/<name>`, and the render step replaces that path with a
  `URL.createObjectURL` blob. Core leaves `blob:` URLs alone; per the `base`
  docs, full URLs are never changed. The YAML never contains a `blob:` URL that
  would die with the tab. Large files get the cloud-native size guidance
  (`load: viewport` for `.fgb`).

**Bundle discipline.**
- **Dependencies:** `@codemirror/*`, `@lezer/*` (transitively), `lz-string`
  and `fflate` go in `docs/package.json`. `packages/core`, `packages/astro` and
  `packages/cli` get nothing, and **the MVP needs no changeset**.
- **Page:** `docs/src/pages/playground.astro` uses Starlight's `StarlightPage`
  for the header and theme, with a full-width layout. Its `<script>` does
  `await import('../playground/editor.ts')`, so Vite emits the editor as its
  own chunk, referenced only from this page.
- **Guard:** a `docs/test/playground-bundle.test.mjs` (in the existing
  `node --test` list) walks `dist/**/index.html`. It fails if any page other
  than `/playground/` loads a chunk containing CodeMirror's marker class names,
  or if the editor chunk exceeds 140 KB gzip.
- **Parser sharing:** the playground imports `YAMLParser` from
  `@maplibre-yaml/core` and `<ml-map>` from `@maplibre-yaml/core/register`.
  Both resolve to the same `dist/shared/*` chunks, which Vite emits once.

---

## 9. Map-party overlap

Read-only survey of `~/dev/map-party` (2026-10-22):

| Question | Finding |
|---|---|
| Editor library | Monaco through `@monaco-editor/react` 4.6.0 + `y-monaco` (Yjs co-editing), `packages/ui` only. `monaco-editor` is pinned to 0.45.0, but nothing calls `loader.config`, so it really loads **0.55.1 from jsDelivr** at runtime. No CodeMirror, monaco-yaml or yaml-language-server anywhere. |
| YAML editor component | `packages/ui/src/components/editor/YamlEditor.tsx` (213 lines): Monaco's built-in YAML highlighting and word-based suggestions only. **No schema, no hover. Its `setValidationErrors` is dead code.** |
| Diagnostics | `stores/document.ts` calls `YAMLParser.safeParseMapBlock` (core 0.4.0) and **flattens errors to one string**, with no line/column. Parsing is debounced 150 ms, and the last good config is kept. Server side, it parses with `maxAliasCount: 100` and returns RFC 9457 problem+json with JSON pointers. |
| Preview | `MapPreview.tsx` drives `MapRenderer` directly and patches sources and layers in place. It rebuilds only when `mapStyle` changes. |
| Camera keeping | A persisted local viewport, plus `hasLocalViewportRef`, stops config edits from moving the camera. The Astro design site's `PaletteMap.astro` reads `getCenter/getZoom` before `setAttribute('config')`, which is the pattern adopted in D4. |
| Share, download, starters | Share links carry view state only (`?v=` camera, filters, `?fs=` hash fallback). There is no YAML in URLs and no client download. Starters are server-side `room_templates`. |
| Phones, a11y | **The YAML editor is not mounted on phones** (`RoomPage.tsx`). There is no editor-specific a11y work; an `overlay-escape` guard keeps Esc inside Monaco. |
| "Playground" mentions | none. `DEVELOPMENT_PHASES.md §11.4` sketches an embeddable `<YAMLEditor/>` + `<MapPreview/>` that was never built. |

**Conclusion.** There is no component worth sharing: React + Yjs + Monaco won't
fit on a static Starlight page, and it is missing everything this design needs
(schema help, positions, phones). We align on map-party's patterns: debounce,
keep the last good config, keep the camera on swap, and the guard against alias bombs. The playground's raw parse runs only
after `safeParseAny` has accepted the text, so core's fan-out merge guard and
`yaml`'s alias limit have already applied. The two pieces map-party
lacks are positioned diagnostics with quick fixes, and schema completion. The
playground builds both as framework-free modules (`schema-assist`,
`diagnostics-adapter`), each with a tiny editor binding, so map-party could
adopt them. Whether they later move to a shared package is Q6.

---

## 10. Phasing and effort

Effort is in focused working days for one developer, including tests. The
memory rule "browser tests as demos" applies: each unit ships a browser check
under `e2e/` that doubles as a runnable page.

### MVP — about 11 days

| Unit | Work | Est. |
|---|---|---|
| P1 | Page shell: `src/pages/playground.astro` (StarlightPage, full width), desktop split / phone stack, `Map ↕` toggle, theme tokens, sidebar/nav entry | 1 d |
| P2 | Editor island: CM6 setup, schema helper with unit tests over both schemas, hover, completion-info placement on narrow screens, Esc-Tab hint | 2 d |
| P3 | Diagnostics adapter: ranges, value refinement, quick fixes, quiet-while-typing, `!html`/`emit` info notes, status line + panel | 1 d |
| P4 | Preview pipeline: debounce, last-good, camera keeping, `base="/"`, story preview (desktop pane, phone full view), runtime-problem count from events | 1.5 d |
| P5 | Starters: build-time manifest from `gallery.mjs` + curated list, `?src=` loader, docs test (manifest ↔ gallery, every starter validates) | 1 d |
| P6 | Share: `#code/` encode/decode, limits and messages, shared banner with host list, `hashchange` | 0.5 d |
| P7 | Download: template under `docs/src` (pin-synced), URL rewriting, README, story variant | 1 d |
| P8 | Entry points: `GalleryFooter` + `LiveMap` links | 0.5 d |
| P9 | Guards and checks: bundle test (D10), e2e spec at 390×844 and 1280×800 (render, edit → re-render with camera kept, error keeps last map, share round-trip, `!html` inert), manual VoiceOver/NVDA and real-phone pass | 2.5 d |

### Phase 2 — about 5.5 days (after Q2/Q3)

| Unit | Work | Est. |
|---|---|---|
| P10 | Snippet "Try it": shared classifier module from `validate-doc-snippets.mjs`, Expressive Code/rehype plugin, test | 2 d |
| P11 | Local file drop/pick: virtual file table, blob mapping at render, share warning, zip inclusion, size guidance | 1.5 d |
| ~~P12~~ | ~~Open in StackBlitz~~ — not planned (Q2: skip until someone asks) | — |
| P13 | Core patch (changeset): a maplibre-free parser entry (for example `@maplibre-yaml/core/parser`), and position the "Unknown layer type" error at `type:` | 1 d |
| ~~P14~~ | ~~Plain-textarea mode~~ — skipped for now (Q3) | — |
| P15 | Polish from the real-phone pass | 1 d |

### Phase 3 (not estimated in detail)

- **Multi-file documents:** root `pages:` documents, `$ref` to other files, shared
  sources. These need a virtual file system and tabs. About 3–5 days.
- **In-place patching instead of a full rebuild:** a core feature, with its own
  bead if wanted.

---

## 11. Prototype and bench evidence

All of this is scratch, outside the repo and not in this PR.

- **Bench:** in the session scratchpad (`playground/bench/`, with `node_modules`
  under `~/.cache/xh-tmp/pg-spike`). `build.mjs` builds each candidate as a lazy
  chunk, `sizes.mjs` reports gzip/brotli from the esbuild metafile,
  `measure.mjs` runs the phone-profile timings, `a11y.mjs` and `scroll.mjs`
  run the touch and focus checks, and `func.mjs` runs the completion check.
- **Prototype:** `~/dev/classroom-check/preview090/checklist/playground/`, served at
  `http://100.77.90.49:4544/playground/`. It is one static page:
  - `@maplibre-yaml/core@0.9` `register.js` and `maplibre-gl@6` from unpkg;
  - a local esbuild bundle of CM6 + the schema helper + the diagnostics adapter
    (core 0.9.1's parser from npm) + lz-string + fflate.

  It has five starters (the getting-started earthquake map, inline-GeoJSON
  cities, world cities with classify + legend, a gallery polygon, and "find the
  mistakes"), live diagnostics with quick fixes, camera keeping, share links,
  and Download.
- **Verified at 390×844 and 1280×800 over that address** (Playwright,
  `verify.mjs`):
  - first render;
  - edit → re-render with the camera kept;
  - errors keep the last map;
  - completion `pi` → `pitch`;
  - a share link reopens the identical document with the shared banner;
  - `!html` is inert (`trust.mjs`).
- **Screenshots** in `~/crosshatch-proto/playground/`:
  - `desktop-*` and `phone-*`, numbered 1–5: earthquakes, recoloured with the
    camera kept, diagnostics, completion, the shared graduated map;
  - `desktop-6-shared-untrusted.png`;
  - `bench/` (each candidate at 390 px, `story-in-pane.png`).
- **Surprises found:**
  - monaco-yaml breaks on any monaco-editor after 0.52;
  - `codemirror-json-schema` ships shiki;
  - core's root entry drags `maplibre-gl` into any parser-only import (map-party
    hit the same thing and imports `/schemas` on its server instead);
  - the "Unknown layer type" error points at the layer, not at `type:`;
  - a syntax error flashes on the line being typed.

  All of these are folded into the decisions above.

---

## 12. Maintainer decisions (2026-10-22)

The maintainer accepted every recommendation except Q3. The questions as asked
follow the table.

| # | Question | Answer |
|---|---|---|
| Q1 | Top-level nav item, or under Examples? | **Top-level nav item** ("Playground"), as recommended. |
| Q2 | Build "Open in StackBlitz"? | **Not for now**, as recommended. Download is the way to take a map home. P12 is dropped. |
| Q3 | Offer a "plain text" toggle (native textarea, no completion)? | **Skip for now.** P14 is dropped. The screen-reader pass still happens (P9, or P15 in Phase 2); revisit if it shows CM6 is a barrier. |
| Q4 | Run shared links automatically, or behind a "Run this map" button? | **Run automatically, with the host list shown**, as recommended. |
| Q5 | Add a maplibre-free `@maplibre-yaml/core/parser` subpath? | **Yes, in Phase 2** (P13, a minor core change with a changeset). Not in the MVP. |
| Q6 | Keep the schema helper and diagnostics adapter in `docs/`? | **Yes**, as recommended. Extract to a package only when map-party asks. |
| Q7 | Hand-curated "Start here" list plus the generated gallery? | **Yes**: about 5 hand-picked starters, with the full gallery generated below them. |

### The questions as asked

1. **Q1 — Page placement.** Should it be a top-level nav item ("Playground") next to
   Getting started, or under Examples? Recommendation: top-level, because it is
   the student on-ramp.
2. **Q2 — StackBlitz.** Build "Open in StackBlitz" at all (Phase 2, 1 day), or let
   Download be the only way to take a map home? Recommendation: skip it until
   someone asks. Download covers the plain page, and Astro users already have
   the Astro guide.
3. **Q3 — Plain-text mode.** Offer a "plain text" toggle (a native textarea, no
   completion) for screen-reader users who prefer it and for very old devices?
   It costs about 1 KB and half a day.
4. **Q4 — Shared links.** Run them automatically with the host list shown (the
   proposal), or show a "Run this map" button first? Recommendation: run
   automatically. The document can't run code; it can only fetch, and the
   banner shows from where.
5. **Q5 — Core parser entry.** Add a maplibre-free `@maplibre-yaml/core/parser`
   subpath (a minor change with a changeset)? It would let the editor mount
   before maplibre-gl arrives, and it helps map-party's server too.
   Recommendation: yes, in Phase 2 (P13).
6. **Q6 — Sharing with map-party.** Keep the schema helper and diagnostics
   adapter in `docs/` for now, and extract them to a package only when
   map-party actually wants positioned diagnostics? Recommendation: yes; don't
   build a package speculatively.
7. **Q7 — Starters list.** Curate the "Start here" list by hand (about 5
   entries) and have the full gallery below it, generated? Recommendation: yes.
