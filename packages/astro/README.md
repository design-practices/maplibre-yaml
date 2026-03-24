# @maplibre-yaml/astro

Astro components for creating interactive maps and scrollytelling experiences using YAML configuration.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/astro.svg)](https://www.npmjs.com/package/@maplibre-yaml/astro)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @maplibre-yaml/astro @maplibre-yaml/core maplibre-gl
```

## Quick Start

### Basic Map

```astro
---
import { Map } from '@maplibre-yaml/astro';
---
<Map src="/configs/my-map.yaml" height="400px" />
```

### Full-Page Map with Controls

```astro
---
import { FullPageMap } from '@maplibre-yaml/astro';
---
<FullPageMap
  src="/configs/dashboard.yaml"
  showControls
  showLegend
  legendPosition="bottom-left"
/>
```

### Scrollytelling Story

```astro
---
import { Scrollytelling } from '@maplibre-yaml/astro';
---
<Scrollytelling src="/stories/earthquake-history.yaml" />
```

## Components

### Map

Basic map component for embedding maps in your pages.

**Props:**
- `src?: string` - Path to YAML config file (in `/public`)
- `config?: MapBlock` - Pre-loaded configuration object
- `height?: string` - Map height (default: "400px")
- `class?: string` - Additional CSS classes
- `style?: string` - Additional inline styles

**Example:**

```astro
---
import { Map, loadMapConfig } from '@maplibre-yaml/astro';
const config = await loadMapConfig('./src/configs/map.yaml');
---
<Map config={config} height="600px" />
```

### FullPageMap

Full-viewport map with built-in controls and optional legend.

**Props:**
- `src?: string` - Path to YAML config file
- `config?: MapBlock` - Pre-loaded configuration
- `showControls?: boolean` - Show zoom/reset controls (default: true)
- `showLegend?: boolean` - Show auto-generated legend (default: false)
- `legendPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` - Legend position
- `class?: string` - Additional CSS classes
- `style?: string` - Additional inline styles

### Scrollytelling

Immersive narrative experiences with scroll-driven map transitions.

**Props:**
- `src?: string` - Path to YAML story config
- `config?: ScrollytellingBlock` - Pre-loaded story configuration
- `class?: string` - Additional CSS classes
- `debug?: boolean` - Show debug outlines

### Chapter

Individual chapter component (typically used internally by Scrollytelling).

**Props:**
- `id: string` - Unique chapter identifier
- `title: string` - Chapter title
- `description?: string` - HTML description
- `image?: string` - Image URL
- `video?: string` - Video URL
- `alignment?: 'left' | 'right' | 'center' | 'full'` - Content alignment
- `hidden?: boolean` - Hide content for map-only chapters
- `theme?: 'light' | 'dark'` - Visual theme
- `isActive?: boolean` - Active state

## Global Configuration

Define site-wide map defaults (style, center, zoom) that are inherited by all maps. This avoids repeating the same base configuration on every page.

### 1. Create a global config YAML file

```yaml
# src/config/maps.yaml
title: "My Map App"
defaultMapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
defaultCenter: [-73.985, 40.674]
defaultZoom: 14
theme: light
```

### 2. Create a shared loader module

```typescript
// src/lib/map-config.ts
import { loadGlobalMapConfig } from "@maplibre-yaml/astro";

export const globalMapConfig = await loadGlobalMapConfig(
  "./src/config/maps.yaml"
);
```

### 3. Use in pages with map builders

```astro
---
import { Map, buildPointMapConfig } from "@maplibre-yaml/astro";
import { globalMapConfig } from "../lib/map-config";

// mapStyle, center, and zoom are inherited from global config
const mapConfig = buildPointMapConfig(
  {
    location: {
      coordinates: [-73.983, 40.676],
      name: "My Location",
    },
  },
  globalMapConfig,
);
---
<Map config={mapConfig} height="400px" />
```

All map builders (`buildPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPointMapConfig`) accept `globalConfig` as their second argument.

## Adding Geographic Data to Existing Collections

You can add map support to any Astro content collection by importing the geographic schemas directly. This is useful when your collection has its own schema and you just want to add optional location data.

### Schema setup

```typescript
// src/content/config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import {
  LocationPointSchema,
  RegionPolygonSchema,
  RouteLineSchema,
} from "@maplibre-yaml/astro";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    status: z.string(),
    description: z.string(),
    // Add optional geographic data for any geometry type
    location: LocationPointSchema.optional(),  // point
    region: RegionPolygonSchema.optional(),     // polygon
    route: RouteLineSchema.optional(),          // line
  }),
});
```

### Frontmatter examples

**Point** (simplest — just coordinates):

```yaml
---
title: "New Library Branch"
status: "In Progress"
description: "Construction of new public library"
location:
  coordinates: [-73.983, 40.676]
  name: "487 4th Avenue"
  description: "Proposed 3-story library building"
  zoom: 16
