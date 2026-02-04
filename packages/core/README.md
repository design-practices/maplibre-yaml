# @maplibre-yaml/core

Declarative web maps with YAML configuration. Build interactive MapLibre maps using simple, readable YAML syntax.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @maplibre-yaml/core maplibre-gl
```

## Quick Start

### Web Component

The simplest way to use maplibre-yaml is with the `<ml-map>` web component:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">
  <style>
    ml-map { display: block; height: 400px; }
  </style>
</head>
<body>
  <ml-map src="/map.yaml"></ml-map>
  <script type="module">
    import '@maplibre-yaml/core/register';
  </script>
</body>
</html>
```

### JavaScript API

```typescript
import { parseYAMLConfig, MapRenderer } from '@maplibre-yaml/core';

const yaml = `
type: map
config:
  center: [-122.4, 37.8]
  zoom: 12
  mapStyle: https://demotiles.maplibre.org/style.json
layers:
  - id: points
    type: circle
    source:
      type: geojson
      url: https://example.com/data.geojson
    paint:
      circle-radius: 6
      circle-color: "#3b82f6"
`;

const config = parseYAMLConfig(yaml);
const container = document.getElementById('map');
const renderer = new MapRenderer(container, config);
```

## Entry Points

The package provides multiple entry points for different use cases:

| Import | Purpose |
|--------|---------|
| `@maplibre-yaml/core` | Main entry: parser, renderer, data utilities |
| `@maplibre-yaml/core/register` | Auto-registers `<ml-map>` web component |
| `@maplibre-yaml/core/schemas` | Zod schemas for validation and types |
| `@maplibre-yaml/core/components` | Manual component registration |

## YAML Configuration

### Basic Map

```yaml
type: map
id: my-map
config:
  center: [-74.006, 40.7128]
  zoom: 10
  mapStyle: https://demotiles.maplibre.org/style.json

layers:
  - id: cities
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - type: Feature
            geometry:
              type: Point
              coordinates: [-74.006, 40.7128]
            properties:
              name: New York
    paint:
      circle-radius: 8
      circle-color: "#ef4444"
```

### Real-time Data with Polling

```yaml
layers:
  - id: vehicles
    type: circle
    source:
      type: geojson
      url: https://api.transit.example.com/vehicles.geojson
      refresh:
        refreshInterval: 5000
        updateStrategy: merge
        updateKey: vehicleId
    paint:
      circle-radius: 6
      circle-color:
        - match
        - ["get", "status"]
        - "active"
        - "#22c55e"
        - "delayed"
        - "#f59e0b"
        - "#6b7280"
```

### Streaming with WebSocket

```yaml
layers:
  - id: live-events
    type: circle
    source:
      type: geojson
      url: https://api.example.com/initial.geojson
      stream:
        type: websocket
        url: wss://api.example.com/events
        reconnect: true
      refresh:
        updateStrategy: append-window
        windowSize: 100
        windowDuration: 300000
    paint:
      circle-radius: 8
      circle-color: "#8b5cf6"
```

### Interactive Popups

```yaml
layers:
  - id: locations
    type: symbol
    source:
      type: geojson
      url: https://example.com/locations.geojson
    layout:
      icon-image: marker
    interactions:
      - type: click
        popup:
          content: |
            <h3>{{name}}</h3>
            <p>{{description}}</p>
```

## API Reference

### Parser

```typescript
import { YAMLParser, parseYAMLConfig, safeParseYAMLConfig } from '@maplibre-yaml/core';

// Simple parsing
const config = parseYAMLConfig(yamlString);

// Safe parsing with error handling
const result = safeParseYAMLConfig(yamlString);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}

// Using the class
const parser = new YAMLParser();
const config = parser.parse(yamlString);
```

### Renderer

```typescript
import { MapRenderer } from '@maplibre-yaml/core';

const renderer = new MapRenderer(container, config, {
  onLoad: () => console.log('Map loaded'),
  onError: (error) => console.error(error),
});

// Control layers
renderer.setLayerVisibility('layer-id', false);
renderer.updateLayerData('layer-id', newGeoJSON);

// Cleanup
renderer.destroy();
```

### Data Management

#### DataFetcher

```typescript
import { DataFetcher } from '@maplibre-yaml/core';

const fetcher = new DataFetcher({
  cache: { enabled: true, defaultTTL: 300000, maxSize: 50 },
  retry: { enabled: true, maxRetries: 3 }
});

const result = await fetcher.fetch('https://example.com/data.geojson');
```

