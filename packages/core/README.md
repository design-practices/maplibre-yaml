# @maplibre-yaml/core

> Declarative web maps with YAML configuration. Build interactive MapLibre maps using simple, readable YAML syntax.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

### =� **Declarative Map Configuration**
Define your entire maplayers, sources, controls, and interactivityin clean, readable YAML syntax.

### =� **Comprehensive Data Management**
- **HTTP Fetching** with automatic retry and caching
- **Real-time Updates** via Server-Sent Events (SSE) and WebSocket
- **Polling** with configurable intervals and merge strategies
- **Smart Merging** - Replace, merge by key, or window-based appending

### <� **Rich Visualization**
- Support for all MapLibre layer types (circle, line, fill, symbol, heatmap, etc.)
- Dynamic styling with expressions
- Multiple data sources (GeoJSON, Vector Tiles, Raster, etc.)

### = **Dynamic Interactions**
- Click handlers and popups
- Layer visibility toggling
- Data-driven legends
- Map controls (navigation, scale, geolocation, fullscreen)

### � **Performance Optimized**
- LRU caching with TTL
- Request deduplication
- Non-overlapping polling execution
- Automatic reconnection for streaming

### =� **Framework Integration**
- Vanilla JavaScript/TypeScript
- Web Components (`<ml-map>`)
- Astro components (via `@maplibre-yaml/astro`)
- Framework agnostic core

## Installation

```bash
npm install @maplibre-yaml/core maplibre-gl
```

## Quick Start

### Using Web Components

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">
</head>
<body>
  <ml-map config="./map.yaml"></ml-map>

  <script type="module">
    import '@maplibre-yaml/core/components';
  </script>
</body>
</html>
```

### Using JavaScript API

```typescript
import { YAMLParser, MapRenderer } from '@maplibre-yaml/core';

const yaml = `
type: map
config:
  center: [-122.4, 37.8]
  zoom: 12
  style: https://demotiles.maplibre.org/style.json
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

const parser = new YAMLParser();
const config = await parser.parse(yaml);

const container = document.getElementById('map');
const renderer = new MapRenderer(container, config);
```

## YAML Configuration

### Basic Map

```yaml
type: map
id: my-map
config:
  center: [-74.006, 40.7128]
  zoom: 10
  style: https://demotiles.maplibre.org/style.json

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
        refreshInterval: 5000        # Poll every 5 seconds
        updateStrategy: merge         # Merge by key
        updateKey: vehicleId          # Unique identifier
      cache:
        enabled: false                # Disable cache for real-time data
      loading:
        enabled: true
        message: Loading vehicles...
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

### Real-time Streaming with WebSocket

```yaml
layers:
  - id: live-events
    type: circle
    source:
      type: geojson
      url: https://api.example.com/initial-events.geojson
      stream:
        type: websocket
        url: wss://api.example.com/events
        reconnect: true
        reconnectMaxAttempts: 10
      refresh:
        updateStrategy: append-window
        windowSize: 100               # Keep last 100 events
        windowDuration: 300000        # Keep events from last 5 minutes
        timestampField: timestamp
    paint:
      circle-radius: 8
      circle-color: "#8b5cf6"
```

### Server-Sent Events (SSE)

```yaml
layers:
  - id: sensors
    type: heatmap
    source:
      type: geojson
      url: https://api.example.com/sensors.geojson
      stream:
        type: sse
        url: https://api.example.com/sensor-updates
        eventTypes:
          - temperature
          - humidity
        reconnect: true
      refresh:
        updateStrategy: merge
        updateKey: sensorId
    paint:
      heatmap-weight:
        - interpolate
        - ["linear"]
        - ["get", "temperature"]
        - 0
        - 0
        - 100
        - 1
```

### Interactive Features

```yaml
layers:
  - id: locations
    type: symbol
    source:
      type: geojson
      url: https://example.com/locations.geojson
    layout:
      icon-image: marker
      icon-size: 1.5
    interactions:
      - type: click
        popup:
          content: |
            <h3>{{name}}</h3>
            <p>{{description}}</p>
            <p><strong>Type:</strong> {{category}}</p>
```

### Data Merge Strategies

#### Replace Strategy
Complete replacement of all data on each update:
```yaml
refresh:
  updateStrategy: replace
```

#### Merge Strategy
Update or add features by unique key:
```yaml
refresh:
  updateStrategy: merge
  updateKey: id  # Feature property to use as unique identifier