---
```

**Polygon** (area/region):

```yaml
---
title: "Park Renovation"
status: "Planning"
description: "Remediation and renovation of Greene Park"
region:
  name: "Greene Park"
  description: "Park boundary"
  coordinates:
    - - [-73.9848, 40.6748]
      - [-73.9833, 40.6748]
      - [-73.9833, 40.6738]
      - [-73.9848, 40.6738]
      - [-73.9848, 40.6748]
  fillColor: "#2ecc71"
  fillOpacity: 0.35
---
```

**Line** (route/path):

```yaml
---
title: "Canal Stormwater Management"
status: "Active"
description: "Stormwater infrastructure along the canal"
route:
  name: "Canal Path"
  description: "Infrastructure route"
  coordinates:
    - [-73.9890, 40.6790]
    - [-73.9870, 40.6760]
    - [-73.9855, 40.6730]
    - [-73.9840, 40.6700]
  color: "#3498db"
  width: 4
---
```

### Dynamic map per collection item

```astro
---
import {
  Map,
  buildPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
} from "@maplibre-yaml/astro";
import type { MapBlock } from "@maplibre-yaml/core";
import { globalMapConfig } from "../lib/map-config";

// Assuming `entry` is a collection item with optional geo fields
const { entry } = Astro.props;
const data = entry.data;

let mapConfig: MapBlock;

if (data.region) {
  mapConfig = buildPolygonMapConfig({ region: data.region }, globalMapConfig);
} else if (data.route) {
  mapConfig = buildRouteMapConfig({ route: data.route }, globalMapConfig);
} else if (data.location) {
  mapConfig = buildPointMapConfig({ location: data.location }, globalMapConfig);
} else {
  // Fallback: default area map from global config
  mapConfig = buildPointMapConfig(
    {
      location: {
        coordinates: globalMapConfig.defaultCenter!,
        name: data.title,
      },
    },
    globalMapConfig,
  );
}
---
<Map config={mapConfig} height="300px" />
```

Items without any geographic data gracefully fall back to the global default center.

## Important Notes

> **Do NOT import `@maplibre-yaml/core/register` in Astro frontmatter.**
> The register module contains `class MLMap extends HTMLElement`, which crashes
> during Astro's server-side rendering with `ReferenceError: HTMLElement is not defined`.
> The `@maplibre-yaml/astro` components handle registration automatically via
> a client-side `<script>` tag. If you are writing a custom component using
> `<ml-map>` directly, place the import in a `<script>` tag (not `is:inline`),
> never in the frontmatter `---` block.

> **Do NOT use `client:only` or other client directives** on components from
> `@maplibre-yaml/astro`. They are Astro components (not React/Vue/Svelte),
> so client directives are invalid and will cause errors.

> **The `src` prop is a URL path, not a filesystem path.** Files in `/public`
> are served from the root, so `public/configs/map.yaml` should be referenced
> as `src="/configs/map.yaml"`.

## YAML Configuration

### Map

```yaml
type: map
id: my-map
config:
  center: [-122.4, 37.8]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"

layers:
  - id: points-layer
    type: circle
    source:
      type: geojson
      url: "/data/points.geojson"
    paint:
      circle-radius: 8
      circle-color: "#3b82f6"
```

### Scrollytelling

```yaml
type: scrollytelling
id: my-story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"

chapters:
  - id: intro
    title: "Introduction"
    description: "<p>Welcome to the story.</p>"
    location:
      center: [0, 0]
      zoom: 2
    alignment: center

  - id: detail
    title: "The Details"
    description: "<p>Here's what happened.</p>"
    image: "/images/detail.jpg"
    location:
      center: [10, 10]
      zoom: 8
      pitch: 45
      bearing: 30
    alignment: left
    onChapterEnter:
      - action: setPaintProperty
        layer: data-layer
        property: circle-color
        value: "#ff0000"
    onChapterExit:
      - action: setFilter
        layer: data-layer
        filter: null
```

## Utilities

### YAML Loaders

```typescript
import {
  loadMapConfig,
  loadScrollytellingConfig,
  loadYAML,
  loadFromGlob
} from '@maplibre-yaml/astro';

// Load and validate a map config
const map = await loadMapConfig('./src/configs/map.yaml');

// Load and validate a scrollytelling config
const story = await loadScrollytellingConfig('./src/stories/earthquake.yaml');

