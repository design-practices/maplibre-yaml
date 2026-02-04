# @maplibre-yaml/astro

Astro components for creating interactive maps and scrollytelling experiences using YAML configuration.

## Features

- 🗺️ **Declarative Maps** - Define maps with simple YAML syntax
- 📖 **Scrollytelling** - Create narrative map stories with chapter-based transitions
- ⚡ **Build-Time or Runtime** - Load YAML at build time or runtime
- 🎨 **Customizable** - Full control over styling and behavior
- ♿ **Accessible** - ARIA labels, keyboard navigation, screen reader support
- 📱 **Responsive** - Mobile-optimized components
- 🔒 **Type-Safe** - Full TypeScript support with Zod validation

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

**Example:**

```astro
<FullPageMap
  src="/configs/world-map.yaml"
  showLegend
  legendPosition="top-right"
/>
```

### Scrollytelling

Immersive narrative experiences with scroll-driven map transitions.

**Props:**
- `src?: string` - Path to YAML story config
- `config?: ScrollytellingBlock` - Pre-loaded story configuration
- `class?: string` - Additional CSS classes
- `debug?: boolean` - Show debug outlines

**Example:**

```astro
---
import { Scrollytelling, loadScrollytellingConfig } from '@maplibre-yaml/astro';
const story = await loadScrollytellingConfig('./src/stories/climate.yaml');
---
<Scrollytelling config={story} />
```

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

## Utilities

### loadMapConfig

Load and validate a map configuration from a YAML file at build time.

```typescript
import { loadMapConfig } from '@maplibre-yaml/astro';

const config = await loadMapConfig('./src/configs/map.yaml');
```

### loadScrollytellingConfig

Load and validate a scrollytelling story from a YAML file.

```typescript
import { loadScrollytellingConfig } from '@maplibre-yaml/astro';

const story = await loadScrollytellingConfig('./src/stories/earthquake.yaml');
```

### loadFromGlob

Load multiple YAML files using Astro's glob patterns.

```typescript
import { loadFromGlob } from '@maplibre-yaml/astro';

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

## YAML Configuration

### Map Configuration

```yaml
version: "1.0"
map:
  style: "https://demotiles.maplibre.org/style.json"
  center: [-122.4, 37.8]
  zoom: 12
  pitch: 0
  bearing: 0

sources:
  points:
    type: geojson
    data: "/data/points.geojson"

layers:
  - id: points-layer
    type: circle
    source: points
    paint:
      circle-radius: 8
      circle-color: "#3b82f6"
```

### Scrollytelling Configuration

```yaml
version: "1.0"
id: my-story
theme: dark
showMarkers: true
markerColor: "#3FB1CE"

config:
  style: "https://demotiles.maplibre.org/style.json"
  center: [0, 0]
  zoom: 2

chapters:
  - id: intro
    title: "Introduction"
    description: "<p>Welcome to the story.</p>"
    center: [0, 0]
    zoom: 2
    alignment: center

  - id: detail
    title: "The Details"
    description: "<p>Here's what happened.</p>"
    image: "/images/detail.jpg"
    center: [10, 10]
    zoom: 8
    pitch: 45
    bearing: 30
    animation: flyTo
    speed: 0.8
    alignment: left

footer: "<p>&copy; 2024 Your Organization</p>"
```

## Advanced Features

### Chapter Actions

Execute MapLibre actions on chapter enter/exit:

```yaml
chapters:
  - id: filtered
    title: "Filtered View"
    center: [0, 0]
    zoom: 5
    onChapterEnter:
      - action: setFilter
        layer: data-layer
        filter: [">=", "value", 100]
      - action: setPaintProperty
        layer: data-layer
        property: circle-color
        value: "#ff0000"
    onChapterExit:
      - action: setFilter
        layer: data-layer
        filter: null
```

### Layer Visibility Control

Show/hide layers per chapter:

```yaml
chapters:
  - id: chapter1
    title: "Phase 1"
    center: [0, 0]
    zoom: 5
    layers:
      show: [layer-1, layer-2]
      hide: [layer-3]
```

### Custom Schemas

Extend schemas with custom metadata:

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

The package includes comprehensive error handling:

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
  ChapterProps
} from '@maplibre-yaml/astro';
```

## Browser Support

- Modern browsers with ES2020+ support
- MapLibre GL JS 4.0+
- WebGL-enabled browsers

## Performance Tips

1. **Use build-time loading** for better performance:
   ```astro
   const config = await loadMapConfig('./src/configs/map.yaml');
   ```

2. **Optimize images**: Compress chapter images and use appropriate formats

3. **Limit scrollytelling chapters**: 5-10 chapters for best experience

4. **Use jumpTo for instant transitions** on slower devices

5. **Lazy load media**: Images and videos load only when needed

## License

MIT

## Links

- [Documentation](https://maplibre-yaml.design-practices.com/integrations/astro/)
- [GitHub Repository](https://github.com/design-practices/maplibre-yaml)
- [MapLibre GL JS](https://maplibre.org/)
- [Astro](https://astro.build/)