```

#### Append-Window Strategy
Append new data with size and/or time-based windowing:
```yaml
refresh:
  updateStrategy: append-window
  windowSize: 100              # Keep last 100 features
  windowDuration: 300000       # Keep features from last 5 minutes
  timestampField: timestamp    # Feature property containing timestamp
```

## API Reference

### Core Classes

#### `YAMLParser`
Parse and validate YAML map configurations.

```typescript
import { YAMLParser } from '@maplibre-yaml/core';

const parser = new YAMLParser();
const config = await parser.parse(yamlString);
const errors = parser.validate(config);
```

#### `MapRenderer`
Render maps from parsed configurations.

```typescript
import { MapRenderer } from '@maplibre-yaml/core';

const renderer = new MapRenderer(container, config, {
  onLoad: () => console.log('Map loaded'),
  onError: (error) => console.error('Map error:', error),
});

// Update visibility
renderer.setLayerVisibility('layer-id', false);

// Update data
renderer.updateLayerData('layer-id', newGeoJSON);

// Clean up
renderer.destroy();
```

### Data Management

#### `DataFetcher`
HTTP data fetching with caching and retry.

```typescript
import { DataFetcher } from '@maplibre-yaml/core';

const fetcher = new DataFetcher({
  cache: {
    enabled: true,
    defaultTTL: 300000,  // 5 minutes
    maxSize: 50
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000
  }
});

const result = await fetcher.fetch('https://example.com/data.geojson', {
  ttl: 60000,  // Override default TTL
  onRetry: (attempt, delay, error) => {
    console.log(`Retry attempt ${attempt} after ${delay}ms`);
  }
});
```

#### `PollingManager`
Manage periodic data refresh.

```typescript
import { PollingManager } from '@maplibre-yaml/core';

const polling = new PollingManager();

polling.start('layer-id', {
  interval: 5000,
  onTick: async () => {
    const data = await fetchData();
    updateMap(data);
  },
  onError: (error) => console.error('Polling error:', error),
  immediate: true,           // Execute immediately on start
  pauseWhenHidden: true       // Pause when tab is hidden
});

// Control polling
polling.pause('layer-id');
polling.resume('layer-id');
await polling.triggerNow('layer-id');
polling.stop('layer-id');
```

#### `StreamManager`
Manage WebSocket and SSE connections.

```typescript
import { StreamManager } from '@maplibre-yaml/core';

const streams = new StreamManager();

await streams.connect('stream-id', {
  type: 'websocket',
  url: 'wss://example.com/stream',
  onData: (data) => {
    console.log('Received:', data);
  },
  onStateChange: (state) => {
    console.log('Connection state:', state);
  },
  reconnect: {
    enabled: true,
    maxRetries: 10,
    initialDelay: 1000,
    maxDelay: 30000
  }
});

// Send data (WebSocket only)
streams.send('stream-id', { type: 'subscribe', channel: 'updates' });

// Disconnect
streams.disconnect('stream-id');
```

#### `DataMerger`
Merge GeoJSON data with different strategies.

```typescript
import { DataMerger } from '@maplibre-yaml/core';

const merger = new DataMerger();

const result = merger.merge(existingData, incomingData, {
  strategy: 'merge',
  updateKey: 'id'
});

console.log(`Added: ${result.added}, Updated: ${result.updated}`);
console.log(`Total features: ${result.total}`);
```

#### `LoadingManager`
Manage loading states with optional UI.

```typescript
import { LoadingManager } from '@maplibre-yaml/core';

const loading = new LoadingManager({
  showUI: true,
  messages: {
    loading: 'Loading data...',
    error: 'Failed to load data',
    retry: 'Retrying...'
  },
  spinnerStyle: 'circle',
  minDisplayTime: 300  // Minimum 300ms display to prevent flashing
});

// Listen to events
loading.on('loading:start', ({ layerId }) => {
  console.log('Loading started:', layerId);
});

loading.on('loading:complete', ({ layerId, duration, fromCache }) => {
  console.log('Loading complete:', layerId, duration, fromCache);
});

// Show loading
loading.showLoading('layer-id', container, 'Loading...');

// Show progress
loading.updateProgress('layer-id', 50, 100);

// Hide loading
loading.hideLoading('layer-id', { fromCache: false });

// Show error with retry
loading.showError('layer-id', container, new Error('Failed'), () => {
  retryLoad();
});
```

### Layer Manager Integration

The `LayerManager` integrates all data management components:

```typescript
import { LayerManager } from '@maplibre-yaml/core';

