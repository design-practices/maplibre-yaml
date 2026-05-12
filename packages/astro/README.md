# @maplibre-yaml/astro

Astro components for creating interactive maps and scrollytelling experiences using YAML configuration.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/astro.svg)](https://www.npmjs.com/package/@maplibre-yaml/astro)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @maplibre-yaml/astro @maplibre-yaml/core maplibre-gl
```

## Two import paths: `@maplibre-yaml/astro` vs `@maplibre-yaml/astro/utils`

This package exposes two entry points:

| Path | What it includes | Import from |
|------|------------------|------------|
| `@maplibre-yaml/astro` | Astro components (`Map`, `FullPageMap`, `Scrollytelling`) **plus** all utilities, schemas, and builders | Astro pages and components (`.astro` files) |
| `@maplibre-yaml/astro/utils` | Schemas, builders, loaders, and helpers **only** -- no Astro components | `src/content/config.ts` and any other Node-only context |

**Why this matters:** `src/content/config.ts` is evaluated by Astro's content layer in a Node context that can't load `.astro` component files. Importing schemas from `@maplibre-yaml/astro` (the main entry) in your content config triggers errors like `Content config not loaded` or `Cannot read properties of undefined (reading 'get')`. Always use `@maplibre-yaml/astro/utils` in content configs.

```typescript
// ✅ src/content/config.ts -- use the /utils subpath
import { LocationPointSchema, FeatureRefSchema } from "@maplibre-yaml/astro/utils";

// ✅ src/pages/index.astro -- use the main entry (gets components + utils)
import { Map, buildPointMapConfig } from "@maplibre-yaml/astro";
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

> **Important:** When importing schemas in `src/content/config.ts`, use the `@maplibre-yaml/astro/utils` subpath rather than the main package entry. The main entry re-exports Astro components (`Map`, `FullPageMap`, `Scrollytelling`) which can't be loaded outside the Astro component pipeline. The `/utils` subpath contains only the schema and builder utilities that are safe to import in your content config.

```typescript
// src/content/config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import {
  LocationPointSchema,
  RegionPolygonSchema,
  RouteLineSchema,
} from "@maplibre-yaml/astro/utils";

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

Use `buildMapConfigFromEntry` to absorb the geometry-type dispatch in one call. The helper inspects the entry data, finds the first set geometry field by precedence (`feature_ref` > `region` > `route` > `locations` > `location`), and dispatches to the appropriate builder. Falls back to the supplied `options.fallback` if none are set.

```astro
---
import { Map, buildMapConfigFromEntry } from "@maplibre-yaml/astro";
import { globalMapConfig } from "../lib/map-config";

const { entry } = Astro.props;
const data = entry.data;

const mapConfig = await buildMapConfigFromEntry(data, globalMapConfig, {
  label: data.title,
  description: data.summary,
  fallback: {
    coordinates: globalMapConfig.defaultCenter!,
    name: data.title,
  },
});
---
<Map config={mapConfig} height="300px" />
```

The helper is always async (because `feature_ref` requires file I/O at build time). When the entry uses inline geometry, the underlying builder call is sync but the helper still returns a Promise for API consistency.

#### Field precedence

If multiple geometry fields are set on the same entry, the helper takes the first one in this order:

1. `feature_ref` -- external GeoJSON file reference
2. `region` -- inline polygon
3. `route` -- inline line
4. `locations` -- inline multi-point
5. `location` -- inline single point
6. `options.fallback` -- supplied default
7. Throws if none of the above are set

#### Override defaults: `label` and `description`

Each geometry's own `name` and `description` fields take priority. If they're unset, `options.label` and `options.description` fill in. This is useful for content collections where each entry has a page-level title that should appear in popups by default.

#### When to skip the helper

The helper assumes library-convention field names (`feature_ref`, `location`, `region`, `route`, `locations`). If your collection uses different field names (e.g., `boundary` instead of `region`), call the underlying builders directly instead:

```astro
---
import { Map, buildPolygonMapConfig } from "@maplibre-yaml/astro";

const mapConfig = buildPolygonMapConfig({ region: entry.data.boundary }, globalMapConfig);
---
```

## GeoJSON Feature References

When multiple collection items share geometry from a single source-of-truth GeoJSON file, copying coordinates into each frontmatter is fragile and verbose. The `feature_ref` field lets a collection item point at a feature in an external GeoJSON file (matched by `featureId` or by property equality). At build time, the loader reads the file, finds the matching feature, detects its geometry type, and dispatches to the appropriate builder.

> **Runnable example:** [`examples/astro/minimal`](../../examples/astro/minimal) contains a bare-bones Astro app exercising every scenario in this section. The `/showcase` page pairs each `FeatureRef` snippet with the map it produces; `/poas/sample` demonstrates `buildMapConfigFromEntry` with a markdown entry.

### Quick start

**1. Add `feature_ref` to your collection schema**

```typescript
// src/content/config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import {
  FeatureRefSchema,
  LocationPointSchema,
  RegionPolygonSchema,
  RouteLineSchema,
} from "@maplibre-yaml/astro/utils";  // /utils subpath: see note above

