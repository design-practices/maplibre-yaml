# Embedding Maps in Astro Blog Posts

This guide covers multiple patterns for integrating location-based maps into blog posts or other content collections in Astro using `@maplibre-yaml/astro`.

## Common Use Case

You have a blog or content site where individual posts reference specific locations (e.g., restaurant reviews, travel posts, event coverage, property listings). Each post should display:

1. The blog content (text, images)
2. An embedded map showing the location
3. A marker with a popup containing location details
4. Consistent styling across all location maps

## Pattern 1: Simple Location Metadata (Recommended)

**Best for:** Simple location markers, consistent styling, minimal configuration

Store location data directly in your blog post frontmatter and generate maps dynamically at build time.

### Content Collection Schema

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

export const collections = {
  blog: defineCollection({
    type: 'content',
    schema: z.object({
      title: z.string(),
      pubDate: z.date(),
      description: z.string(),
      author: z.string(),
      image: z.string().optional(),
      tags: z.array(z.string()).default([]),

      // Map location data
      location: z.object({
        coordinates: z.tuple([z.number(), z.number()]), // [longitude, latitude]
        zoom: z.number().default(12),
        title: z.string().optional(),
        description: z.string().optional(),
      }).optional(),
    }),
  }),
};
```

### Blog Post Example

```markdown
---
# src/content/blog/coffee-shop-review.md
title: "Best Coffee Shop in Portland"
pubDate: 2024-01-15
description: "A hidden gem in the Pearl District"
author: "Jane Doe"
tags: ["coffee", "portland", "review"]
location:
  coordinates: [-122.6765, 45.5231]
  zoom: 14
  title: "Coava Coffee"
  description: "Amazing pour-over and pastries"
---

This coffee shop exceeded all my expectations. The atmosphere is cozy,
the baristas are knowledgeable, and the coffee is exceptional...
```

### Page Template

```astro
---
// src/pages/blog/[...slug].astro
import { getCollection } from 'astro:content';
import { Map } from '@maplibre-yaml/astro';
import Layout from '../../layouts/BlogLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await post.render();

// Generate map config dynamically if location exists
const mapConfig = post.data.location ? {
  version: "1.0",
  map: {
    style: "https://demotiles.maplibre.org/style.json", // Your global style URL
    center: post.data.location.coordinates,
    zoom: post.data.location.zoom,
  },
  sources: {
    point: {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: post.data.location.coordinates
        },
        properties: {
          title: post.data.location.title || post.data.title,
          description: post.data.location.description || post.data.description
        }
      }
    }
  },
  layers: [
    {
      id: "point-marker",
      type: "circle",
      source: "point",
      paint: {
        "circle-radius": 8,
        "circle-color": "#3b82f6",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      },
      interactive: {
        popup: {
          content: [
            { tag: "h3", content: "{title}" },
            { tag: "p", content: "{description}" }
          ]
        }
      }
    }
  ]
} : null;
---

<Layout title={post.data.title}>
  <article>
    <header>
      <h1>{post.data.title}</h1>
      <p class="byline">
        By {post.data.author} on {post.data.pubDate.toLocaleDateString()}
      </p>
      {post.data.tags.length > 0 && (
        <div class="tags">
          {post.data.tags.map(tag => <span class="tag">{tag}</span>)}
        </div>
      )}
    </header>

    {mapConfig && (
      <div class="map-container">
        <Map config={mapConfig} height="400px" />
      </div>
    )}

    <div class="content">
      <Content />
    </div>
  </article>
</Layout>

