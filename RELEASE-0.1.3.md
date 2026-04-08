# Release Notes & Migration Guide: v0.1.3

## Package Status

| Package | npm Version | Status |
|---------|------------|--------|
| `@maplibre-yaml/astro` | `0.1.2` | Published (stable) |
| `@maplibre-yaml/core` | `0.1.3-beta.1` | Needs promotion to `0.1.3` stable |

## Remaining Publish Step: Promote Core to Stable

The astro package (`0.1.2`) was published with a peer dependency on `@maplibre-yaml/core@0.1.3-beta.1`. The core package has no code changes but should be promoted from beta to stable for consistency.

```bash
cd packages/core
npm version 0.1.3 --allow-same-version
pnpm build
npm publish --access public
cd ../..
git add -A && git commit -m "release: @maplibre-yaml/core v0.1.3"
```

> `npm publish` will prompt for a one-time password (OTP) from your authenticator app if 2FA is enabled on your npm account. The `workspace:*` references in local `package.json` files are resolved to real version numbers automatically by pnpm at publish time.

---

## What Changed in the Library

### Bug Fix: `ReferenceError: HTMLElement is not defined` (astro package)

**Root cause**: The `Map`, `FullPageMap`, and `Scrollytelling` components imported `@maplibre-yaml/core/register` in their Astro frontmatter (`---` block). Astro frontmatter runs server-side in Node.js, where `HTMLElement` does not exist. The register module defines `class MLMap extends HTMLElement`, which crashes at module evaluation time.

**Fix**: Moved the import from frontmatter to a bundled `<script>` tag in the template. Astro processes `<script>` tags (without `is:inline`) as client-side bundles that only execute in the browser.

**Files changed**:
- `packages/astro/src/components/Map.astro`
- `packages/astro/src/components/FullPageMap.astro`
- `packages/astro/src/components/Scrollytelling.astro`

No changes were required in `@maplibre-yaml/core`.

---

## Implementation Guide for the Production Project

### 1. Update dependencies

In your production project's `package.json`, update to the stable versions:

```json
{
  "dependencies": {
    "@maplibre-yaml/astro": "^0.1.2",
    "@maplibre-yaml/core": "^0.1.3",
    "maplibre-gl": "^5.18.0"
  }
}
```

Then run:

```bash
pnpm install
```

### 2. Create a global map config

**New file: `src/config/maps.yaml`**

```yaml
title: "Gowanus Oversight Task Force"
defaultMapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
defaultCenter: [-73.985, 40.674]
defaultZoom: 14
theme: light
```

**New file: `src/lib/map-config.ts`**

```typescript
import { loadGlobalMapConfig } from "@maplibre-yaml/astro";

export const globalMapConfig = await loadGlobalMapConfig(
  "./src/config/maps.yaml"
);
```

This provides shared defaults (basemap style, center, zoom) that all maps inherit. Individual maps can override any of these values.

### 3. Update the content collection schema

**`src/content/config.ts`** -- add geographic fields to the POA schema:

```typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import {
  LocationPointSchema,
  RegionPolygonSchema,
  RouteLineSchema,
} from "@maplibre-yaml/astro";

const poas = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/poas" }),
  schema: z.object({
    // ... existing fields ...

    // Geographic data (all optional - POAs without geo data get the default Gowanus map)
    location: LocationPointSchema.optional(),  // point geometry
    region: RegionPolygonSchema.optional(),     // polygon geometry
    route: RouteLineSchema.optional(),          // line geometry
  }),
});
```

All three fields are optional. POAs without any geographic data still work -- they get the default Gowanus neighborhood map.

### 4. Fix the commitments page

**`src/pages/commitments.astro`**

**Before (broken):**
```astro
---
import { Map } from '@maplibre-yaml/astro';
---
<Map client:only="react" src="public/my-map.yaml" height="400px" />
```

**After (working):**
```astro
---
import { Map, buildPointMapConfig } from "@maplibre-yaml/astro";
import { globalMapConfig } from "../lib/map-config";

const gowanusMapConfig = buildPointMapConfig(
  {
    location: {
      coordinates: [-73.985, 40.674],
      name: "Gowanus Neighborhood",
      description: "Gowanus Rezoning Area, Brooklyn, NYC",
    },
    zoom: 14,
  },
  globalMapConfig,
);
---
<Map config={gowanusMapConfig} height="500px" />
```

### 5. Add dynamic maps to POA detail pages

**`src/pages/poas/[poas].astro`** -- detect which geometry type is present and build the right map config:

```astro
---
import {
  Map,
  buildPointMapConfig,
  buildPolygonMapConfig,
  buildRouteMapConfig,
} from "@maplibre-yaml/astro";
import type { MapBlock } from "@maplibre-yaml/core";
import { globalMapConfig } from "../../lib/map-config";

// ... load poa data ...

const poaLabel = `POA #${poas}`;
const poaDescription = `${poa.gotf_id} - ${poa.poa_description}`;