const layerManager = new LayerManager(map, {
  onDataLoading: (layerId) => console.log('Loading:', layerId),
  onDataLoaded: (layerId, count) => console.log('Loaded:', layerId, count),
  onDataError: (layerId, error) => console.error('Error:', layerId, error)
});

// Add layer with all data features
await layerManager.addLayer({
  id: 'my-layer',
  type: 'circle',
  source: {
    type: 'geojson',
    url: 'https://example.com/data.geojson',
    refresh: {
      refreshInterval: 5000,
      updateStrategy: 'merge',
      updateKey: 'id'
    },
    cache: {
      enabled: true,
      ttl: 60000
    },
    stream: {
      type: 'websocket',
      url: 'wss://example.com/updates',
      reconnect: true
    }
  }
});

// Control data updates
layerManager.pauseRefresh('my-layer');
layerManager.resumeRefresh('my-layer');
await layerManager.refreshNow('my-layer');
layerManager.disconnectStream('my-layer');
```

## Schema Validation

All YAML configurations are validated using Zod schemas:

```typescript
import { MapConfigSchema } from '@maplibre-yaml/core/schemas';

try {
  const config = MapConfigSchema.parse(yamlData);
  // Config is valid and type-safe
} catch (error) {
  console.error('Validation errors:', error.issues);
}
```

## Schemas

The schema system is a core component of `@maplibre-yaml/core`, providing type-safe validation and excellent developer experience. All schemas are built with [Zod](https://zod.dev) and automatically generate TypeScript types.

### Schema Architecture

```
MapConfigSchema
├── PageConfigSchema (scrollytelling)
│   ├── SectionSchema
│   └── StepSchema
└── MapSchema (single map)
    ├── MapConfigurationSchema
    ├── LayerSchema[]
    ├── SourceSchema[]
    ├── LegendSchema
    ├── ControlsSchema
    └── InteractionSchema
```

### Map Configuration Schema

The top-level `MapConfigSchema` validates complete map configurations:

```typescript
import { MapConfigSchema } from '@maplibre-yaml/core/schemas';

const config = MapConfigSchema.parse({
  type: 'map',
  id: 'my-map',
  config: {
    center: [-122.4, 37.8],
    zoom: 12,
    pitch: 0,
    bearing: 0,
    style: 'https://demotiles.maplibre.org/style.json',
    minZoom: 0,
    maxZoom: 22,
    bounds: [[-180, -90], [180, 90]],
    maxBounds: [[-180, -90], [180, 90]],
    fitBoundsOptions: {
      padding: 50,
      maxZoom: 15
    }
  },
  layers: [],
  sources: [],
  controls: {},
  legend: {},
  interactions: []
});
```

### Layer Schema

Supports all MapLibre layer types with full paint and layout properties:

```typescript
import { LayerSchema } from '@maplibre-yaml/core/schemas';

// Circle layer
const circleLayer = LayerSchema.parse({
  id: 'points',
  type: 'circle',
  source: 'points-source',
  paint: {
    'circle-radius': 6,
    'circle-color': '#3b82f6',
    'circle-opacity': 0.8,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff'
  },
  layout: {
    visibility: 'visible'
  },
  minzoom: 0,
  maxzoom: 22,
  filter: ['==', ['get', 'type'], 'poi']
});

// Symbol layer with expressions
const symbolLayer = LayerSchema.parse({
  id: 'labels',
  type: 'symbol',
  source: 'places',
  layout: {
    'text-field': ['get', 'name'],
    'text-size': 12,
    'text-anchor': 'top',
    'text-offset': [0, 1],
    'icon-image': 'marker',
    'icon-size': 1
  },
  paint: {
    'text-color': '#000000',
    'text-halo-color': '#ffffff',
    'text-halo-width': 2
  }
});

// Heatmap layer
const heatmapLayer = LayerSchema.parse({
  id: 'density',
  type: 'heatmap',
  source: 'points',
  paint: {
    'heatmap-weight': [
      'interpolate',
      ['linear'],
      ['get', 'value'],
      0, 0,
      100, 1
    ],
    'heatmap-intensity': 1,
    'heatmap-radius': 30,
    'heatmap-opacity': 0.7
  }
});
```

**Supported Layer Types:**
- `circle` - Point data as circles
- `line` - Linear features
- `fill` - Polygon fills
- `fill-extrusion` - 3D buildings/polygons
- `symbol` - Icons and text labels
- `heatmap` - Density visualization
- `hillshade` - Terrain shading
- `raster` - Raster tiles
- `background` - Map background

### Source Schema

Multiple source types with comprehensive configuration options:

#### GeoJSON Source

```typescript
import { GeoJSONSourceSchema } from '@maplibre-yaml/core/schemas';

