# Feature Spec: Per-User Search & Filter with Global Creator Controls

## Purpose

This document is a complete implementation spec for the search and filter feature in map-party. It is intended to be passed directly to Claude Code. All architectural decisions have been made — decision points are noted only where implementation choices remain open within a task.

---

## Decision log

| Question | Decision |
|---|---|
| URL filter state mutable by recipients? | Yes |
| Searchable toggle lives where? | Per-layer in room YAML via `x-map-party` block |
| External source indexing | Background job, only for creator-specified fields |
| Follow mode includes local filters? | Yes — added to Yjs awareness state |
| Creator can hide filter UI per room? | Yes — `allowLocalFilters` room-level setting |
| Search index storage | R2-backed file, not D1 rows |
| Client vs server index threshold | File size: `< 2MB` → client JSON; `≥ 2MB` → server SQLite |
| Unknown file size at enqueue time | Default to server-side SQLite (conservative) |

---

## Conceptual model

```
┌─────────────────────────────────────────────────────┐
│  GLOBAL LAYER  (Yjs / YAML)                         │
│  Creator-authored: style, base filters, visibility  │
│  Synced to all collaborators in real time           │
│  Mutated only by users with edit permission         │
└──────────────────────┬──────────────────────────────┘
                       │ applied first, read-only to local engine
                       ▼
┌─────────────────────────────────────────────────────┐
│  LOCAL LAYER  (URL params + Zustand)                │
│  Per-user: search query, property filters, highlight│
│  Serialized to URL for shareability                 │
│  Broadcast via Yjs awareness in follow mode         │
│  NOT written to Yjs doc                             │
└──────────────────────┬──────────────────────────────┘
                       │ AND-composed with global, then applied
                       ▼
              MapLibre setFilter() per layer
```

The **effective filter** for any layer at render time is:

```
effectiveFilter = ["all", globalFilter, localFilter]
```

If either is absent the composition collapses gracefully to whichever is present.

---

## Project boundary

### Changes required in `maplibre-yaml`

Two changes only. Keep the diff minimal.

1. **`onStyleReconciled` callback** — fires after every YAML diff cycle so map-party can reapply local filters that the reconciliation may have overwritten.
2. **Strip `x-map-party` extension blocks** — remove before compilation so MapLibre never sees unknown keys.

### Everything else is in `map-party`

The local filter store, URL serialization, filter composition, search engine, highlight layer injection, all UI components, the import pipeline additions, and the awareness extension are all map-party concerns.

---

## Part 1: `maplibre-yaml` changes

### 1.1 `onStyleReconciled` callback

**File:** `packages/core/src/renderer.ts`

Add one optional field to `MapRendererOptions`:

```typescript
export interface MapRendererOptions {
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onStyleReconciled?: () => void; // NEW
}
```

Call `options.onStyleReconciled?.()` at the end of the diff application method, after all `setPaintProperty`, `setFilter`, `addLayer`, etc. calls have been made. This callback must fire even when the diff results in zero changes — map-party uses it as a signal that it is safe to reapply local state.

### 1.2 Strip `x-map-party` extension blocks

**File:** `packages/core/src/compiler.ts` (or wherever YAML → MapLibre style conversion occurs)

Before passing any config to the MapLibre style builder, remove keys named `x-map-party` at the root config level and at the per-layer level. Do not validate or parse the contents — silent deletion only.

```typescript
function stripExtensions(config: RawConfig): CleanConfig {
  const clean = { ...config };
  delete clean['x-map-party'];
  if (clean.layers) {
    clean.layers = clean.layers.map(layer => {
      const l = { ...layer };
      delete l['x-map-party'];
      return l;
    });
  }
  return clean;
}
```

Call `stripExtensions` after YAML parsing, before compilation. This function should also handle the case where `x-map-party` appears on source definitions (delete it there too, for forward compatibility).

---

## Part 2: `map-party` changes

### 2.1 TypeScript types for `x-map-party`

**New file:** `packages/core/src/types/x-map-party.ts`

```typescript
// Root-level x-map-party block (on the room's YAML document)
export interface RoomMapPartyConfig {
  allowLocalFilters?: boolean; // default: true
}

// Per-layer x-map-party block
export interface LayerMapPartyConfig {
  searchable?: boolean;
  labelField?: string;
  filterableProperties?: FilterableProperty[];
}

export interface FilterableProperty {
  property: string;
  label: string;
  type?: 'select' | 'range' | 'text'; // if omitted, auto-detected from propertiesSchema
}
```

**Example YAML a room creator would author:**

```yaml
type: map
x-map-party:
  allowLocalFilters: true

config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://..."

layers:
  - id: restaurants
    type: circle
    source: mp://datasets/nyc-restaurants
    paint:
      circle-color: "#ff6b35"
      circle-opacity: 0.7
    filter: ["!=", ["get", "permanently_closed"], true]  # global: always applied, not user-adjustable
    x-map-party:
      searchable: true
      labelField: name
      filterableProperties:
        - property: cuisine
          label: Cuisine
        - property: rating
          label: Rating
          type: range
        - property: price_range
          label: Price
          type: select
```