<style>
  .map-container {
    margin: 2rem 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
</style>
```

### Pros
- ✅ Simple to implement
- ✅ All data in one place (frontmatter)
- ✅ No external YAML files needed
- ✅ Type-safe with Zod validation
- ✅ Fast build times

### Cons
- ❌ Map config generated in template (less reusable)
- ❌ Harder to customize per-post without modifying template
- ❌ Can't share maps between posts easily

---

## Pattern 2: Separate Map Collection with References

**Best for:** Reusable maps, complex map configurations, sharing maps across posts

Create a separate `maps` collection and reference maps from blog posts.

### Content Collection Schema

```typescript
// src/content/config.ts
import { defineCollection, z, reference } from 'astro:content';
import { getSimpleMapSchema } from '@maplibre-yaml/astro/utils';

export const collections = {
  blog: defineCollection({
    type: 'content',
    schema: z.object({
      title: z.string(),
      pubDate: z.date(),
      description: z.string(),
      author: z.string(),
      map: reference('maps').optional(), // Reference to maps collection
    }),
  }),

  maps: defineCollection({
    type: 'data',
    schema: getSimpleMapSchema(), // Pre-built schema from @maplibre-yaml/astro
  }),
};
```

### Map Configuration File

```yaml
# src/content/maps/portland-coffee.yaml
version: "1.0"
map:
  style: "https://demotiles.maplibre.org/style.json"
  center: [-122.6765, 45.5231]
  zoom: 14

sources:
  location:
    type: geojson
    data:
      type: Feature
      geometry:
        type: Point
        coordinates: [-122.6765, 45.5231]
      properties:
        title: "Coava Coffee"
        description: "Amazing pour-over and pastries"

layers:
  - id: marker
    type: circle
    source: location
    paint:
      circle-radius: 8
      circle-color: "#3b82f6"
      circle-stroke-width: 2
      circle-stroke-color: "#ffffff"
    interactive:
      popup:
        content:
          - tag: h3
            content: "{title}"
          - tag: p
            content: "{description}"
```

### Blog Post Example

```markdown
---
# src/content/blog/coffee-shop-review.md
title: "Best Coffee Shop in Portland"
pubDate: 2024-01-15
description: "A hidden gem in the Pearl District"
author: "Jane Doe"
map: portland-coffee  # Reference to maps/portland-coffee.yaml
---

This coffee shop exceeded all my expectations...
```

### Page Template

```astro
---
// src/pages/blog/[...slug].astro
import { getCollection, getEntry } from 'astro:content';
import { Map } from '@maplibre-yaml/astro';
import Layout from '../../layouts/BlogLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await post.render();

// Load referenced map if it exists
const mapData = post.data.map
  ? await getEntry(post.data.map)
  : null;
---

<Layout title={post.data.title}>
  <article>
    <header>
      <h1>{post.data.title}</h1>
      <p class="byline">
        By {post.data.author} on {post.data.pubDate.toLocaleDateString()}
      </p>
    </header>

    {mapData && (
      <div class="map-container">
        <Map config={mapData.data} height="400px" />
      </div>
    )}

    <div class="content">
      <Content />
    </div>
  </article>
</Layout>
```

### Reusing Maps Across Posts

```markdown
---
# src/content/blog/coffee-guide.md
title: "Portland Coffee Guide"
map: portland-coffee  # Same map as coffee-shop-review.md
---

---
# src/content/blog/neighborhood-tour.md
title: "Pearl District Walking Tour"
map: portland-coffee  # Reused again
---
```

### Pros
- ✅ Reusable maps across multiple posts
- ✅ Clean separation of concerns
- ✅ Full YAML configuration power
- ✅ Easy to share complex maps
- ✅ Type-safe with Astro references

### Cons
- ❌ More files to manage
- ❌ Requires understanding of map YAML syntax
- ❌ Can be overkill for simple location markers

---

## Pattern 3: Helper Function for Consistent Map Generation

**Best for:** Standardized styling, DRY code, team consistency

Create a utility function that generates map configurations with consistent styling.

### Helper Function

```typescript
// src/utils/mapHelpers.ts
import type { MapBlock } from '@maplibre-yaml/core';

export interface LocationMapOptions {
  coordinates: [number, number]; // [longitude, latitude]
  title: string;
  description?: string;
  zoom?: number;
  markerColor?: string;
  globalStyle?: string;
  markerIcon?: 'circle' | 'symbol'; // Extensible
}

/**
 * Generate a standardized location map configuration
 *
 * @example
 * ```typescript
 * const map = createLocationMap({
 *   coordinates: [-122.6765, 45.5231],
 *   title: "Coava Coffee",
 *   description: "Best coffee in town",
 *   zoom: 14
 * });
 * ```
 */
export function createLocationMap(options: LocationMapOptions): MapBlock {
  const {
    coordinates,
    title,
    description,
    zoom = 12,
    markerColor = "#3b82f6",
    globalStyle = "https://demotiles.maplibre.org/style.json",
    markerIcon = 'circle'
  } = options;

  return {
    version: "1.0",
    map: {
      style: globalStyle,
      center: coordinates,
      zoom,
    },
    sources: {
      location: {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates
          },
          properties: { title, description }
        }
      }
    },
    layers: [
      {
        id: "location-marker",
        type: markerIcon,
        source: "location",
        paint: markerIcon === 'circle' ? {
          "circle-radius": 8,
          "circle-color": markerColor,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        } : {
          "text-color": markerColor
        },
        interactive: {
          popup: {
            content: [
              { tag: "h3", content: "{title}" },
              ...(description ? [{ tag: "p", content: "{description}" }] : [])
            ]
          }
        }
      }
    ]
  };
}

/**
 * Create a map with multiple locations
 */