const source = GeoJSONSourceSchema.parse({
  type: 'geojson',

  // Data options (one required)
  url: 'https://example.com/data.geojson',
  // OR data: { type: 'FeatureCollection', features: [] },
  // OR prefetchedData: { type: 'FeatureCollection', features: [] },

  // Fetch strategy
  fetchStrategy: 'runtime', // 'runtime' | 'build' | 'hybrid'

  // Real-time updates
  refresh: {
    refreshInterval: 5000,
    updateStrategy: 'merge',  // 'replace' | 'merge' | 'append-window'
    updateKey: 'id',
    windowSize: 100,
    windowDuration: 300000,
    timestampField: 'timestamp'
  },

  // Streaming
  stream: {
    type: 'websocket',  // 'websocket' | 'sse'
    url: 'wss://example.com/stream',
    reconnect: true,
    reconnectMaxAttempts: 10,
    reconnectDelay: 1000,
    reconnectMaxDelay: 30000,
    eventTypes: ['update', 'delete'],
    protocols: ['v1', 'v2']
  },

  // Caching
  cache: {
    enabled: true,
    ttl: 300000  // 5 minutes
  },

  // Loading UI
  loading: {
    enabled: true,
    message: 'Loading data...',
    showErrorOverlay: true
  },

  // Clustering
  cluster: true,
  clusterRadius: 50,
  clusterMaxZoom: 14,
  clusterMinPoints: 2,
  clusterProperties: {
    sum: ['+', ['get', 'value']],
    max: ['max', ['get', 'value']]
  },

  // Spatial index
  tolerance: 0.375,
  buffer: 128,
  lineMetrics: false,
  generateId: false
});
```

#### Vector Tile Source

```typescript
import { VectorSourceSchema } from '@maplibre-yaml/core/schemas';

const source = VectorSourceSchema.parse({
  type: 'vector',
  tiles: [
    'https://tiles.example.com/{z}/{x}/{y}.pbf'
  ],
  // OR url: 'https://tiles.example.com/tiles.json',
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.0511, 180, 85.0511],
  attribution: '© Example Maps'
});
```

#### Raster Source

```typescript
import { RasterSourceSchema } from '@maplibre-yaml/core/schemas';

const source = RasterSourceSchema.parse({
  type: 'raster',
  tiles: [
    'https://tiles.example.com/{z}/{x}/{y}.png'
  ],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 18,
  attribution: '© Example Imagery'
});
```

#### Image & Video Sources

```typescript
import { ImageSourceSchema, VideoSourceSchema } from '@maplibre-yaml/core/schemas';

// Image overlay
const imageSource = ImageSourceSchema.parse({
  type: 'image',
  url: 'https://example.com/overlay.png',
  coordinates: [
    [-122.5, 37.9],  // top-left
    [-122.3, 37.9],  // top-right
    [-122.3, 37.7],  // bottom-right
    [-122.5, 37.7]   // bottom-left
  ]
});

// Video overlay
const videoSource = VideoSourceSchema.parse({
  type: 'video',
  urls: [
    'https://example.com/video.mp4',
    'https://example.com/video.webm'
  ],
  coordinates: [
    [-122.5, 37.9],
    [-122.3, 37.9],
    [-122.3, 37.7],
    [-122.5, 37.7]
  ]
});
```

### Controls Schema

Configure map controls with the `ControlsSchema`:

```typescript
import { ControlsSchema } from '@maplibre-yaml/core/schemas';

const controls = ControlsSchema.parse({
  navigation: {
    enabled: true,
    position: 'top-right',
    showCompass: true,
    showZoom: true,
    visualizePitch: true
  },
  scale: {
    enabled: true,
    position: 'bottom-left',
    maxWidth: 100,
    unit: 'metric'  // 'metric' | 'imperial' | 'nautical'
  },
  geolocation: {
    enabled: true,
    position: 'top-right',
    trackUserLocation: true,
    showUserHeading: true,
    showAccuracyCircle: true
  },
  fullscreen: {
    enabled: true,
    position: 'top-right'
  }
});
```

### Legend Schema

Create dynamic legends with the `LegendSchema`:

```typescript
import { LegendSchema } from '@maplibre-yaml/core/schemas';

