# @maplibre-yaml/cli

Command-line tools for validating, previewing, and scaffolding maplibre-yaml projects.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/cli.svg)](https://www.npmjs.com/package/@maplibre-yaml/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install -g @maplibre-yaml/cli
```

Or use without installing:

```bash
npx @maplibre-yaml/cli <command>
```

An install provides two command names for the same program, `maplibre-yaml`
and the shorter `mlym`. Without an install, use `npx maplibre-yaml` or
`npx @maplibre-yaml/cli`: `npx mlym` only works in a project that has
`@maplibre-yaml/cli` installed.

## Quick Start

```bash
# Scaffold a new project (./my-project), then serve it: npx serve my-project
maplibre-yaml init my-project

# Validate a configuration
maplibre-yaml validate my-map.yaml

# Preview a map
maplibre-yaml preview my-map.yaml
```

## Commands

### `init`

Create a new maplibre-yaml project from a template.

```bash
maplibre-yaml init [folder]

Options:
  -t, --template <name>  Template to use: basic (default), story, astro
  -n, --name <name>      Project name (default: the folder name)
  --list                 List the templates and exit
```

- `basic`: `index.html` + `map.yaml`, loaded from a CDN with an import map.
  Serve the folder with any static server (`npx serve .`); no install or build.
- `story`: a scrollytelling `story.yaml`. Its `index.html` uses
  `<ml-scrollytelling>`, which is not in `@maplibre-yaml/core` 0.7 yet.
- `astro`: an Astro site rendering `public/configs/map.yaml` with `<ml-map>`.

The folder defaults to `./<name>` (`./my-map` for `basic`) and must be new or
empty. An unknown template or option exits with code 1 and creates nothing.

**Examples:**

```bash
# Basic template in ./my-project
maplibre-yaml init my-project

# Astro template
maplibre-yaml init my-project -t astro

# Into the current (empty) folder
maplibre-yaml init . -t basic
```

### `validate`

Validate YAML configuration files against the maplibre-yaml schema.

```bash
maplibre-yaml validate <patterns...>

Options:
  -f, --format <type>  Output format: human, json, sarif, vscode (default: human)
  --strict             Treat warnings as errors (default: on when CI is set; --no-strict to disable)
  -w, --watch          Watch for changes and re-validate (default: false)
```

Accepts file paths and glob patterns.

**Exit codes:**
- `0` - Valid configuration
- `1` - Errors found, including YAML syntax errors
- `2` - No file matched
- `4` - Unexpected internal error

**Examples:**

```bash
# Validate a single file
maplibre-yaml validate config.yaml

# Validate multiple files with glob
maplibre-yaml validate "configs/*.yaml"

# JSON output for CI pipelines
maplibre-yaml validate config.yaml -f json

# SARIF output for GitHub code scanning
maplibre-yaml validate "**/*.yaml" -f sarif

# VSCode-compatible output
maplibre-yaml validate config.yaml -f vscode

# Watch mode for development
maplibre-yaml validate config.yaml -w

# Strict mode (warnings become errors)
maplibre-yaml validate config.yaml --strict
```

### `preview`

Start a local development server with hot reload.

```bash
maplibre-yaml preview <config>

Options:
  --port <number>  Port to run server on (default: 3000)
  --no-open        Don't open browser automatically
  --debug          Show debug panel (default: false)
```

**Features:**
- Hot reload on file changes
- Error overlay for invalid configs
- Status bar showing connection state
- Full MapLibre GL integration

**Examples:**

```bash
# Basic preview
maplibre-yaml preview config.yaml

# Custom port, no browser
maplibre-yaml preview config.yaml --port 8080 --no-open
```

### `emit`

Export a `type: map` document to a standalone, spec-valid MapLibre
`style.json` (renders in plain maplibre-gl and opens in Maputnik).

```bash
maplibre-yaml emit <file>

Options:
  -o, --out <path>       Write to a file; a folder (dist/) gets style.json inside
  --with-fallbacks       Export with fallbacks and warn about losses (the default)
  --strict               Fail (exit 1) if anything would change what the map shows
  --target <version>     maplibre-gl version the style is for, e.g. 5.6.0
  --trust <context>      trusted | untrusted (default)
  --sprite-base <url>    Absolute URL where generated sprite files will be served
```

Warnings go to stderr, so `maplibre-yaml emit map.yaml > style.json` stays
clean. See the [CLI reference](https://docs.maplibre-yaml.org/cli/reference/#emit)
and [Export classes](https://docs.maplibre-yaml.org/guides/export-classes/).

## Aliases

Once installed (globally, or in a project with `npm install --save-dev
@maplibre-yaml/cli` and then `npx mlym …`), the CLI also answers to `mlym`.
`npx mlym` without an install fails: there is no `mlym` package (npm reserves
the name as too similar to existing packages). Use `npx maplibre-yaml …` or
`npx @maplibre-yaml/cli …` for one-off runs.

```bash
mlym validate config.yaml
mlym preview config.yaml
mlym init my-project -t basic
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Validate maps
  run: npx @maplibre-yaml/cli validate "configs/*.yaml" -f json

# With SARIF for GitHub code scanning
- name: Validate maps (SARIF)
  run: npx @maplibre-yaml/cli validate "**/*.yaml" -f sarif > results.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

## Related Packages

- [`@maplibre-yaml/core`](../core) - Core library: schemas, parser, renderer
- [`@maplibre-yaml/astro`](../astro) - Astro components and integration

## Documentation

For detailed documentation, visit [docs.maplibre-yaml.org/cli](https://docs.maplibre-yaml.org/cli/getting-started/)

## License

MIT
