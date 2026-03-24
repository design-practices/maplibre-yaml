# feat: Global Map Configuration Inheritance

## Overview

Enable users to define a global map configuration (style, zoom, center) that flows to all maps across an Astro site, so they don't have to repeat `mapStyle`, `zoom`, and `center` on every `buildPointMapConfig()` call.

## Problem Statement

Currently, every map builder call must receive a complete configuration. There's no way to set site-wide defaults that propagate automatically. Users working with content collections (blog posts, travel guides) must manually pass `mapStyle` to every builder call, defeating the "configure once, use everywhere" pattern.

## Proposed Solution

Thread `globalConfig` through the Astro integration layer, leveraging the existing core infrastructure (`GlobalConfig`, `resolveMapConfig`) that already supports `defaultMapStyle` but isn't wired up for zoom/center.

### Configuration Precedence (highest to lowest)

```
1. Explicit item/builder parameter  (location.zoom: 10)
2. Global config default            (defaultZoom: 8)
3. Error (no silent fallbacks)
```

Unlike the existing `mapStyle` check, `center` and `zoom` will also throw `ConfigResolutionError` when missing from all sources. Null Island (`[0, 0]`) is never an appropriate default.

### User Experience

```typescript
// src/lib/map-config.ts -- define once
import { loadGlobalMapConfig } from '@maplibre-yaml/astro';
export const globalConfig = await loadGlobalMapConfig('./src/config/maps.yaml');
```

```yaml
# src/config/maps.yaml
defaultMapStyle: "https://api.maptiler.com/maps/streets/style.json?key=KEY"
defaultZoom: 10
defaultCenter: [-74.006, 40.7128]
```

```typescript
// In any page -- inherits style, zoom, center from global
const map = buildPointMapConfig({ location: post.data.location }, globalConfig);
```

```yaml
# Blog post frontmatter -- only needs coordinates
---
title: "My Trip to Paris"
location:
  coordinates: [2.3522, 48.8566]
  name: "Paris, France"
---
```

## Technical Approach

### Architecture

```
GlobalConfig (YAML)
       |
       v
loadGlobalMapConfig()  <-- astro (new 4-line utility)
       |
       v
buildPointMapConfig(options, globalConfig)  <-- astro (needs globalConfig param)
       |  calls internally:
       v
resolveMapConfig()  <-- core (extended for zoom/center)
       |
       v
<Map config={resolved} />  <-- component (unchanged, receives resolved config)
```

Resolution happens once, in the builders. Components receive fully-resolved configs.

### Implementation

This is a single PR with clean commits. The changes are small (~50 lines of production code across 5 files) and fully backwards-compatible.

#### Step 1: Extend Core Schema

Add `defaultZoom` and `defaultCenter` to `GlobalConfigSchema`.

**File:** `packages/core/src/schemas/page.schema.ts`

```typescript
export const GlobalConfigSchema = z.object({
  // ... existing fields ...
  defaultMapStyle: z.string().url().optional(),
  theme: z.enum(["light", "dark"]).default("light"),
  // NEW
  defaultZoom: z.number().min(0).max(24).optional()
    .describe("Default zoom level for all maps"),
  defaultCenter: LngLatSchema.optional()
    .describe("Default center [lng, lat] for all maps"),
  // ... existing dataFetching ...
});
```

#### Step 2: Extend resolveMapConfig with Overloaded Signatures

Update `resolveMapConfig` to inherit zoom/center from globalConfig and throw when required fields are missing. Use function overloads so TypeScript enforces the contract at compile time.

**File:** `packages/core/src/utils/config-resolver.ts`