const legend = LegendSchema.parse({
  enabled: true,
  position: 'bottom-left',
  title: 'Map Legend',
  entries: [
    {
      label: 'Active',
      color: '#22c55e',
      shape: 'circle'  // 'circle' | 'square' | 'line'
    },
    {
      label: 'Delayed',
      color: '#f59e0b',
      shape: 'circle'
    },
    {
      label: 'Inactive',
      color: '#6b7280',
      shape: 'circle'
    }
  ],
  style: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: '10px',
    borderRadius: '4px'
  }
});
```

### Interaction Schema

Define click handlers and popups:

```typescript
import { InteractionSchema } from '@maplibre-yaml/core/schemas';

const interaction = InteractionSchema.parse({
  type: 'click',
  layers: ['points', 'polygons'],
  popup: {
    content: `
      <h3>{{name}}</h3>
      <p>{{description}}</p>
      <p><strong>Category:</strong> {{category}}</p>
      <p><strong>Value:</strong> {{value}}</p>
    `,
    closeButton: true,
    closeOnClick: true,
    maxWidth: '300px',
    className: 'custom-popup'
  },
  action: 'popup'  // 'popup' | 'toggle-visibility' | 'fly-to'
});
```

### Scrollytelling Schema (Page Configuration)

For narrative-driven maps with synchronized scrolling:

```typescript
import { PageConfigSchema } from '@maplibre-yaml/core/schemas';

const page = PageConfigSchema.parse({
  type: 'page',
  id: 'story-map',
  title: 'Urban Growth Story',
  description: 'Explore urban development over time',
  sections: [
    {
      id: 'intro',
      type: 'text',
      title: 'Introduction',
      content: 'This story explores urban development...',
      style: {
        backgroundColor: '#f9fafb',
        padding: '60px'
      }
    },
    {
      id: 'map-section',
      type: 'map',
      config: {
        center: [-122.4, 37.8],
        zoom: 12,
        style: 'https://demotiles.maplibre.org/style.json'
      },
      steps: [
        {
          id: 'step1',
          content: '## 1990s\nUrban core development began...',
          map: {
            center: [-122.4, 37.8],
            zoom: 13,
            pitch: 0,
            bearing: 0,
            duration: 2000
          },
          layers: {
            show: ['buildings-1990'],
            hide: ['buildings-2000', 'buildings-2010']
          }
        },
        {
          id: 'step2',
          content: '## 2000s\nSuburban expansion accelerated...',
          map: {
            center: [-122.3, 37.9],
            zoom: 12,
            pitch: 45,
            bearing: -17.6,
            duration: 2000
          },
          layers: {
            show: ['buildings-1990', 'buildings-2000'],
            hide: ['buildings-2010']
          }
        }
      ]
    }
  ]
});
```

### Schema Composition

Schemas can be composed for complex configurations:

```typescript
import {
  MapSchema,
  LayerSchema,
  GeoJSONSourceSchema,
  ControlsSchema,
  LegendSchema
} from '@maplibre-yaml/core/schemas';

// Build configuration programmatically
const layer = LayerSchema.parse({ /* ... */ });
const source = GeoJSONSourceSchema.parse({ /* ... */ });
const controls = ControlsSchema.parse({ /* ... */ });

const map = MapSchema.parse({
  type: 'map',
  id: 'composed-map',
  config: { /* ... */ },
  layers: [layer],
  sources: [{ id: 'my-source', ...source }],
  controls
});
```

### Validation and Error Handling

Schemas provide detailed validation errors:

```typescript
import { MapConfigSchema } from '@maplibre-yaml/core/schemas';
import { ZodError } from 'zod';

try {
  const config = MapConfigSchema.parse(invalidConfig);
} catch (error) {
  if (error instanceof ZodError) {
    error.issues.forEach(issue => {
      console.error(
        `${issue.path.join('.')}: ${issue.message}`
      );
    });
    // Example output:
    // layers.0.source: Required
    // config.center: Expected array, received string
    // layers.0.paint.circle-radius: Expected number, received string
  }
}
```

### Safe Parsing

Use `safeParse` for non-throwing validation:

```typescript
import { LayerSchema } from '@maplibre-yaml/core/schemas';

const result = LayerSchema.safeParse(data);

if (result.success) {
  // result.data is typed and valid
  console.log('Valid layer:', result.data);
} else {
  // result.error contains validation issues
  console.error('Validation failed:', result.error.issues);
}
```

### Type Inference

Schemas automatically generate TypeScript types:

```typescript
import { LayerSchema, GeoJSONSourceSchema } from '@maplibre-yaml/core/schemas';
import type { z } from 'zod';