The `filter` field is a native MapLibre field and becomes the **global filter** — it is always applied and cannot be overridden by users. The `x-map-party` block is stripped before MapLibre sees the config.

---

### 2.2 `propertiesSchema` cardinality enrichment (import pipeline)

**Context:** The `datasets` table already has a `properties_schema` column (JSON). Enrich it with cardinality data so the FilterPanel can auto-generate controls.

**Updated schema per property:**

```typescript
interface PropertySchema {
  type: 'string' | 'number' | 'boolean';
  count: number;          // features that have this property
  // strings:
  uniqueCount?: number;   // distinct value count
  topValues?: string[];   // top 20 values by frequency, for select-type controls
  // numbers:
  min?: number;
  max?: number;
  mean?: number;
}
```

**Auto-detection rules for FilterPanel:**
- `type === 'number'` → `range` control
- `type === 'string'` and `uniqueCount < 50` → `select` (multi-checkbox) control
- `type === 'string'` and `uniqueCount >= 50` → `text` control (feeds search engine, not filter expression)

**Where to add this:** the existing import pipeline step that computes `properties_schema`. It's additional passes over the feature collection — not a new pipeline stage. Compute `topValues` using a frequency map, keeping only the top 20 by occurrence count.

---

### 2.3 Search index generation (import pipeline)

**Context:** Runs in the Cloudflare Queue worker that handles async dataset conversion (Phase 9.5), after PMTiles conversion completes.

#### Size threshold decision tree

```
Size known at enqueue time?
  ├─ Yes: estimate projected index size = featureCount × avgPropertiesBytes
  │    ├─ Estimated < 2MB → build client-side JSON index
  │    └─ Estimated ≥ 2MB → build server-side SQLite index
  └─ No (streaming source / external URL / PMTiles without header read):
       → default to server-side SQLite (conservative)
```

"Projected index size" is an estimate only — actual size is measured after writing to R2 and stored in the dataset record. No auto-downgrade between modes in v1.

For GeoJSON sources imported through the pipeline: size is known before indexing (the file was fetched in full). Use eager threshold check.

For PMTiles sources and external URLs: size is unknown at enqueue time → server-side SQLite default.

#### Client-side index format (< 2MB estimated)

Build a compact JSON array containing only the `labelField` and `filterableProperties` — not all properties. This keeps the index small.

```typescript
interface SearchEntry {
  id: string;                              // feature ID (must match PMTiles feature ID)
  label: string;                           // value of labelField
  lngLat: [number, number];
  props: Record<string, string | number>;  // only filterable properties
}

// Array of SearchEntry[], serialized as JSON
// Stored at: datasets/{datasetId}/search-index.json in R2
```

#### Server-side index format (≥ 2MB estimated or unknown size)

Generate a standalone SQLite file. Use the `better-sqlite3` npm package in the Queue consumer (which runs in a Node.js-compatible environment).

```sql
CREATE TABLE features (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lng REAL NOT NULL,
  lat REAL NOT NULL,
  properties TEXT NOT NULL  -- JSON of filterable props only
);

CREATE VIRTUAL TABLE features_fts USING fts5(
  label,
  content=features,
  content_rowid=rowid
);

-- After all inserts:
INSERT INTO features_fts(features_fts) VALUES('rebuild');
```

Store at: `datasets/{datasetId}/search-index.sqlite` in R2.

#### D1 schema changes

Add columns to the `datasets` table:

```sql
ALTER TABLE datasets ADD COLUMN search_index_mode TEXT;
  -- 'client' | 'server' | null (not yet indexed)
ALTER TABLE datasets ADD COLUMN search_index_r2_key TEXT;
  -- R2 path to .json or .sqlite file
ALTER TABLE datasets ADD COLUMN search_label_field TEXT;
  -- which property is the display label
ALTER TABLE datasets ADD COLUMN search_index_size_bytes INTEGER;
  -- actual size of the index file after writing, for monitoring
```

After writing to R2, update the dataset record with all four fields.

#### Important: PMTiles feature IDs

The highlight layer (section 2.8) uses MapLibre's `['id']` expression — the vector tile feature ID — not a property value. Verify that the PMTiles conversion step (tippecanoe or equivalent) is called with `--generate-ids` or the equivalent flag that ensures every feature has a numeric ID. The search index must store the same ID value that MapLibre will expose at runtime. If the conversion tool uses a different ID scheme, document the mapping here before implementing.

---

### 2.4 External source background indexing

For layers that reference an external PMTiles or GeoJSON URL (not imported through map-party), the creator can still mark a layer `searchable: true`. When map-party detects this at room load time and finds no search index for that source URL, it enqueues a background indexing job.

**New API endpoint:** `POST /api/datasets/index-external`

Request body:
```typescript
{
  sourceUrl: string;
  labelField: string;               // required — no auto-detection for external sources
  filterableProperties: string[];   // required — no full schema scan for external sources
  roomId: string;
}
```