export const collections = {
  poas: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/poas" }),
    schema: z.object({
      title: z.string(),
      gotf_id: z.number(),
      // Either feature_ref OR inline geometry -- not both
      feature_ref: FeatureRefSchema.optional(),
      location: LocationPointSchema.optional(),
      region: RegionPolygonSchema.optional(),
      route: RouteLineSchema.optional(),
    }),
  }),
};
```

For automatic mutual-exclusivity validation (rejects items declaring both `feature_ref` and inline geometry), use `getCollectionItemWithFeatureRefSchema()` instead.

**2. Reference features from frontmatter**

```yaml
# Match by feature.id (when GeoJSON has top-level id fields)
feature_ref:
  source: "./src/data/gowanus.geojson"
  featureId: "poa-1.1"

# Match by property equality (more common)
feature_ref:
  source: "./src/data/gowanus.geojson"
  match:
    property: "gotf_id"
    equals: 1.1
  fillColor: "#3388ff"
  fillOpacity: 0.25
```

**3. Build the map in your dynamic page**

The simplest path is `buildMapConfigFromEntry`, which dispatches to the right builder by inspecting the entry data:

```astro
---
import { Map, buildMapConfigFromEntry } from "@maplibre-yaml/astro";
import { globalMapConfig } from "../lib/map-config";

const { entry } = Astro.props;
const mapConfig = await buildMapConfigFromEntry(entry.data, globalMapConfig, {
  label: entry.data.title,
  fallback: { coordinates: globalMapConfig.defaultCenter! },
});
---
<Map config={mapConfig} height="300px" />
```

If you need to handle each geometry type explicitly (e.g., custom popup or styling per type), call the builders directly:

```astro
---
import {
  Map,
  buildFeatureMapConfig,
  buildPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
} from "@maplibre-yaml/astro";
import type { MapBlock } from "@maplibre-yaml/core";
import { globalMapConfig } from "../lib/map-config";

const { entry } = Astro.props;
const data = entry.data;