```typescript
// Overload 1: When globalConfig provides defaults, center/zoom are optional
export function resolveMapConfig(
  mapConfig: Partial<MapConfig>,
  globalConfig: GlobalConfig,
): MapConfig;

// Overload 2: Without globalConfig, center/zoom are still required
export function resolveMapConfig(
  mapConfig: Partial<MapConfig> & { center: [number, number]; zoom: number },
  globalConfig?: GlobalConfig,
): MapConfig;

// Implementation
export function resolveMapConfig(
  mapConfig: Partial<MapConfig>,
  globalConfig?: GlobalConfig,
): MapConfig {
  const resolved: MapConfig = {
    ...mapConfig,
    center: mapConfig.center ?? globalConfig?.defaultCenter,
    zoom: mapConfig.zoom ?? globalConfig?.defaultZoom,
    mapStyle: mapConfig.mapStyle ?? globalConfig?.defaultMapStyle,
    interactive: mapConfig.interactive ?? true,
    pitch: mapConfig.pitch ?? 0,
    bearing: mapConfig.bearing ?? 0,
  };

  // Validate all required fields -- no silent fallbacks
  const missingFields: string[] = [];

  if (!resolved.mapStyle) {
    missingFields.push("mapStyle");
  }
  if (resolved.center === undefined) {
    missingFields.push("center");
  }
  if (resolved.zoom === undefined) {
    missingFields.push("zoom");
  }

  if (missingFields.length > 0) {
    throw new ConfigResolutionError(
      `Map configuration is missing required fields: ${missingFields.join(", ")}. ` +
        "Either provide these fields in the map config or set defaults in global config " +
        "(e.g., config.defaultMapStyle, config.defaultCenter, config.defaultZoom).",
      missingFields,
    );
  }

  return resolved;
}
```

Key changes from current implementation:
- No `[0, 0]` or `2` fallbacks -- throw `ConfigResolutionError` instead (consistent with existing `mapStyle` check)
- Overloaded signatures enforce that either mapConfig or globalConfig provides center/zoom
- Existing callers (which already provide `center` and `zoom`) match overload 2 and continue to work unchanged

#### Step 3: Wire globalConfig into Map Builders

Add `globalConfig` as optional second parameter to all four builders. Replace existing `as MapConfig` type casts with proper `resolveMapConfig` calls.

**File:** `packages/astro/src/utils/map-builders.ts`

```typescript
export function buildPointMapConfig(
  options: PointMapOptions,
  globalConfig?: GlobalConfig
): MapBlock {
  const { location, mapStyle, zoom, id, interactive } = options;

  const config = resolveMapConfig(
    {
      center: location.coordinates,
      zoom: zoom ?? location.zoom,
      mapStyle,
      interactive,
    },
    globalConfig,
  );

  return {
    type: "map",
    id: id ?? generateMapId("point"),
    config,
    layers: [/* ... existing layer logic ... */],
  };
}
```

Same pattern for `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`.

**Important:** Remove existing `as MapConfig` casts and replace with `resolveMapConfig` calls. The validated return value from `resolveMapConfig` is a proper `MapConfig` -- no type lies needed.

#### Step 4: Add Global Config Loader Utility

**File:** `packages/astro/src/utils/global-config.ts` (new)

```typescript
import { GlobalConfigSchema } from '@maplibre-yaml/core/schemas';
import { loadYAML } from './loader';
import type { GlobalConfig } from '@maplibre-yaml/core/schemas';

export async function loadGlobalMapConfig(
  filePath: string
): Promise<GlobalConfig> {
  const raw = await loadYAML(filePath);
  return GlobalConfigSchema.parse(raw);
}
```

**File:** `packages/astro/src/index.ts` -- add export

## Acceptance Criteria

### Functional Requirements

- [ ] `GlobalConfigSchema` accepts `defaultZoom` and `defaultCenter` (optional fields)
- [ ] `resolveMapConfig` inherits zoom/center from globalConfig when not set per-map
- [ ] `resolveMapConfig` throws `ConfigResolutionError` when center or zoom is missing from all sources (no `[0, 0]` fallback)
- [ ] All four map builders accept optional `globalConfig` parameter
- [ ] Existing builder calls without globalConfig continue to work unchanged (snapshot-level identical output)
- [ ] `loadGlobalMapConfig` utility loads and validates global config from YAML
- [ ] `loadGlobalMapConfig` throws `ZodError` for malformed YAML with useful error messages
- [ ] Precedence is correct: explicit item values > global defaults > error

### Non-Functional Requirements

- [ ] All changes are backwards compatible
- [ ] TypeScript types are correct (no `any` escapes, no `as MapConfig` casts in builders)
- [ ] Core package typecheck passes
- [ ] Astro package typecheck passes
- [ ] All existing tests continue to pass

### Test Plan

**Baseline tests (write BEFORE modifying):**

There are currently no tests for `resolveMapConfig` or the map builders. Write baseline tests for existing behavior first to create a safety net.

- [ ] Baseline: `resolveMapConfig` with all fields provided returns them unchanged
- [ ] Baseline: `resolveMapConfig` without mapStyle throws `ConfigResolutionError`
- [ ] Baseline: `resolveMapConfig` inherits mapStyle from globalConfig
- [ ] Baseline: Each builder produces correct output for current call signatures

