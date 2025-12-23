# @maplibre-yaml/core

> Declarative web maps with YAML configuration. Build interactive MapLibre maps using simple, readable YAML syntax.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

### =ú **Declarative Map Configuration**
Define your entire maplayers, sources, controls, and interactivityin clean, readable YAML syntax.

### =Ê **Comprehensive Data Management**
- **HTTP Fetching** with automatic retry and caching
- **Real-time Updates** via Server-Sent Events (SSE) and WebSocket
- **Polling** with configurable intervals and merge strategies
- **Smart Merging** - Replace, merge by key, or window-based appending

### <¨ **Rich Visualization**
- Support for all MapLibre layer types (circle, line, fill, symbol, heatmap, etc.)
- Dynamic styling with expressions
- Multiple data sources (GeoJSON, Vector Tiles, Raster, etc.)

### = **Dynamic Interactions**
- Click handlers and popups
- Layer visibility toggling
- Data-driven legends
- Map controls (navigation, scale, geolocation, fullscreen)

### ¡ **Performance Optimized**
- LRU caching with TTL
- Request deduplication
- Non-overlapping polling execution
- Automatic reconnection for streaming

### =æ **Framework Integration**
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

MIT © [Your Name]

## Related Packages

- [`@maplibre-yaml/astro`](../astro) - Astro component integration
- [`@maplibre-yaml/cli`](../cli) - CLI tools for YAML validation and processing

## Resources

- [MapLibre GL JS Documentation](https://maplibre.org/maplibre-gl-js-docs/)
- [GeoJSON Specification](https://geojson.org/)
- [YAML Specification](https://yaml.org/)