The endpoint:
1. Creates a `datasets` record in D1 with `storage_type = 'external'`, `origin_url = sourceUrl`, `search_index_mode = null` (indexing pending)
2. Enqueues a Cloudflare Queue message with the indexing job
3. Returns `{ datasetId, status: 'indexing' }` immediately

The Queue consumer:
1. Fetches the external source through the existing proxy (respecting the domain allowlist)
2. Since size is unknown from a URL: defaults to server-side SQLite
3. Processes only the `labelField` and `filterableProperties` specified by the creator
4. Writes the SQLite file to R2 and updates the dataset record

**KV mapping for runtime lookup:**

map-party needs to connect a layer's `source` URL to its `datasetId` so the filter system can find the search index at runtime. Store this mapping in KV:

- Key: `external-source-index:{sha256(sourceUrl)}`  
- Value: `{ datasetId, indexMode, indexR2Key }`

Write this KV entry after the index is built. At room load time, for each searchable layer that references an external URL, look up this KV key to find the index. If the key doesn't exist, the search UI shows a "building search index..." state (poll `GET /api/datasets/:id` until `search_index_mode` is non-null).

---

### 2.5 Local filter Zustand store

**New file:** `packages/app/src/stores/local-filters.ts`

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface FeatureRef {
  layerId: string;
  featureId: string;
  label: string;
  lngLat: [number, number];
}

export interface PropertyFilter {
  property: string;
  type: 'in' | 'range' | 'text';
  value: string[] | [number, number] | string;
}

interface LocalFilterState {
  searchQuery: string;
  searchResults: FeatureRef[];
  isSearchLoading: boolean;

  // keyed by layerId
  filters: Record<string, PropertyFilter[]>;

  highlightedFeature: FeatureRef | null;

  // actions
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: FeatureRef[], loading: boolean) => void;
  setLayerFilters: (layerId: string, filters: PropertyFilter[]) => void;
  clearLayerFilters: (layerId: string) => void;
  clearAllFilters: () => void;
  setHighlightedFeature: (feature: FeatureRef | null) => void;

  // derived (computed on every state change)
  activeFilterCount: number;
  hasActiveFilters: boolean;
}

export const useLocalFilterStore = create<LocalFilterState>()(
  subscribeWithSelector((set, get) => ({
    searchQuery: '',
    searchResults: [],
    isSearchLoading: false,
    filters: {},
    highlightedFeature: null,

    setSearchQuery: (q) => set({ searchQuery: q }),
    setSearchResults: (results, loading) =>
      set({ searchResults: results, isSearchLoading: loading }),
    setLayerFilters: (layerId, filters) =>
      set(state => ({
        filters: { ...state.filters, [layerId]: filters },
        activeFilterCount: computeActiveCount({ ...state.filters, [layerId]: filters }),
        hasActiveFilters: computeActiveCount({ ...state.filters, [layerId]: filters }) > 0,
      })),
    clearLayerFilters: (layerId) =>
      set(state => {
        const next = { ...state.filters };
        delete next[layerId];
        return { filters: next, activeFilterCount: computeActiveCount(next), hasActiveFilters: computeActiveCount(next) > 0 };
      }),
    clearAllFilters: () =>
      set({ filters: {}, activeFilterCount: 0, hasActiveFilters: false }),
    setHighlightedFeature: (feature) => set({ highlightedFeature: feature }),

    activeFilterCount: 0,
    hasActiveFilters: false,
  }))
);

function computeActiveCount(filters: Record<string, PropertyFilter[]>): number {
  return Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);
}
```

**Initialization on room mount:**

```typescript
// In the room page component, on mount:
const urlFilters = deserializeFilters(new URLSearchParams(window.location.search));
useLocalFilterStore.setState(urlFilters);
```

**URL sync on every state change:**

```typescript
// Subscribe in the room page component:
useEffect(() => {
  return useLocalFilterStore.subscribe(
    state => state, // selector: full state
    (state) => {
      const params = serializeFilters(state);
      const url = `${window.location.pathname}?${params.toString()}`;
      history.replaceState(null, '', url); // replaceState, not pushState
    }
  );
}, []);
```

---

### 2.6 URL serialization

**New file:** `packages/app/src/lib/filter-url.ts`

**URL format:**

```
/room/nyc-restaurants
  ?q=nobu
  &f=restaurants:cuisine:in:ramen,pizza
  &f=restaurants:rating:range:3,5
  &h=restaurants:feat_abc123
  &v=-74.006,40.7128,14
```

| Param | Format | Description |
|---|---|---|
| `q` | string | Text search query |
| `f` | `{layerId}:{property}:{op}:{value}` | Property filter. Repeatable. |
| `h` | `{layerId}:{featureId}` | Highlighted feature |
| `v` | `{lng},{lat},{zoom}` | Viewport — only present when using "Share this view" |

Supported ops for `f`: `in` (comma-separated values), `range` (two comma-separated numbers), `gte`, `lte`, `text`.

```typescript
export function serializeFilters(state: Pick<LocalFilterState,
  'searchQuery' | 'filters' | 'highlightedFeature'>
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.searchQuery) params.set('q', state.searchQuery);

  for (const [layerId, layerFilters] of Object.entries(state.filters)) {
    for (const f of layerFilters) {
      const value = Array.isArray(f.value) ? f.value.join(',') : f.value;
      params.append('f', `${layerId}:${f.property}:${f.type}:${value}`);
    }
  }

  if (state.highlightedFeature) {
    params.set('h', `${state.highlightedFeature.layerId}:${state.highlightedFeature.featureId}`);
  }

  return params;
}