**resolveMapConfig tests:**

- [ ] mapConfig has center/zoom, no globalConfig -- uses mapConfig values
- [ ] mapConfig missing center/zoom, globalConfig provides them -- inherits
- [ ] mapConfig has center/zoom, globalConfig also has them -- mapConfig wins
- [ ] Neither provides center/zoom -- throws `ConfigResolutionError`
- [ ] mapConfig has center but not zoom, globalConfig has zoom but not center -- cross-inheritance works
- [ ] globalConfig provided but has no defaultCenter/defaultZoom -- same as no globalConfig for those fields
- [ ] Error message lists which specific fields are missing

**Builder tests with globalConfig:**

- [ ] Existing calls without globalConfig produce identical output (regression)
- [ ] Builder with globalConfig.defaultMapStyle -- mapStyle is inherited
- [ ] Builder with explicit mapStyle AND globalConfig.defaultMapStyle -- explicit wins
- [ ] Builder with globalConfig.defaultZoom -- zoom is inherited when not set per-location
- [ ] Builder with location.zoom AND globalConfig.defaultZoom -- location.zoom wins
- [ ] Builder with globalConfig.defaultCenter -- center is inherited when not set per-location

**loadGlobalMapConfig tests:**

- [ ] Valid YAML with all fields -- returns parsed GlobalConfig
- [ ] Valid YAML with minimal fields (just defaultMapStyle) -- returns parsed GlobalConfig
- [ ] Invalid YAML (malformed syntax) -- throws with useful error
- [ ] YAML with invalid field values (e.g., zoom > 24) -- throws ZodError
- [ ] File not found -- throws with file path in error

## Dependencies & Risks

**Risks:**
- The `resolveMapConfig` overloaded signature requires careful TypeScript implementation. The overloads must be tested at both the type level (compile-time) and runtime.
- Existing `as MapConfig` casts in the builders mask type issues. Removing them may surface latent bugs. This is good -- better to find them now.

## Out of Scope

- **geojsonUrl in collection schemas** -- separate feature, separate PR. Adding `geojsonUrl` to `LocationPointSchema` is a breaking change (makes `coordinates` optional) that is orthogonal to config inheritance. See future plan: `feat-geojson-url-collections.md`.
- **Component-level globalConfig prop** -- resolution belongs in the builders, not components. `Map.astro` and `FullPageMap.astro` receive fully-resolved `MapBlock` configs from builders. Adding a second resolution point at the component layer is redundant.
- Runtime YAML loading (`src` prop) with global config inheritance
- CLI validator changes for global config resolution chains
- Scrollytelling per-chapter global config inheritance (chapters already have explicit location configs)
- Environment-specific global config overrides

## Files Affected

| File | Change |
|------|--------|
| `packages/core/src/schemas/page.schema.ts` | Add defaultZoom, defaultCenter to GlobalConfigSchema |
| `packages/core/src/utils/config-resolver.ts` | Add overloads, extend resolution for zoom/center, throw on missing |
| `packages/core/tests/` | Baseline + new resolution tests |
| `packages/astro/src/utils/map-builders.ts` | Add globalConfig param, replace `as MapConfig` casts |
| `packages/astro/tests/` | Baseline + new builder tests |
| `packages/astro/src/utils/global-config.ts` | New file: loadGlobalMapConfig utility |
| `packages/astro/src/index.ts` | Export loadGlobalMapConfig |

**Files NOT changed (deliberately):**
| File | Why |
|------|-----|
| `packages/astro/src/utils/collections-schemas.ts` | geojsonUrl is a separate feature |
| `packages/astro/src/types.ts` | No component-level globalConfig prop |
| `packages/astro/src/components/Map.astro` | Resolution happens in builders |
| `packages/astro/src/components/FullPageMap.astro` | Resolution happens in builders |

## References

- `packages/core/src/schemas/page.schema.ts:253-284` -- current GlobalConfigSchema
- `packages/core/src/utils/config-resolver.ts:80-114` -- current resolveMapConfig
- `packages/astro/src/utils/map-builders.ts:241-600` -- current map builders
- Leaflet pattern: class-level defaults with `L.Util.setOptions` for per-instance overrides
- MapLibre pattern: style object defaults with constructor option overrides
