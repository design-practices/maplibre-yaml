# Docs style guide

For anyone (people and agents) writing pages under `docs/src/content/docs/`.
The generated pages (`reference/yaml/`, `reference/api/`) follow their
generators instead. Readers are general users, many of them new to web maps;
the two main entry points are a plain HTML page using the CDN and an Astro
site on GitHub Pages.

## Page shape (integration and guide pages)

1. **What it is and when to use it.** One to three sentences, no heading.
2. **Quick start.** Copy-paste code that you have run, ending with what the
   reader should see.
3. **Common tasks.** One heading per task, phrased as what the reader wants
   to do. Each is a short explanation and one example.
4. **Options and reference.** Link to the generated YAML reference
   (`/reference/yaml/…`) or `/reference/elements/` rather than copying field
   tables. A component's props block is fine; a table of YAML keys is not.
5. **Troubleshooting.** Link `/troubleshooting/`, then only the problems
   specific to this page.
6. **Alternatives**, last, under headings that say so.

Tutorials (`getting-started/`) are linear steps instead, each one verified,
with nothing optional in the main path.

## Recommended first

Lead with the path we recommend. Put other routes at the end under a label
that says when to use them ("Without the Astro package: `<ml-map>`
directly", "If you can't use a build step…"). Never interleave a second
route with the first, and never open a page with a caveat about another
route.

## Voice

- Second person, present tense, concise. One idea per paragraph.
- No marketing, no emoji checklists, no "simply", "just", "easy" or
  "powerful".
- Explain *why* when the reader has a choice to make or a rule to follow
  ("Import it in the `<script>`: the frontmatter runs on the server, where
  `HTMLElement` doesn't exist").
- Say what the reader sees: the message, the card, the console line.
- State version floors once, where they matter ("needs
  `@maplibre-yaml/astro` 0.6 or later"), not as a history of each release.
- User-visible text stays neutral: no wording about classes, courses or
  students.

## Terms

Headings and sidebar labels are sentence case ("Corner slots", not "Corner
Slots"). Use one term per concept:

| Use | Not | Notes |
|---|---|---|
| story map | scrollytelling story, scrolly | Name "scrollytelling" once per page for search. The component, element and `type: scrollytelling` keep their names. |
| map document | config, YAML config | `config:` is one key inside it. |
| format v1 / format v2 | v1 format, legacy format | Lower-case "format", except at the start of a sentence or in a title. |
| export (to style.json) | eject, emit | `mlym emit` is the command's name; write it in code. "Eject" is the pre-0.7 name. The `emit` interaction is a different thing. |
| basemap | base map, base style | The prose word. `mapStyle:` (format v1) and `basemap:` (format v2) are the keys that set it. |
| `public/` | the public directory, /public | A path in code. A file there is served from the site root. |
| author hints | debug messages | The on-map notes shown only while you develop. |

### Glossary

- **Map document**: one YAML file, `type: map`, rendered by `<ml-map>`.
- **Story map**: a `type: scrollytelling` document: chapters that scroll
  over a sticky map, rendered by `<ml-scrollytelling>` (or the Astro
  `<Scrollytelling>` component).
- **Basemap**: the background map (streets, terrain) under your layers.
- **Format v2**: the opt-in `version: 2` layout that splits a document into
  `style:` (what exports to style.json) and `runtime:` (behaviour).
- **Export**: turning a map document into a standalone MapLibre
  `style.json`.
- **Base / subpath**: the folder a site is served from, such as `/<repo>/`
  on a GitHub Pages project site.
- **`mlym emit`**: the CLI command that exports. Write "export with
  `mlym emit`"; in a command readers copy, `npx maplibre-yaml@latest emit`.
- **`click.emit` (host event)**: an interaction that calls a function the
  page registered when a feature is clicked. Always write it as
  `click.emit` or "host event", never a bare "emit", and say it is not the
  export command wherever both appear.
- **Export class**: what an export does with one part of a document:
  `exports`, `exports-with-fallback` or `no-export`. Don't use "compile",
  "lower", "degrade" or "strip" for these.
- **`contract` / `lossy` warning**: the two kinds of export warning. A
  `contract` warning is an expected drop or requirement that leaves the map
  looking the same; a `lossy` one means the map looks different, and
  `--strict` refuses it.
- **Project settings file**: `maplibre-yaml.config.json` (or `.yaml`,
  `.js`), the CLI's defaults. Not "config", which is the map document's
  `config:` key.
- **Modeline**: the `# yaml-language-server: $schema=…` first line that
  gives an editor the schema.
- **Strict mode**: `mlym validate` treating warnings as errors; on by
  default when the `CI` environment variable is set.
- **`mlym` / `maplibre-yaml` / `@maplibre-yaml/cli`**: one program.
  `@maplibre-yaml/cli` is the package; `mlym` and `maplibre-yaml` are its
  command names once installed; `npx maplibre-yaml@latest` runs it with no
  install.

## Code samples

- Every sample must pass `pnpm docs:validate-snippets`. A deliberately
  partial or wrong YAML fence says `no-validate` in its info string.
- Prefer one complete, minimal example to several partial ones. A YAML
  sample shows only the keys its point needs.
- A full page includes `<meta name="viewport" content="width=device-width,
  initial-scale=1">`.
- Titled fences (`title="examples/astro/site/…"`) must match that file
  verbatim; the Astro docs tests check it.
- Run new commands and code before publishing them, against the published
  packages.
- A live map shown next to a YAML sample draws that sample, character for
  character: its file in `docs/public/configs/` is the fence plus the schema
  modeline. Give the reader the fence and the demo the file; don't trim one
  of them.

## Running example

Use the same data across pages, so a reader meets one map that grows rather
than a new one on every page.

- **Points: the USGS earthquake feed**,
  `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson`.
  It is open to any site (CORS), and each feature has `mag`, `place`,
  `title` and `time`. Always write `mag`, never `magnitude`. The quick start,
  *Your first map, explained* and the landing page use it.
- **Inline data: the US cities** (New York 8,336,817, Chicago, Los Angeles),
  where a page teaches `data:` written in the document.
- **Polygons and thematic maps: the sample tracts**,
  `/data/classify/sample-tracts.geojson`, written as a full
  `https://docs.maplibre-yaml.org/…` URL in a sample readers copy.
- **Basemap:** OpenFreeMap liberty. Use positron only where a choropleth
  needs a quiet base, and say why once.
- **File names:** `index.html` and `map.yaml` side by side (what
  `mlym init` writes), `story.yaml` for a story, data under `data/`. Write
  `<repo>` for a GitHub Pages subpath.

## Anchors and URLs

- Never move the addresses in `NEVER_MOVE` and `STUB_ANCHORS`
  (`docs/scripts/check-stable-urls.mjs`). Published READMEs, core's error
  text and editor modelines point at them.
- Renaming a heading changes its anchor. Keep the old one with an explicit
  id: `## New heading {#old-anchor}` in `.md`; in `.mdx`, escape the brace,
  `## New heading \{#old-anchor}`, or MDX reads it as an expression.
  (Case-only changes keep the anchor.)
- Moving a section to another page: leave a short heading with the same text
  where it was, linking the new place. Group these under a "Moved" heading
  at the end of the page.
- Moving or renaming a page: add it to `docs/redirects.mjs`, which writes both
  the Astro redirect page and the Cloudflare 301.
- Before merging, build the site, run `astro preview`, and run
  `node docs/scripts/check-stable-urls.mjs --base http://localhost:<port>`
  with `--readme` for each published package README.