export function deserializeFilters(
  params: URLSearchParams
): Partial<LocalFilterState> {
  const state: Partial<LocalFilterState> = {};

  const q = params.get('q');
  if (q) state.searchQuery = q;

  const filters: Record<string, PropertyFilter[]> = {};
  for (const f of params.getAll('f')) {
    const [layerId, property, op, ...rest] = f.split(':');
    const rawValue = rest.join(':'); // re-join in case value contained colons
    if (!layerId || !property || !op || !rawValue) continue;

    const filter = parseFilterParam(property, op, rawValue);
    if (filter) {
      if (!filters[layerId]) filters[layerId] = [];
      filters[layerId].push(filter);
    }
  }
  if (Object.keys(filters).length > 0) state.filters = filters;

  const h = params.get('h');
  if (h) {
    const colonIdx = h.indexOf(':');
    if (colonIdx > 0) {
      state.highlightedFeature = {
        layerId: h.slice(0, colonIdx),
        featureId: h.slice(colonIdx + 1),
        label: '',   // will be resolved at runtime from search index
        lngLat: [0, 0], // will be resolved at runtime
      };
    }
  }

  return state;
}

function parseFilterParam(
  property: string,
  op: string,
  rawValue: string
): PropertyFilter | null {
  switch (op) {
    case 'in':
      return { property, type: 'in', value: rawValue.split(',') };
    case 'range': {
      const parts = rawValue.split(',').map(Number);
      if (parts.length !== 2 || parts.some(isNaN)) return null;
      return { property, type: 'range', value: parts as [number, number] };
    }
    case 'text':
      return { property, type: 'text', value: rawValue };
    default:
      return null;
  }
}
```

**Viewport serialization** (used only by "Share this view" button, not written on every filter change):

```typescript
export function serializeViewport(map: maplibregl.Map): string {
  const c = map.getCenter();
  const z = map.getZoom();
  return `${c.lng.toFixed(5)},${c.lat.toFixed(5)},${z.toFixed(2)}`;
}

export function deserializeViewport(v: string): { center: [number, number]; zoom: number } | null {
  const parts = v.split(',').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { center: [parts[0], parts[1]], zoom: parts[2] };
}
```

---

### 2.7 Filter composition engine

**New file:** `packages/app/src/lib/filter-composer.ts`

```typescript
import type { FilterSpecification } from 'maplibre-gl';

export function composeFilters(
  globalFilter: FilterSpecification | null | undefined,
  localFilters: PropertyFilter[]
): FilterSpecification | null {
  const localExpr = buildLocalExpression(localFilters);

  if (!globalFilter && !localExpr) return null;
  if (!globalFilter) return localExpr;
  if (!localExpr) return globalFilter as FilterSpecification;

  return ['all', globalFilter, localExpr] as FilterSpecification;
}

function buildLocalExpression(
  filters: PropertyFilter[]
): FilterSpecification | null {
  if (filters.length === 0) return null;

  const exprs: FilterSpecification[] = filters
    .map(f => {
      switch (f.type) {
        case 'in':
          return ['in', ['get', f.property], ['literal', f.value as string[]]] as FilterSpecification;
        case 'range': {
          const [min, max] = f.value as [number, number];
          return ['all',
            ['>=', ['get', f.property], min],
            ['<=', ['get', f.property], max],
          ] as FilterSpecification;
        }
        case 'text':
          // Text filters do not use MapLibre expressions.
          // Text search is handled by the SearchEngine (section 2.9).
          // This branch is intentionally a no-op — text filters drive
          // the search engine, not setFilter().
          return null;
        default:
          return null;
      }
    })
    .filter((e): e is FilterSpecification => e !== null);

  if (exprs.length === 0) return null;
  if (exprs.length === 1) return exprs[0];
  return ['all', ...exprs] as FilterSpecification;
}
```

---

### 2.8 Local filter applier

**New file:** `packages/app/src/lib/local-filter-applier.ts`

This is the bridge between local state and MapLibre. Called in two places:
1. From the `onStyleReconciled` callback (after any YAML change from any collaborator)
2. From the Zustand store subscription (when local filter state changes)

```typescript
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerMapPartyConfig } from '../types/x-map-party';
import { composeFilters } from './filter-composer';

