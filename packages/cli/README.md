# @maplibre-yaml/cli

Command-line tools for validating and previewing maplibre-yaml configurations.

## Installation

```bash
npm install -g @maplibre-yaml/cli
```

Or use without installing:

```bash
npx @maplibre-yaml/cli <command>
```

## Quick Start

### Validate a Configuration

```bash
maplibre-yaml validate my-map.yaml
```

### Preview a Map

```bash
maplibre-yaml preview my-map.yaml
```

## Commands

### `validate`

Validate YAML configuration files against the maplibre-yaml schema.

```bash
maplibre-yaml validate <config>

Options:
  --json     Output results as JSON (default: false)
  --strict   Treat warnings as errors (default: false)
```

**Exit codes:**
- `0` - Valid configuration
- `1` - Validation errors
- `2` - File not found
- `3` - Invalid YAML syntax
- `4` - Unknown error

**Examples:**

```bash
# Basic validation
maplibre-yaml validate config.yaml

# JSON output for CI
maplibre-yaml validate config.yaml --json

# Strict mode
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

The CLI provides a shorter `mlym` alias for convenience:

```bash
mlym validate config.yaml
mlym preview config.yaml
```

## CI/CD Integration

Use the JSON output for automated validation:

```yaml
# GitHub Actions example
- name: Validate maps
  run: npx @maplibre-yaml/cli validate maps/*.yaml --json
```

## Documentation

For detailed documentation, visit [https://maplibre-yaml.dev/cli](https://maplibre-yaml.dev/cli)

## License

MIT