export function createMultiLocationMap(
  locations: Array<{ coordinates: [number, number]; title: string; description?: string }>,
  options: { zoom?: number; center?: [number, number]; style?: string } = {}
): MapBlock {
  const {
    zoom = 10,
    center = locations[0]?.coordinates || [0, 0],
    style = "https://demotiles.maplibre.org/style.json"
  } = options;

  return {
    version: "1.0",
    map: { style, center, zoom },
    sources: {
      locations: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: locations.map((loc, idx) => ({
            type: "Feature",
            id: idx,
            geometry: {
              type: "Point",
              coordinates: loc.coordinates
            },
            properties: {
              title: loc.title,
              description: loc.description
            }
          }))
        }
      }
    },
    layers: [
      {
        id: "location-markers",
        type: "circle",
        source: "locations",
        paint: {
          "circle-radius": 8,
          "circle-color": "#3b82f6",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        },
        interactive: {
          popup: {
            content: [
              { tag: "h3", content: "{title}" },
              { tag: "p", content: "{description}" }
            ]
          }
        }
      }
    ]
  };
}
```

### Content Schema (Same as Pattern 1)

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

export const collections = {
  blog: defineCollection({
    type: 'content',
    schema: z.object({
      title: z.string(),
      pubDate: z.date(),
      location: z.object({
        coordinates: z.tuple([z.number(), z.number()]),
        zoom: z.number().default(12),
        title: z.string().optional(),
        description: z.string().optional(),
      }).optional(),
    }),
  }),
};
```

### Page Template

```astro
---
// src/pages/blog/[...slug].astro
import { getCollection } from 'astro:content';
import { Map } from '@maplibre-yaml/astro';
import { createLocationMap } from '../../utils/mapHelpers';
import Layout from '../../layouts/BlogLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await post.render();

// Generate map using helper function
const mapConfig = post.data.location
  ? createLocationMap({
      coordinates: post.data.location.coordinates,
      title: post.data.location.title || post.data.title,
      description: post.data.location.description,
      zoom: post.data.location.zoom,
      globalStyle: "https://your-custom-style.com/style.json", // Consistent style
      markerColor: "#e11d48", // Brand color
    })
  : null;
---

<Layout title={post.data.title}>
  <article>
    <h1>{post.data.title}</h1>

    {mapConfig && <Map config={mapConfig} height="400px" />}

    <Content />
  </article>
</Layout>
```

### Global Configuration

```typescript
// src/config/maps.ts
export const GLOBAL_MAP_STYLE = "https://your-cdn.com/map-style.json";
export const BRAND_COLOR = "#e11d48";
export const DEFAULT_ZOOM = 12;

// Use in helper calls
import { GLOBAL_MAP_STYLE, BRAND_COLOR, DEFAULT_ZOOM } from '@/config/maps';

const map = createLocationMap({
  coordinates: coords,
  title: title,
  globalStyle: GLOBAL_MAP_STYLE,
  markerColor: BRAND_COLOR,
  zoom: DEFAULT_ZOOM,
});
```