// parsedLayers: the YAML layers BEFORE x-map-party stripping
// (map-party keeps a copy of these; maplibre-yaml strips them before rendering)
export function reapplyLocalFilters(
  map: MapLibreMap,
  parsedLayers: RawLayer[],
  localState: LocalFilterState
) {
  for (const layer of parsedLayers) {
    const xmp = layer['x-map-party'] as LayerMapPartyConfig | undefined;
    if (!xmp?.searchable) continue;
    if (!map.getLayer(layer.id)) continue; // layer may not be loaded yet

    const globalFilter = (layer.filter ?? null) as FilterSpecification | null;
    const localFilters = localState.filters[layer.id] ?? [];
    const composed = composeFilters(globalFilter, localFilters);

    map.setFilter(layer.id, composed);

    // Highlight layer
    const highlightLayerId = `${layer.id}--highlight`;
    if (map.getLayer(highlightLayerId)) {
      const isHighlighted =
        localState.highlightedFeature?.layerId === layer.id;
      const highlightFilter: FilterSpecification = isHighlighted
        ? ['==', ['id'], localState.highlightedFeature!.featureId]
        : ['==', ['id'], -1]; // matches nothing (feature IDs are positive integers)
      map.setFilter(highlightLayerId, highlightFilter);
    }
  }
}
```

**Wiring in MapPreview component:**

```typescript
// Pass onStyleReconciled when constructing MapRenderer
const renderer = new MapRenderer(container, config, layers, {
  onLoad: handleLoad,
  onError: handleError,
  onStyleReconciled: () => {
    reapplyLocalFilters(
      renderer.getMap(),
      parsedLayersRef.current,       // ref to pre-strip layers
      useLocalFilterStore.getState()
    );
    ensureHighlightLayers(renderer.getMap(), parsedLayersRef.current);
  },
});

// Also subscribe to local filter store changes
useEffect(() => {
  return useLocalFilterStore.subscribe(
    state => state,
    (state) => {
      if (!rendererRef.current) return;
      reapplyLocalFilters(
        rendererRef.current.getMap(),
        parsedLayersRef.current,
        state
      );
    }
  );
}, []);
```

`parsedLayersRef` is a React ref updated every time the YAML is parsed — it holds the pre-strip layer configs so `reapplyLocalFilters` can read `x-map-party` blocks and global filters.

---

### 2.9 Highlight layer injection

**New file:** `packages/app/src/lib/highlight-layer-manager.ts`

Injects a sibling MapLibre layer for each searchable layer. These layers are not in the YAML — they are injected directly via the MapLibre API after the map loads. This keeps the Yjs document clean.

Call `ensureHighlightLayers` on map load and at the end of every `onStyleReconciled` (layers may have been added/removed by a YAML change).

```typescript
export function ensureHighlightLayers(
  map: MapLibreMap,
  parsedLayers: RawLayer[]
) {
  for (const layer of parsedLayers) {
    const xmp = layer['x-map-party'] as LayerMapPartyConfig | undefined;
    if (!xmp?.searchable) continue;
    if (!map.getLayer(layer.id)) continue;

    const highlightId = `${layer.id}--highlight`;
    if (map.getLayer(highlightId)) continue; // already exists

    const baseHighlight = {
      id: highlightId,
      source: layer.source as string,
      ...(layer['source-layer'] ? { 'source-layer': layer['source-layer'] } : {}),
      filter: ['==', ['id'], -1] as FilterSpecification, // matches nothing initially
    };

    switch (layer.type) {
      case 'circle':
        map.addLayer({
          ...baseHighlight,
          type: 'circle',
          paint: {
            'circle-color': '#ffffff',
            'circle-radius': 14,
            'circle-stroke-color': '#ff6b35',
            'circle-stroke-width': 3,
            'circle-opacity': 0.95,
          },
        }); // no beforeId = renders above the data layer
        break;

      case 'fill':
        map.addLayer({
          ...baseHighlight,
          type: 'fill',
          paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0.35,
            'fill-outline-color': '#ff6b35',
          },
        });
        break;

      case 'line':
        map.addLayer({
          ...baseHighlight,
          type: 'line',
          paint: {
            'line-color': '#ffffff',
            'line-width': 5,
          },
        });
        break;

      // symbol layers: add a circle highlight below the symbol
      case 'symbol':
        map.addLayer({
          ...baseHighlight,
          id: `${layer.id}--highlight`,
          type: 'circle',
          paint: {
            'circle-color': '#ff6b35',
            'circle-radius': 16,
            'circle-opacity': 0.4,
          },
        }, layer.id); // insert below the symbol layer
        break;
    }
  }
}
```

---

### 2.10 Search engine

**New file:** `packages/app/src/lib/search-engine.ts`

```typescript
import FlexSearch from 'flexsearch';