// Infer types from schemas
type Layer = z.infer<typeof LayerSchema>;
type GeoJSONSource = z.infer<typeof GeoJSONSourceSchema>;

// Use inferred types
const createLayer = (layer: Layer) => {
  // layer is fully typed with autocomplete
  console.log(layer.id, layer.type, layer.paint);
};
```

### Custom Validation

Extend schemas with custom validation:

```typescript
import { LayerSchema } from '@maplibre-yaml/core/schemas';
import { z } from 'zod';

// Add custom refinement
const CustomLayerSchema = LayerSchema.refine(
  (layer) => {
    if (layer.type === 'circle' && layer.paint) {
      const radius = layer.paint['circle-radius'];
      return typeof radius === 'number' && radius > 0;
    }
    return true;
  },
  {
    message: 'Circle radius must be a positive number'
  }
);
```

### Schema Defaults

Many schemas include sensible defaults:

```typescript
import { GeoJSONSourceSchema } from '@maplibre-yaml/core/schemas';

const source = GeoJSONSourceSchema.parse({
  type: 'geojson',
  url: 'https://example.com/data.geojson'
  // Defaults applied:
  // - fetchStrategy: 'runtime'
  // - cluster: false
  // - clusterRadius: 50
  // - tolerance: 0.375
  // - cache.enabled: true
  // - loading.enabled: false
});

console.log(source.fetchStrategy); // 'runtime'
console.log(source.cluster);       // false
console.log(source.clusterRadius); // 50
```

### Available Schemas

All schemas are exported from `@maplibre-yaml/core/schemas`:

```typescript
import {
  // Top-level
  MapConfigSchema,
  PageConfigSchema,

  // Map components
  MapSchema,
  MapConfigurationSchema,

  // Layers
  LayerSchema,
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  HeatmapLayerSchema,

  // Sources
  SourceSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,

  // Configuration
  ControlsSchema,
  LegendSchema,
  InteractionSchema,

  // Scrollytelling
  SectionSchema,
  StepSchema,

  // Data management
  RefreshConfigSchema,
  StreamConfigSchema,
  CacheConfigSchema,
  LoadingConfigSchema
} from '@maplibre-yaml/core/schemas';
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  MapConfig,
  LayerConfig,
  GeoJSONSourceConfig,
  MergeStrategy,
  PollingConfig,
  StreamConfig,
  LoadingConfig
} from '@maplibre-yaml/core';

const config: MapConfig = {
  type: 'map',
  id: 'my-map',
  config: {
    center: [-122.4, 37.8],
    zoom: 12
  },
  layers: []
};
```

## Performance Considerations

### Caching
- Default cache TTL: 5 minutes
- Cache respects `Cache-Control` headers
- Cache size limit: 50 entries (LRU eviction)
- Disable cache for real-time data

### Polling
- Minimum interval: 1000ms (1 second)
- Non-overlapping execution (waits for previous tick to complete)
- Automatic pause when document is hidden
- Configurable error handling and continuation

### Streaming
- Automatic reconnection with exponential backoff
- Connection state tracking
- Graceful degradation on connection loss
- Efficient binary frame handling (WebSocket)

### Memory Management
- All managers implement proper cleanup via `destroy()`
- Automatic timer and connection cleanup
- DOM element removal
- No memory leaks in long-running applications

## Browser Support

- Modern browsers with ES2022 support
- Native `fetch`, `EventSource`, and `WebSocket` APIs
- ResizeObserver for responsive layouts
- Document visibility API for polling optimization

## Bundle Size

- Core package: ~136KB (unminified)
- Tree-shakeable ES modules
- Zero runtime dependencies (peer dependency: maplibre-gl)

## Examples

See the [examples directory](../../examples) for complete working examples:

- Basic static map
- Real-time vehicle tracking
- Sensor data heatmap with SSE
- Interactive point-of-interest map
- Multi-layer dashboard

## Contributing

Contributions are welcome! Please read the [contributing guidelines](../../CONTRIBUTING.md) first.

## License

MIT � [Your Name]

## Related Packages

- [`@maplibre-yaml/astro`](../astro) - Astro component integration
- [`@maplibre-yaml/cli`](../cli) - CLI tools for YAML validation and processing

## Resources

- [MapLibre GL JS Documentation](https://maplibre.org/maplibre-gl-js-docs/)
- [GeoJSON Specification](https://geojson.org/)
- [YAML Specification](https://yaml.org/)