### Pros
- ✅ Consistent styling across all maps
- ✅ DRY (Don't Repeat Yourself)
- ✅ Easy to update global settings
- ✅ Type-safe helper functions
- ✅ Can extend with custom logic
- ✅ Testable utilities

### Cons
- ❌ Requires writing utility code
- ❌ May need updates if map requirements change significantly

---

## Pattern 4: Hybrid Approach (Best of All Worlds)

**Best for:** Maximum flexibility with good defaults

Combine patterns for different use cases within the same site.

### Configuration

```typescript
// src/content/config.ts
import { defineCollection, z, reference } from 'astro:content';
import { getSimpleMapSchema } from '@maplibre-yaml/astro/utils';

export const collections = {
  blog: defineCollection({
    type: 'content',
    schema: z.object({
      title: z.string(),
      pubDate: z.date(),

      // Option 1: Simple location (uses helper)
      location: z.object({
        coordinates: z.tuple([z.number(), z.number()]),
        zoom: z.number().default(12),
        title: z.string().optional(),
        description: z.string().optional(),
      }).optional(),

      // Option 2: Reference complex map
      map: reference('maps').optional(),
    }),
  }),

  maps: defineCollection({
    type: 'data',
    schema: getSimpleMapSchema(),
  }),
};
```

### Page Template with Fallback Logic

```astro
---
import { getCollection, getEntry } from 'astro:content';
import { Map } from '@maplibre-yaml/astro';
import { createLocationMap } from '../../utils/mapHelpers';

const { post } = Astro.props;
const { Content } = await post.render();

// Priority: referenced map > location > none
let mapConfig = null;

if (post.data.map) {
  // Use referenced complex map
  const mapData = await getEntry(post.data.map);
  mapConfig = mapData.data;
} else if (post.data.location) {
  // Generate simple location map
  mapConfig = createLocationMap({
    coordinates: post.data.location.coordinates,
    title: post.data.location.title || post.data.title,
    description: post.data.location.description,
    zoom: post.data.location.zoom,
  });
}
---

<article>
  <h1>{post.data.title}</h1>
  {mapConfig && <Map config={mapConfig} height="400px" />}
  <Content />
</article>
```

### Usage Examples

```markdown
---
# Simple location marker (Pattern 1 + 3)
title: "Quick Review"
location:
  coordinates: [-122.6765, 45.5231]
  title: "Coffee Shop"
---

---
# Complex custom map (Pattern 2)
title: "Detailed Analysis"
map: custom-data-visualization
---

---
# No map
title: "Opinion Piece"
---
```

### Pros
- ✅ Flexibility for different content types
- ✅ Simple default, complex when needed
- ✅ One template handles all cases
- ✅ Easy migration path (start simple, add complexity)

### Cons
- ❌ More complex template logic
- ❌ Multiple ways to do the same thing (can confuse editors)

---

## Recommendation Matrix

| Use Case | Recommended Pattern | Why |
|----------|-------------------|-----|
| Simple blog with location markers | Pattern 1 + 3 | Lightweight, consistent, easy to use |
| Complex data visualizations | Pattern 2 | Full YAML power, reusable configs |
| Team with non-technical editors | Pattern 1 | Simple frontmatter, no YAML files |
| Need to share maps across posts | Pattern 2 | DRY, centralized map configs |
| Want maximum flexibility | Pattern 4 | Best of all patterns |
| Site with global brand styling | Pattern 3 | Consistent styling via helpers |

---

## Advanced: Custom Map Component Wrapper

Create a blog-specific map component with opinionated defaults:

```astro
---
// src/components/BlogMap.astro
import { Map } from '@maplibre-yaml/astro';
import { createLocationMap } from '../utils/mapHelpers';
import type { LocationMapOptions } from '../utils/mapHelpers';

interface Props {
  location?: LocationMapOptions;
  config?: any; // MapBlock
  height?: string;
  className?: string;
}

const { location, config, height = "400px", className = "" } = Astro.props;

const mapConfig = config || (location ? createLocationMap(location) : null);
---

{mapConfig && (
  <div class={`blog-map ${className}`}>
    <Map config={mapConfig} height={height} />
  </div>
)}

<style>
  .blog-map {
    margin: 2rem 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .blog-map :global(ml-map) {
    border: 1px solid #e5e7eb;
  }
</style>
```

**Usage:**

```astro
---
import BlogMap from '@/components/BlogMap.astro';

// Simple location
---
<BlogMap location={{
  coordinates: [-122.6765, 45.5231],
  title: "Location",
  zoom: 14
}} />

<!-- Or with full config -->
<BlogMap config={customMapConfig} />
```

---

## Migration Path

### Starting Simple (Day 1)
1. Use Pattern 1 (location in frontmatter)
2. Generate maps inline in template
3. Get content flowing quickly

### Adding Consistency (Week 2)
1. Extract to Pattern 3 (helper functions)
2. Centralize styling
3. Team learns one pattern

### Scaling Up (Month 3)
1. Add Pattern 2 for complex maps
2. Migrate some content to use references
3. Now have flexibility for both simple and complex

### Enterprise (Month 6+)
1. Implement Pattern 4 (hybrid)
2. Custom BlogMap component
3. Documentation for editors
4. Map preview in CMS

---

## Additional Resources

- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)
- [@maplibre-yaml/astro Documentation](https://maplibre-yaml.design-practices.com/integrations/astro/)
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/)
- [GeoJSON Specification](https://geojson.org/)

---

## Questions to Consider

1. **How technical are your content editors?**
   - Non-technical → Pattern 1
   - Technical → Pattern 2 or 4

2. **Will maps be reused across posts?**
   - Yes → Pattern 2
   - No → Pattern 1 or 3

3. **Do you need consistent styling?**
   - Yes → Pattern 3 (required) + 1 or 4
   - No → Any pattern works

4. **How complex will your maps be?**
   - Simple markers → Pattern 1 + 3
   - Data visualizations → Pattern 2

5. **How many posts will have maps?**
   - Most/all → Pattern 3 for consistency
   - Few → Pattern 1 for simplicity

6. **Do you want to change global map styling easily?**
   - Yes → Pattern 3 with config file
   - No → Inline styles okay