export class SearchEngine {
  private mode: 'client' | 'server';
  private datasetId: string;
  private layerId: string;
  private flexIndex: FlexSearch.Document<SearchEntry> | null = null;
  private entries: SearchEntry[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(params: {
    datasetId: string;
    layerId: string;
    mode: 'client' | 'server';
  }) {
    this.datasetId = params.datasetId;
    this.layerId = params.layerId;
    this.mode = params.mode;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.mode === 'client') {
        const resp = await fetch(`/api/datasets/${this.datasetId}/search-index`);
        if (!resp.ok) throw new Error('Failed to load search index');
        this.entries = await resp.json() as SearchEntry[];

        this.flexIndex = new FlexSearch.Document({
          document: {
            id: 'id',
            index: ['label', 'propsText'], // propsText: all prop values joined as string
          },
          tokenize: 'forward',
        });

        for (const entry of this.entries) {
          this.flexIndex.add({
            ...entry,
            propsText: Object.values(entry.props).join(' '),
          });
        }
      }
      // server mode: no initialization needed
      this.initialized = true;
    })();

    return this.initPromise;
  }

  async search(query: string, limit = 10): Promise<FeatureRef[]> {
    if (!query.trim()) return [];

    await this.initialize();

    if (this.mode === 'client' && this.flexIndex) {
      const results = this.flexIndex.search(query, { limit, enrich: true });
      const seen = new Set<string>();
      const refs: FeatureRef[] = [];

      for (const field of results) {
        for (const result of field.result) {
          const entry = result.doc as SearchEntry;
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          refs.push({
            layerId: this.layerId,
            featureId: entry.id,
            label: entry.label,
            lngLat: entry.lngLat,
          });
          if (refs.length >= limit) break;
        }
        if (refs.length >= limit) break;
      }

      return refs;
    }

    if (this.mode === 'server') {
      const resp = await fetch(
        `/api/datasets/${this.datasetId}/search?q=${encodeURIComponent(query)}&limit=${limit}`
      );
      if (!resp.ok) throw new Error('Search request failed');
      const results = await resp.json() as Array<{
        id: string; label: string; lng: number; lat: number;
      }>;
      return results.map(r => ({
        layerId: this.layerId,
        featureId: r.id,
        label: r.label,
        lngLat: [r.lng, r.lat],
      }));
    }

    return [];
  }
}
```

**New API endpoints:**

`GET /api/datasets/:id/search-index`
- Auth check: user must have view access to any room that uses this dataset
- Returns the raw JSON from R2 (`search_index_r2_key`) with `Content-Type: application/json`
- Set `Cache-Control: public, max-age=3600` (index only changes on re-import)

`GET /api/datasets/:id/search?q=&limit=`
- For server-mode datasets only
- Worker fetches the `.sqlite` file from R2, loads it into memory (using `better-sqlite3` or the sql.js WASM port available in Workers)
- Runs: `SELECT id, label, lng, lat FROM features_fts WHERE features_fts MATCH ? LIMIT ?`
- Returns: `Array<{ id, label, lng, lat }>`
- Response cached in KV for 60 seconds keyed by `search:{datasetId}:{q}:{limit}` to handle repeated identical queries

---

### 2.11 Awareness extension for follow mode

**File:** `packages/party/src/awareness.ts` (existing)

Extend the awareness state type:

```typescript
interface AwarenessState {
  user: User;
  viewport: ViewportState | null;
  localFilters?: {                              // NEW
    filters: Record<string, PropertyFilter[]>;
    highlightedFeature: FeatureRef | null;
    searchQuery: string;
  };
}
```

**Broadcasting local filter state:**

In the room component (wherever viewport is broadcast to awareness), add a parallel subscription for local filter state:

```typescript
useEffect(() => {
  return useLocalFilterStore.subscribe(
    state => ({
      filters: state.filters,
      highlightedFeature: state.highlightedFeature,
      searchQuery: state.searchQuery,
    }),
    (localFilters) => {
      provider.awareness.setLocalStateField('localFilters', localFilters);
    },
    { equalityFn: shallowEqual, fireImmediately: false }
  );
}, [provider]);
```

Use the same 100ms debounce pattern as viewport broadcasting.

**Receiving in follow mode:**

```typescript
// In the follow mode awareness handler (existing, extend it):
provider.awareness.on('change', () => {
  if (!followingUserId) return;

  const allStates = [...provider.awareness.getStates().values()];
  const followedState = allStates.find(s => s.user?.id === followingUserId);
  if (!followedState) return;

  // Existing: sync viewport
  if (followedState.viewport) {
    map.flyTo({
      center: followedState.viewport.center,
      zoom: followedState.viewport.zoom,
      bearing: followedState.viewport.bearing ?? 0,
      pitch: followedState.viewport.pitch ?? 0,
    });
  }

  // New: sync local filters
  if (followedState.localFilters) {
    useLocalFilterStore.setState({
      filters: followedState.localFilters.filters ?? {},
      highlightedFeature: followedState.localFilters.highlightedFeature ?? null,
      searchQuery: followedState.localFilters.searchQuery ?? '',
    });
    // URL params update automatically via the store's URL sync subscription
  }
});
```

When the user stops following (interacts with map or clicks stop follow), do not clear local filters — leave them as-is, matching the viewport behavior.

---

### 2.12 UI components

#### `SearchBar`

**File:** `packages/app/src/components/SearchBar.tsx`

Rendering conditions (both must be true):
- Room's `allowLocalFilters !== false` (from `x-map-party` root block)
- At least one layer in the room has `x-map-party.searchable: true`

Behavior:
- Floating input, positioned top-center of map canvas, above map controls
- `SearchEngine` instances are created per searchable layer on room load, initialized lazily on first keystroke
- Debounced 200ms; queries all searchable layers' engines in parallel
- Dropdown shows up to 10 results total (interleaved if multiple layers), each showing: feature label, layer name if >1 searchable layer, distance from current viewport center
- On result select: `map.flyTo({ center: result.lngLat, zoom: max(currentZoom, 15) })`, call `setHighlightedFeature(result)` in store
- "Clear" (×) button: clears `searchQuery` and `highlightedFeature`, resets all search results
- During server-mode search: show spinner in input
- If `SearchEngine.initialize()` is still in progress: show subtle "Loading index…" state in dropdown

#### `FilterPanel`

**File:** `packages/app/src/components/FilterPanel.tsx`

Rendering conditions: same as SearchBar.

Layout: slide-out panel, integrated as a "Filter" tab in the existing right panel (alongside Layers/Sources from Phase 5). If Phase 5 right panel doesn't exist yet, render as a floating drawer anchored to the right edge.

For each searchable layer that has `filterableProperties` defined:

1. Show a section header with the layer's display name
2. For each filterable property, auto-generate a control:

   **`select` type** (`uniqueCount < 50` or `type: 'select'` in config):
   - Multi-select checkboxes
   - Show top 10 `topValues` from `propertiesSchema`, with occurrence counts in muted text
   - "+ N more" expander if more than 10 values exist
   - Selecting values: updates `filters[layerId]` in store with an `in` filter

   **`range` type** (`type === 'number'` or `type: 'range'` in config):
   - Dual-handle range slider
   - Min/max from `propertiesSchema.min` / `propertiesSchema.max`
   - Show current selected range as text above slider
   - Updating range: updates `filters[layerId]` with a `range` filter

   **`text` type** (`uniqueCount >= 50` or `type: 'text'` in config):
   - Free text input
   - On change: passes query to `SearchEngine.search()` and updates search results
   - Text filters drive the search engine, not `setFilter()` — do not add to `compiledFilters`

3. Below each layer section: "X of M features visible" count
   - Computed from `map.queryRenderedFeatures({ layers: [layerId] }).length`
   - Updated on map `render` event, throttled to 500ms
   - Shows M (total features) from `datasets.feature_count`

Panel footer:
- "Clear all filters" button (disabled when `!hasActiveFilters`)
- "Share this view" button — serializes current filter state + current viewport to URL, copies to clipboard, shows toast: "Link copied — recipients will see your filters and view"

#### `FilterBadge`

**File:** `packages/app/src/components/FilterBadge.tsx`

- Small pill rendered in the bottom-left map corner, above attribution
- Only visible when `activeFilterCount > 0`
- Text: "{N} filter{s} active"
- Clicking opens FilterPanel
- Uses a secondary/muted visual style — signals personal state, not shared map state
- Include a small "×" to clear all filters without opening the panel

#### `FeatureInfoPanel`

**File:** `packages/app/src/components/FeatureInfoPanel.tsx`

Triggered by:
- Clicking a feature on a searchable layer (via MapLibre `layer:click` event)
- Selecting a search result from SearchBar dropdown

Render as:
- Mobile: slide-up sheet (bottom 60% of viewport)
- Desktop: right panel drawer, 320px wide, pushed left of any existing right panel

Contents:
- **Header:** Feature label (from `labelField`), layer name in muted text, "×" close button
- **Properties tab:** All feature properties as a styled key/value table. Auto-format: URLs become links, numbers with units (rating out of 5) formatted appropriately. Properties matching `filterableProperties` are shown first.
- **Comments tab:** Comment thread for this `featureId` (see section 2.13). Show comment count in tab label.
- **Footer:** "Share feature" button — copies URL with `h=layerId:featureId&v=...` to clipboard

On close: call `setHighlightedFeature(null)` in store, which clears the highlight layer via `reapplyLocalFilters`.

On open: call `setHighlightedFeature(featureRef)` in store.

---

### 2.13 Comment model extension

**File:** `packages/core/src/types/document.ts` (where `Comment` interface lives)

Add three optional fields with no breaking changes to existing comments:

```typescript
export interface Comment {
  // ... all existing fields unchanged ...

