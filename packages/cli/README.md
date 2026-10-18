# @maplibre-yaml/cli

The command line for [maplibre-yaml](https://docs.maplibre-yaml.org): start a
project from a template, validate YAML maps (in your editor's format or for
CI), preview a map with hot reload, and export a map document to a
standalone MapLibre `style.json`.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/cli.svg)](https://www.npmjs.com/package/@maplibre-yaml/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation: [docs.maplibre-yaml.org/cli](https://docs.maplibre-yaml.org/cli/getting-started/)**

## Running it

No install needed:

```bash
npx @maplibre-yaml/cli validate map.yaml
npx maplibre-yaml validate map.yaml   # the same, shorter
```

Installed, the CLI has two command names for the same program,
`maplibre-yaml` and the short `mlym`:

```bash
# globally: `mlym …` works in any folder
npm install -g @maplibre-yaml/cli
mlym validate map.yaml

# in a project: `npx mlym …` and package.json scripts
npm install --save-dev @maplibre-yaml/cli
npx mlym validate map.yaml
```

`mlym` exists only once `@maplibre-yaml/cli` is installed. There is no `mlym`
package, so `npx mlym` without an install fails; use `npx maplibre-yaml` for
one-off runs.

## Quick start

```bash
npx @maplibre-yaml/cli init my-map
cd my-map
npx serve .
```

Open the address `serve` prints. The `basic` template is an `index.html` and a
`map.yaml` loaded from a CDN: nothing to install or build. Edit `map.yaml` and
reload the page.

## Commands

- **`init [folder]`** creates a project from a template: `basic` (the
  default: an HTML page and `map.yaml`), `story` (a scrollytelling story with
  `<ml-scrollytelling>`, no build step) or `astro` (an Astro site). `-t` picks
  the template, `--list` shows them, `-n` sets the project name.
- **`validate <patterns...>`** checks files or globs against the schema, with
  line numbers and did-you-mean hints. `-f` sets the output (`human`, `json`,
  `sarif`, `vscode`), `--strict` fails on warnings (on by default in CI), `-w`
  watches. Exit code `0` valid, `1` errors, `2` no file matched.
- **`preview <config>`** serves one `type: map` file with hot reload and an
  error overlay, rendered with the core and maplibre-gl installed alongside
  the CLI (maplibre-gl 6 from the CDN when none is). `--port`, `--no-open`,
  `--debug`.
- **`emit <file>`** exports a `type: map` document to a spec-valid
  `style.json` that opens in Maputnik and renders in plain maplibre-gl.
  `-o dist/` writes a file, `--strict` fails on any loss, `--target 5.6.0`
  checks against a maplibre-gl version, `--sprite-base <url>` places generated
  sprites.
- **`schema [block]`** prints the JSON Schema for `map`, `scrollytelling`,
  `root` or `any`, matching the installed core.
- **`bake [preset]`** regenerates the pattern images of the `crosshatch` and
  `blueprint` classic styles.

What `emit` keeps, replaces with a fallback, or drops is listed in
[Export classes](https://docs.maplibre-yaml.org/guides/export-classes/).
Warnings go to stderr, so `npx @maplibre-yaml/cli emit map.yaml > style.json`
keeps the JSON clean.

## In CI

```yaml
- run: npx @maplibre-yaml/cli validate "**/*.yaml" --format json --strict
```

`--format sarif` feeds GitHub code scanning; see
[Integration examples](https://docs.maplibre-yaml.org/cli/reference/#integration-examples).

## Compatibility

Node.js `^18.17.0 || ^20.3.0 || >=21.0.0`. The CLI validates with the
`@maplibre-yaml/core` it depends on, so its results match what `<ml-map>` of
the same version accepts.

## Documentation

- [CLI Getting Started](https://docs.maplibre-yaml.org/cli/getting-started/)
- [Command Reference](https://docs.maplibre-yaml.org/cli/reference/) (every option, exit codes, config file)
- [VSCode Integration](https://docs.maplibre-yaml.org/cli/vscode/) ·
  [Editor Setup](https://docs.maplibre-yaml.org/guides/editor-setup/)

## Related packages

- [`maplibre-yaml`](https://www.npmjs.com/package/maplibre-yaml): runs this CLI, for `npx maplibre-yaml …`
- [`@maplibre-yaml/core`](https://www.npmjs.com/package/@maplibre-yaml/core): the library and the `<ml-map>` web component
- [`@maplibre-yaml/astro`](https://www.npmjs.com/package/@maplibre-yaml/astro): Astro components

## License

MIT
