# maplibre-yaml

Declarative web maps with YAML configuration.

> ⚠️ **Early Development**: This library is in active development. APIs may change.

## Overview

maplibre-yaml lets you create interactive web maps using simple YAML configuration instead of JavaScript code. It's designed for:

- **Students** learning web mapping without deep programming knowledge
- **Developers** who want rapid map prototyping
- **Content creators** building story maps and data visualizations

## Features

- 🗺️ **Declarative Configuration** - Define maps in YAML
- 🔄 **Runtime Data Fetching** - Load GeoJSON at runtime (default)
- 📡 **Real-time Support** - WebSocket and Server-Sent Events
- 🎨 **Full MapLibre Support** - All layer types and styles
- 📜 **Scrollytelling** - Narrative story maps
- 🧩 **Web Components** - Framework-agnostic `<ml-map>` element
- ⚡ **Astro Integration** - First-class Astro support

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@maplibre-yaml/core` | Core library with schemas, parser, renderer | 🚧 In Progress |
| `@maplibre-yaml/astro` | Astro components and integration | 📋 Planned |
| `@maplibre-yaml/cli` | Command-line tools | 📋 Planned |

## Quick Start
```html
<script type="module" src="https://unpkg.com/@maplibre-yaml/core/dist/components/index.js"></script>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">

<ml-map>
  <script type="application/yaml">
    pages:
      - path: /
        blocks:
          - type: map
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
  </script>
</ml-map>
```

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

- [Design Document](./docs/design.md) - Architecture and decisions
- [YAML Schema Reference](./docs/schema.md) - Configuration options
- [API Reference](./docs/api.md) - TypeScript API

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT © mariogiampieri