  // Feature linking — all three present together or all absent
  featureId?: string;        // MapLibre vector tile feature ID
  featureLayerId?: string;   // layer ID the feature belongs to
  featureLabel?: string;     // denormalized display name at time of comment creation
                             // (stored so it's readable even if dataset is re-imported)
}
```

**In `CommentManager.addComment()`**, accept an optional `featureRef` parameter:

```typescript
addComment(
  location: [number, number],
  text: string,
  author: Comment['author'],
  featureRef?: { featureId: string; featureLayerId: string; featureLabel: string }
): string {
  const comment: Comment = {
    // ... existing fields ...
    ...(featureRef ?? {}),
  };
  // ...
}
```

**In the map click handler:** when a user clicks a feature on a searchable layer and the comment mode is active, call `addComment` with the `featureRef` populated. When comment mode is not active, clicking a feature opens `FeatureInfoPanel` instead.

**In `FeatureInfoPanel` Comments tab:**

```typescript
const featureComments = commentManager
  .getRootComments()
  .filter(c => c.featureId === highlightedFeature.featureId);
```

**Comment markers on the map:** if a comment has `featureId` set, clicking its pin opens `FeatureInfoPanel` with the Comments tab pre-selected, rather than the generic comment popover.

---

### 2.14 Room settings: creator controls

**File:** `packages/app/src/components/RoomSettings.tsx`

Add a "Discovery" section, visible only to users with edit permission.

Controls:

1. **"Allow viewers to search and filter"** — boolean toggle
   - Reads/writes `allowLocalFilters` in root `x-map-party` block of the Yjs YAML document
   - Default: true

2. Per-layer subsection (one per layer that has a dataset with `propertiesSchema` available):
   - **"Enable search"** toggle → adds/removes `x-map-party.searchable` on that layer in YAML
   - **"Label field"** dropdown → populated from `propertiesSchema` string-type properties; writes to `x-map-party.labelField`
   - **"Filterable properties"** multi-select → populated from all `propertiesSchema` properties; writes to `x-map-party.filterableProperties`
   - If the dataset's search index status is `null` (not yet built), show: "Search index building… this may take a few minutes" with a spinner. Poll `GET /api/datasets/:id` every 5 seconds until `search_index_mode` is non-null.
   - If the layer references an external URL with no dataset record, show: "External source — click to enable search" which calls `POST /api/datasets/index-external` and shows the building state.

All writes go directly to the shared Yjs YAML document, so they sync to all collaborators in real time.

---

## Implementation order

Build in this sequence to minimize blocked work:

| Step | Task | Depends on |
|---|---|---|
| 1 | `maplibre-yaml`: `stripExtensions` + `onStyleReconciled` | — |
| 2 | `propertiesSchema` cardinality enrichment in import pipeline | — |
| 3 | Search index generation: client-side JSON (< 2MB) | Step 2 |
| 4 | Search index generation: server-side SQLite (≥ 2MB or unknown) | Step 2 |
| 5 | D1 schema migration: add 4 columns to `datasets` | — |
| 6 | `x-map-party` TypeScript types | — |
| 7 | `filter-composer.ts` | Step 6 |
| 8 | `local-filters.ts` Zustand store | Step 6 |
| 9 | `filter-url.ts` serialize/deserialize | Step 8 |
| 10 | `local-filter-applier.ts` | Steps 1, 7, 8 |
| 11 | `highlight-layer-manager.ts` | Step 1 |
| 12 | Wire steps 10 + 11 into `MapPreview` | Steps 10, 11 |
| 13 | `/api/datasets/:id/search-index` endpoint | Steps 3, 5 |
| 14 | `/api/datasets/:id/search` endpoint (server-mode) | Steps 4, 5 |
| 15 | `SearchEngine` class | Steps 13, 14 |
| 16 | `SearchBar` component | Steps 8, 15 |
| 17 | `FilterPanel` component | Steps 8, 9 |
| 18 | `FilterBadge` component | Step 8 |
| 19 | `FeatureInfoPanel` component | Steps 8, 16 |
| 20 | Awareness extension (follow mode) | Steps 8, 9 |
| 21 | Comment model `featureId` extension | — |
| 22 | Room settings creator controls | Steps 5, 6, 8 |
| 23 | External source background indexing | Steps 4, 5, 14 |

---

## Key constraints and gotchas

**PMTiles feature IDs:** The highlight layer and feature selection depend on MapLibre's `['id']` expression, which reads the vector tile feature ID — not a GeoJSON property named `id`. Ensure the PMTiles conversion step generates feature IDs (tippecanoe: `--generate-ids`). The search index must store the same IDs. Verify this before implementing the highlight layer.

**`x-map-party` must survive YAML round-trips in map-party:** maplibre-yaml strips `x-map-party` from the compiled style that it hands to MapLibre, but map-party must retain the pre-strip YAML in a React ref (`parsedLayersRef`) for use by `reapplyLocalFilters` and `ensureHighlightLayers`. Never pass the stripped version to these functions.

**`onStyleReconciled` fires frequently:** Every collaborator's keystroke in the YAML editor triggers a reconciliation. Keep `reapplyLocalFilters` and `ensureHighlightLayers` fast — they should do no async work and no fetching. Both are O(n layers) with O(1) MapLibre API calls per layer.

**2MB row limit:** The search index JSON is stored in R2, not in D1 rows. Do not attempt to store index contents in a D1 column. The D1 record stores only the R2 key and metadata.

**Search index updates:** When a dataset is re-imported or updated, the search index must be regenerated. Add a `search_index_built_at` timestamp column to `datasets` for cache-busting. The `/api/datasets/:id/search-index` endpoint should set `Cache-Control` based on this timestamp.

**`allowLocalFilters: false` rooms:** When this is false, do not render SearchBar, FilterPanel, or FilterBadge. Do not initialize SearchEngine. Do not sync local filters in awareness. This is a pure client-side rendering gate — no server enforcement needed since the filters don't affect stored data.