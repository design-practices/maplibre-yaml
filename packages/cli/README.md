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

## Quick Start

```bash
# Scaffold a new project
maplibre-yaml init my-project -t basic

# Validate a configuration
maplibre-yaml validate my-map.yaml

# Preview a map
maplibre-yaml preview my-map.yaml
```

## Commands

### `init`

Create a new maplibre-yaml project from a template.

```bash
maplibre-yaml init [directory]

Options:
  -t, --template <name>  Template to use (basic, story, astro)
  -n, --name <name>      Project name
```

If no template is specified, available templates are listed interactively.

**Examples:**

```bash
# Interactive template selection
maplibre-yaml init my-project

# Specify template directly
maplibre-yaml init my-project -t astro

# Scaffold in current directory
maplibre-yaml init -t basic
```

### `validate`

Validate YAML configuration files against the maplibre-yaml schema.

```bash
maplibre-yaml validate <patterns...>

Options:
  -f, --format <type>  Output format: human, json, sarif, vscode (default: human)
  --strict             Treat warnings as errors (default: false)
  -w, --watch          Watch for changes and re-validate (default: false)
```

Accepts file paths and glob patterns.

**Exit codes:**
- `0` - Valid configuration
- `1` - Validation errors
- `2` - File not found
- `3` - Invalid YAML syntax
- `4` - Unknown error

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

## Aliases

The CLI provides a shorter `mlym` alias:

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