let poaMapConfig: MapBlock;

if (poa.region) {
  poaMapConfig = buildPolygonMapConfig(
    {
      region: {
        ...poa.region,
        name: poa.region.name ?? poaLabel,
        description: poa.region.description ?? poaDescription,
      },
    },
    globalMapConfig,
  );
} else if (poa.route) {
  poaMapConfig = buildRouteMapConfig(
    {
      route: {
        ...poa.route,
        name: poa.route.name ?? poaLabel,
        description: poa.route.description ?? poaDescription,
      },
    },
    globalMapConfig,
  );
} else if (poa.location) {
  poaMapConfig = buildPointMapConfig(
    {
      location: {
        ...poa.location,
        name: poa.location.name ?? poaLabel,
        description: poa.location.description ?? poaDescription,
      },
    },
    globalMapConfig,
  );
} else {
  // Fallback: default Gowanus neighborhood map
  poaMapConfig = buildPointMapConfig(
    {
      location: {
        coordinates: [-73.985, 40.674],
        name: poaLabel,
        description: poaDescription,
      },
      zoom: 14,
    },
    globalMapConfig,
  );
}
---
<Map config={poaMapConfig} height="300px" />
```

### 6. Add geographic data to POA frontmatter

Add `location`, `region`, or `route` to any POA's markdown frontmatter. All are optional.

**Point** (e.g., a specific building or site):
```yaml
location:
  coordinates: [-73.9826, 40.6725]
  name: "Mercy Home (487 4th Avenue)"
  zoom: 16
  markerColor: "#e74c3c"
```

**Polygon** (e.g., a park or zone boundary):
```yaml
region:
  name: "Thomas Greene Playground"
  coordinates:
    - - [-73.9848, 40.6748]
      - [-73.9833, 40.6748]
      - [-73.9833, 40.6738]
      - [-73.9848, 40.6738]
      - [-73.9848, 40.6748]
  fillColor: "#2ecc71"
  fillOpacity: 0.35
```

**Line** (e.g., a canal, road, or infrastructure path):
```yaml
route:
  name: "Gowanus Canal"
  coordinates:
    - [-73.9890, 40.6790]
    - [-73.9870, 40.6760]
    - [-73.9855, 40.6730]
    - [-73.9840, 40.6700]
  color: "#3498db"
  width: 4
```

---

## Gotchas to Avoid

| Mistake | Why It Fails | Correct Usage |
|---------|-------------|---------------|
| `<Map client:only="react" ...>` | `Map` is an Astro component, not React. `client:*` directives are for framework components only. | `<Map config={mapConfig} height="500px" />` |
| `import "@maplibre-yaml/core/register"` in frontmatter | `HTMLElement` doesn't exist in Node.js. The Astro components handle registration automatically via client-side script. | Don't import it -- the components do it for you. |
| `src="public/my-map.yaml"` | The `src` prop expects a URL path, not a filesystem path. Files in `public/` are served at the root. | `src="/my-map.yaml"` |
| Using `src` prop for collection-driven maps | The `src` prop fetches YAML at runtime. For build-time data (collections), use the `config` prop with map builders. | `<Map config={buildPointMapConfig(opts, globalConfig)} />` |
| Forgetting `mapStyle` with no global config | `buildPointMapConfig` requires `mapStyle` either in the options or inherited from `globalConfig`. Without both, you get a `ConfigResolutionError`. | Always pass `globalConfig` as the second argument, or set `mapStyle` explicitly. |

---

## Available Map Builders

| Builder | Input | Output |
|---------|-------|--------|
| `buildPointMapConfig(opts, globalConfig?)` | `{ location: LocationPoint }` | Circle marker at coordinates |
| `buildMultiPointMapConfig(opts, globalConfig?)` | `{ locations: LocationPoint[] }` | Multiple markers with auto-fit bounds |
| `buildPolygonMapConfig(opts, globalConfig?)` | `{ region: RegionPolygon }` | Filled polygon with outline |
| `buildRouteMapConfig(opts, globalConfig?)` | `{ route: RouteLine }` | Line with start/end markers |

All builders accept an optional `globalConfig` second argument for inheriting `defaultMapStyle`, `defaultCenter`, and `defaultZoom`.

---

## Available Schema Types for Collection Frontmatter

| Schema | Fields | Use For |
|--------|--------|---------|
| `LocationPointSchema` | `coordinates`, `name?`, `description?`, `zoom?`, `markerColor?` | Single point (building, site) |
| `RegionPolygonSchema` | `coordinates`, `name?`, `description?`, `fillColor?`, `strokeColor?`, `fillOpacity?` | Area (park, zone, district) |
| `RouteLineSchema` | `coordinates`, `name?`, `description?`, `color?`, `width?` | Path (canal, road, trail) |

All are importable from `@maplibre-yaml/astro`.