let mapConfig: MapBlock;
if (data.feature_ref) {
  // Async branch: loads the GeoJSON file at build time
  mapConfig = await buildFeatureMapConfig(
    { ref: data.feature_ref },
    globalMapConfig,
  );
} else if (data.region) {
  mapConfig = buildPolygonMapConfig({ region: data.region }, globalMapConfig);
} else if (data.route) {
  mapConfig = buildRouteMapConfig({ route: data.route }, globalMapConfig);
} else if (data.location) {
  mapConfig = buildPointMapConfig({ location: data.location }, globalMapConfig);
} else {
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

### Match strategies

Two ways to identify which feature to use:

| Form | When to use |
|------|------------|
| `featureId: <string \| number>` | When your GeoJSON features have stable top-level `id` fields (RFC 7946) |
| `match: { property, equals }` | When IDs live in `feature.properties` (common -- mirrors MapLibre's `promoteId`) |

Exactly one match must be returned. Zero matches or multiple matches throw `GeoJSONLoadError` with details (file path, total feature count, sample IDs/values).

### Override fields

Frontmatter can override `feature.properties.name` and `feature.properties.description`, plus all style fields (`markerColor`, `fillColor`, `strokeColor`, `fillOpacity`, `color`, `width`, `zoom`). Overrides take priority; properties are the fallback.

### Supported geometry types

| Type | Builder dispatched |
|------|-------------------|
| `Point` | `buildPointMapConfig` |
| `MultiPoint` | `buildMultiPointMapConfig` |
| `LineString` | `buildRouteMapConfig` |
| `MultiLineString` | `buildMultiLineStringMapConfig` (renders all segments) |
| `Polygon` | `buildPolygonMapConfig` |
| `MultiPolygon` | `buildMultiPolygonMapConfig` (renders all polygons) |
| `GeometryCollection` (single member) | dispatches to inner geometry type |
| `GeometryCollection` (multiple members) | throws clear error -- split into separate features |

### Path resolution and security defaults

The `source` value is resolved against `process.cwd()` by default. Two settings on `FeatureLoadOptions` adjust this:

```typescript
import {
  buildFeatureMapConfig,
  type FeatureLoadOptions,
} from "@maplibre-yaml/astro";

const loadOptions: FeatureLoadOptions = {
  // Use a custom project root for monorepo builds where cwd != Astro project dir.
  // Canonicalized via realpath so macOS `/var` -> `/private/var` doesn't trip
  // the containment check.
  projectRoot: "/absolute/path/to/astro/project",

  // Opt in to absolute `source` paths. Default: false.
  // Required for tests using tmpdir, monorepo data outside the project root,
  // or any controlled call site. Do NOT enable when frontmatter values can
  // come from untrusted content (CMS-supplied entries, user uploads).
  allowAbsolutePaths: true,
};

await buildFeatureMapConfig({ ref, loadOptions }, globalConfig);
```

The same `loadOptions` flows through `buildMapConfigFromEntry` and `loadFeatureFile`.

Path-traversal protection rejects relative `source` values that escape the project root via `..`. Symlinks that live inside the project root but canonicalize OUTSIDE it are also rejected (a post-realpath containment re-check catches this). Absolute paths are rejected unless `allowAbsolutePaths: true` is passed.

### Error classes

The builder throws one of two error classes:

```typescript
import {
  buildFeatureMapConfig,
  GeoJSONLoadError,
  InvalidFeatureRefError,
} from "@maplibre-yaml/astro";

try {
  await buildFeatureMapConfig({ ref }, globalConfig);
} catch (err) {
  if (err instanceof InvalidFeatureRefError) {
    // Thrown when the ref has neither or both of `featureId` and `match`.
    // Discriminable via instanceof (not wrapped by buildFeatureMapConfig).
  } else if (err instanceof GeoJSONLoadError) {
    // Thrown for everything else: missing file/feature, malformed JSON,
    // unsupported geometry, path-traversal violation, absolute-path
    // rejection, file too large, degenerate LineString, heterogeneous
    // GeometryCollection. `.message` carries the actionable message;
    // `.filePath` carries the resolved path; ES2022 `.cause` carries the
    // underlying fs/parse error when applicable.
  }
}
```

### Build-time only

`buildFeatureMapConfig` reads from the local filesystem via `process.cwd()` (or the configured `projectRoot`). It is **build-time only** -- invoking it in a deployed SSR adapter context throws a `GeoJSONLoadError` whose ENOENT message includes deployment-context hints. Runtime resolution is a planned V2 feature.

### Performance budget (V1)

| File size | Behavior |
|-----------|---------|
| < 10MB | Fully supported, no caveats |
| 10-50MB | Supported; one-time parse cost noted |
| 50-100MB | Build-time warning |
| > 100MB | Hard error directing toward PMTiles or splitting |

Files referenced multiple times across collection items are parsed once via an mtime-aware cache. Editing the GeoJSON in `astro dev` invalidates the cache so the next page request picks up the new contents -- no server restart needed. **Manual page refresh is still required**: the file is read via `fs.readFile`, not imported through Vite's module graph, so Vite cannot auto-trigger an HMR re-render. Full Vite-graph integration is planned for V2. For files with 200+ features, a per-property index is built lazily on the second access for that property.

### Ignored style overrides

`FeatureRef` accepts every style field (`markerColor`, `fillColor`, `strokeColor`, `fillOpacity`, `color`, `width`) because the geometry type is not known when the schema parses -- it's resolved when the file loads. When a field doesn't apply to the resolved geometry (e.g., `markerColor` on a Polygon ref), the builder ignores it and emits a one-time `console.warn` during `astro dev`:

```
feature_ref: style override(s) [markerColor, width] do not apply to Polygon geometry from "./src/data/sample.geojson"; they will be ignored.
```

Warnings are deduplicated per `(source, geometryType, ignored-keys)` so reloading the page won't re-emit them. Restarting `astro dev` clears the dedupe cache.

### Lower-level primitives

For advanced cases (e.g., loading one file once and dispatching to many features manually):

```typescript
import {
  loadFeatureFile,
  findFeature,
  GeoJSONLoadError,
  clearFeatureCache,
} from "@maplibre-yaml/astro";

const fc = await loadFeatureFile("./src/data/gowanus.geojson");
const feature = findFeature(fc, { source: "...", featureId: "poa-1.1" });
// Then dispatch manually with the existing sync builders
```

`clearFeatureCache()` is exported for test isolation between files that share absolute paths.

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
import { getMapSchema, getScrollytellingSchema } from '@maplibre-yaml/astro/utils';

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
} from '@maplibre-yaml/astro/utils';

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
// In src/content/config.ts -- use /utils subpath for content schemas
import { extendSchema, getMapSchema } from '@maplibre-yaml/astro/utils';
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