// Load raw YAML
const raw = await loadYAML('./src/configs/custom.yaml');

// Load multiple files via glob
const maps = await loadFromGlob('./src/configs/*.yaml');
```

### Content Collections

Use with Astro Content Collections for type-safe YAML management:

```typescript
// src/content/config.ts
import { defineCollection } from 'astro:content';
import { getMapSchema, getScrollytellingSchema } from '@maplibre-yaml/astro';

export const collections = {
  maps: defineCollection({
    type: 'data',
    schema: getMapSchema()
  }),
  stories: defineCollection({
    type: 'data',
    schema: getScrollytellingSchema()
  })
};
```

### Collection Items with Geographic Data

Pre-built schemas for adding location data to content collections (blog posts, articles, etc.):

```typescript
// src/content/config.ts
import { defineCollection } from 'astro:content';
import {
  getCollectionItemWithLocationSchema,
  getCollectionItemWithLocationsSchema,
  getCollectionItemWithRegionSchema,
  getCollectionItemWithRouteSchema,
  getCollectionItemWithGeoSchema,
} from '@maplibre-yaml/astro';

export const collections = {
  // Posts with a single location
  posts: defineCollection({
    type: 'content',
    schema: getCollectionItemWithLocationSchema()
  }),

  // Travel posts with multiple locations
  travel: defineCollection({
    type: 'content',
    schema: getCollectionItemWithLocationsSchema()
  }),

  // Neighborhood guides with regions
  neighborhoods: defineCollection({
    type: 'content',
    schema: getCollectionItemWithRegionSchema()
  }),

  // Hiking guides with routes
  trails: defineCollection({
    type: 'content',
    schema: getCollectionItemWithRouteSchema()
  }),

  // Mixed geographic content
  adventures: defineCollection({
    type: 'content',
    schema: getCollectionItemWithGeoSchema({
      author: z.string(),
      category: z.enum(['travel', 'hiking', 'city-guide'])
    })
  })
};
```

Example frontmatter for a post with location:

```yaml
---
title: "My Trip to Paris"
pubDate: 2024-03-15
location:
  coordinates: [2.3522, 48.8566]
  name: "Paris, France"
  zoom: 12
---
```

### Map Builders

Generate map configurations from collection item geographic data. All builders accept an optional `globalConfig` as a second argument for inheriting defaults:

```typescript
import {
  buildPointMapConfig,
  buildMultiPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
  calculateCenter,
  calculateBounds,
  loadGlobalMapConfig,
} from '@maplibre-yaml/astro';

const globalConfig = await loadGlobalMapConfig('./src/config/maps.yaml');

// Build a map config from a single location (inherits mapStyle from global)
const mapConfig = buildPointMapConfig(
  { location: post.data.location },
  globalConfig,
);

// Build from multiple locations
const multiMap = buildMultiPointMapConfig(
  { locations: travel.data.locations },
  globalConfig,
);

// Build from a polygon region
const regionMap = buildPolygonMapConfig(
  { region: guide.data.region },
  globalConfig,
);

// Build from a route
const routeMap = buildRouteMapConfig(
  { route: trail.data.route },
  globalConfig,
);
```

### Custom Schemas

Extend built-in schemas with custom metadata:

```typescript
import { extendSchema, getMapSchema } from '@maplibre-yaml/astro';
import { z } from 'zod';

const customMapSchema = extendSchema(getMapSchema(), {
  author: z.string(),
  publishDate: z.date(),
  tags: z.array(z.string())
});
```

## Error Handling

```typescript
import { loadMapConfig, YAMLLoadError } from '@maplibre-yaml/astro';

try {
  const config = await loadMapConfig('./src/configs/map.yaml');
} catch (error) {
  if (error instanceof YAMLLoadError) {
    console.error('Validation errors:', error.errors);
    console.error('File:', error.filePath);
  }
}
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  MapProps,
  FullPageMapProps,
  ScrollytellingProps,
  ChapterProps,
  LocationPoint,
  RegionPolygon,
  RouteLine,
  PointMapOptions,
  MultiPointMapOptions,
  PolygonMapOptions,
  RouteMapOptions,
} from '@maplibre-yaml/astro';
```

## License

MIT

## Related Packages

- [`@maplibre-yaml/core`](../core) - Core library: schemas, parser, renderer
- [`@maplibre-yaml/cli`](../cli) - CLI for validation, preview, scaffolding

## Links

- [Documentation](https://docs.maplibre-yaml.org/integrations/astro/)
- [GitHub](https://github.com/design-practices/maplibre-yaml)
- [MapLibre GL JS](https://maplibre.org/)
- [Astro](https://astro.build/)