#### PollingManager

```typescript
import { PollingManager } from '@maplibre-yaml/core';

const polling = new PollingManager();

polling.start('layer-id', {
  interval: 5000,
  onTick: async () => updateMap(await fetchData()),
  pauseWhenHidden: true
});

polling.pause('layer-id');
polling.resume('layer-id');
polling.stop('layer-id');
```

#### StreamManager

```typescript
import { StreamManager } from '@maplibre-yaml/core';

const streams = new StreamManager();

await streams.connect('stream-id', {
  type: 'websocket',
  url: 'wss://example.com/stream',
  onData: (data) => console.log(data),
  reconnect: { enabled: true, maxRetries: 10 }
});

streams.disconnect('stream-id');
```

#### DataMerger

```typescript
import { DataMerger } from '@maplibre-yaml/core';

const merger = new DataMerger();
const result = merger.merge(existing, incoming, {
  strategy: 'merge',
  updateKey: 'id'
});
```

### Schemas

All schemas are built with Zod and provide TypeScript types:

```typescript
import {
  // Layer schemas
  LayerSchema,
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  FillExtrusionLayerSchema,
  HeatmapLayerSchema,
  HillshadeLayerSchema,
  BackgroundLayerSchema,

  // Source schemas
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,

  // Map schemas
  MapConfigSchema,
  MapBlockSchema,
  ControlsConfigSchema,
  LegendConfigSchema,

  // Scrollytelling schemas
  ChapterSchema,
  ScrollytellingBlockSchema,

  // Page schemas
  PageSchema,
  RootSchema,
  GlobalConfigSchema,

  // Base schemas
  LngLatSchema,
  ColorSchema,
  ExpressionSchema,
} from '@maplibre-yaml/core/schemas';

// Validation
const layer = LayerSchema.parse(data);

// Safe parsing
const result = LayerSchema.safeParse(data);
if (result.success) {
  console.log(result.data);
}
```

Type inference:

```typescript
import type { z } from 'zod';
import { LayerSchema, MapBlockSchema } from '@maplibre-yaml/core/schemas';

type Layer = z.infer<typeof LayerSchema>;
type MapBlock = z.infer<typeof MapBlockSchema>;
```

Exported types:

```typescript
import type {
  // Map types
  MapConfig,
  MapBlock,
  MapFullPageBlock,
  ControlPosition,
  ControlsConfig,
  LegendConfig,

  // Scrollytelling types
  Chapter,
  ChapterAction,
  ChapterLayers,
  ScrollytellingBlock,

  // Page types
  Page,
  Block,
  MixedBlock,
  GlobalConfig,
  RootConfig,
} from '@maplibre-yaml/core/schemas';
```

### Web Components

```typescript
import { MLMap, registerMLMap } from '@maplibre-yaml/core/components';

// Register with default name
registerMLMap();

// Or with custom name
customElements.define('my-map', MLMap);
```

Component usage:

```html
<!-- External YAML file -->
<ml-map src="/map.yaml"></ml-map>

<!-- Inline YAML -->
<ml-map>
  <script type="text/yaml">
type: map
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://..."
  </script>
</ml-map>

<!-- JSON attribute -->
<ml-map config='{"type":"map",...}'></ml-map>
```

## Merge Strategies

| Strategy | Description |
|----------|-------------|
| `replace` | Replace all data on each update |
| `merge` | Update/add features by unique key |
| `append-window` | Append with size/time-based windowing |

```yaml
refresh:
  updateStrategy: merge
  updateKey: id

# OR for windowed appending
refresh:
  updateStrategy: append-window
  windowSize: 100
  windowDuration: 300000
  timestampField: timestamp
```

## Layer Types

- `circle` - Point data as circles
- `line` - Linear features
- `fill` - Polygon fills
- `fill-extrusion` - 3D buildings/polygons
- `symbol` - Icons and text labels
- `heatmap` - Density visualization
- `hillshade` - Terrain shading
- `raster` - Raster tiles
- `background` - Map background

## Browser Support

- Modern browsers with ES2022 support
- Native `fetch`, `EventSource`, and `WebSocket` APIs

## Related Packages

- [`@maplibre-yaml/astro`](../astro) - Astro component integration
- [`@maplibre-yaml/cli`](../cli) - CLI for YAML validation

## License

MIT
