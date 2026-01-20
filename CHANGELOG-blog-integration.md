# Blog Integration Implementation - v0.1.0 Alpha

## Summary

This update adds support for embedding maps in Astro blog posts with minimal configuration. The implementation follows the principle of documenting patterns rather than adding excessive abstractions.

## Changes

### @maplibre-yaml/core

#### Schema Changes

**`packages/core/src/schemas/map.schema.ts`**
- Made `mapStyle` optional in `MapConfigSchema` to enable inheritance from global `config.defaultMapStyle`
- Updated TSDoc to document the inheritance pattern

#### New Utilities

**`packages/core/src/utils/config-resolver.ts`** (NEW)
- `resolveMapConfig()` - Resolves map config with global defaults
- `resolveMapBlock()` - Resolves complete MapBlock with global defaults
- `isMapConfigComplete()` - Checks if config has all required fields
- `createSimpleMapConfig()` - Creates map config with sensible defaults
- `ConfigResolutionError` - Error class for resolution failures

#### Export Updates

**`packages/core/src/schemas/index.ts`**
- Added type exports for `MapConfig`, `MapBlock`, `GlobalConfig`, etc.

**`packages/core/src/utils/index.ts`**
- Exports config resolution utilities

**`packages/core/src/index.ts`**
- Exports config resolution utilities at package level

### @maplibre-yaml/astro

#### New Blog Schemas

**`packages/astro/src/utils/blog-schemas.ts`** (NEW)
- `getBlogWithLocationSchema()` - Single location posts (restaurants, place reviews)
- `getBlogWithLocationsSchema()` - Multiple locations (travel itineraries)
- `getBlogWithRegionSchema()` - Polygon regions (neighborhood guides)
- `getBlogWithRouteSchema()` - Routes/trails (hiking, road trips)
- `getBlogWithGeoSchema()` - Flexible schema with all geo types
- Type exports: `LocationPoint`, `RegionPolygon`, `RouteLine`

#### New Map Builders

**`packages/astro/src/utils/map-builders.ts`** (NEW)
- `buildPointMapConfig()` - Creates MapBlock from single location
- `buildMultiPointMapConfig()` - Creates MapBlock from multiple locations
- `buildPolygonMapConfig()` - Creates MapBlock from polygon region
- `buildRouteMapConfig()` - Creates MapBlock from route/line
- `calculateCenter()` - Calculates center of coordinates
- `calculateBounds()` - Calculates bounding box

#### Export Updates

**`packages/astro/src/utils/index.ts`**
- Exports all blog schema functions and types
- Exports all map builder functions and types

**`packages/astro/src/index.ts`**
- Exports blog utilities at package level for direct import

### Documentation

**`docs/src/content/docs/guides/blog-integration.mdx`** (NEW)
- Complete guide for blog integration patterns
- Schema selection guide with examples
- Map builder usage examples
- Global configuration pattern
- Complete blog template example
- Best practices and tips

## Usage Examples

### Content Collection Setup

```typescript
// src/content/config.ts
import { defineCollection } from 'astro:content';
import { getBlogWithLocationSchema } from '@maplibre-yaml/astro';

export const collections = {
  posts: defineCollection({
    type: 'content',
    schema: getBlogWithLocationSchema()
  })
};
```

### Blog Post Frontmatter

```yaml
---
title: "Best Coffee in Brooklyn"
pubDate: 2024-03-15
location:
  coordinates: [-73.9857, 40.6892]
  name: "Devoción Coffee"
  zoom: 16
---
```

### Rendering Maps

```astro
---
import { Map, buildPointMapConfig } from '@maplibre-yaml/astro';

const { location } = Astro.props.post.data;

const mapConfig = location 
  ? buildPointMapConfig({
      location,
      mapStyle: 'https://demotiles.maplibre.org/style.json'
    })
  : null;
---

{mapConfig && <Map config={mapConfig} height="300px" />}
```

### Global Configuration Pattern

```typescript
// src/lib/map-config.ts
export const globalMapConfig = {
  mapStyle: 'https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY',
};

// In pages
import { globalMapConfig } from '../lib/map-config';
const config = buildPointMapConfig({
  location,
  mapStyle: globalMapConfig.mapStyle
});
```

## Design Decisions

1. **No BlogMap Component**: Rather than adding another abstraction layer, we documented patterns that use the existing `<Map>` component with builder utilities.

2. **Optional mapStyle**: Making `mapStyle` optional in the schema enables the global inheritance pattern without breaking existing configurations.

3. **Builder Functions Over Components**: The map builder functions (`buildPointMapConfig`, etc.) generate standard MapBlock configurations that work with the existing Map component.

4. **Explicit Global Config**: For v0.1.0, global configuration is handled via a documented pattern (shared config module) rather than framework magic (Astro integration injection).

## Migration Notes

- Existing configurations with explicit `mapStyle` continue to work unchanged
- The schema change is backward compatible
- No breaking changes to the public API

## Future Considerations (v0.2.0+)

- Astro integration for automatic global config injection
- Enhanced Map component props for simplified usage
- Additional geometry helpers as usage patterns emerge
