# maplibre-yaml

Declarative web maps with YAML configuration.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Overview

maplibre-yaml lets you create interactive web maps using simple YAML configuration instead of JavaScript code. It's designed for:

- **Students** learning web mapping without deep programming knowledge
- **Developers** who want rapid map prototyping
- **Content creators** building story maps and data visualizations

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@maplibre-yaml/core`](./packages/core) | Core library: schemas, parser, renderer, web components | [![npm](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core) |
| [`@maplibre-yaml/astro`](./packages/astro) | Astro components: Map, FullPageMap, Scrollytelling | [![npm](https://img.shields.io/npm/v/@maplibre-yaml/astro.svg)](https://www.npmjs.com/package/@maplibre-yaml/astro) |
| [`@maplibre-yaml/cli`](./packages/cli) | CLI tools: validation, preview, project scaffolding | [![npm](https://img.shields.io/npm/v/@maplibre-yaml/cli.svg)](https://www.npmjs.com/package/@maplibre-yaml/cli) |

## Quick Start

### Web Component

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">
<style>
  ml-map { display: block; height: 400px; }
</style>

<ml-map src="/map.yaml"></ml-map>

<script type="module">
  import '@maplibre-yaml/core/register';
</script>
```

### YAML Configuration

```yaml
type: map
id: my-map
config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: points
    type: circle
    source:
      type: geojson
      url: "https://example.com/data.geojson"
    paint:
      circle-radius: 8
      circle-color: "#ff0000"
```

### Astro

```astro
---
import { Map } from '@maplibre-yaml/astro';
---
<Map src="/configs/my-map.yaml" height="400px" />
```

## Features

- **Declarative Configuration** - Define maps in YAML
- **Runtime Data Fetching** - Load GeoJSON at runtime with caching and retry
- **Real-time Support** - WebSocket and Server-Sent Events
- **Full MapLibre Support** - All layer types and styles
- **Scrollytelling** - Narrative story maps with chapter-based transitions
- **Web Components** - Framework-agnostic `<ml-map>` element
- **Astro Integration** - Components, content collections, and blog integration
- **CLI Tools** - Validation, preview server, and project scaffolding
- **Type-Safe** - Full TypeScript support with Zod schemas

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev
```

## Documentation

- [Documentation Site](https://docs.maplibre-yaml.org)
- [Getting Started](https://docs.maplibre-yaml.org/getting-started/introduction/)
- [YAML Schema Reference](https://docs.maplibre-yaml.org/schema/overview/)
- [Astro Integration](https://docs.maplibre-yaml.org/integrations/astro/)
- [CLI Reference](https://docs.maplibre-yaml.org/cli/getting-started/)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT
