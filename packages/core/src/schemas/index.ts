/**
 * @file Central export file for all MapLibre YAML schemas
 * @module @maplibre-yaml/core/schemas
 *
 * @description
 * This module provides a centralized export point for all Zod schemas used in the
 * MapLibre YAML configuration system. These schemas validate and type-check YAML
 * configurations for creating interactive map applications.
 *
 * ## Schema Categories
 *
 * ### Base Schemas
 * Foundational schemas for coordinates, colors, and expressions used throughout
 * the configuration system.
 *
 * ### Source Schemas
 * Schemas for defining data sources (GeoJSON, vector tiles, raster tiles, etc.)
 * that provide data to map layers.
 *
 * ### Layer Schemas
 * Schemas for all MapLibre layer types (circle, line, fill, symbol, etc.) including
 * paint properties, layout properties, popups, and legends.
 *
 * ### Content Schemas
 * Schemas for rich HTML content blocks that can be used in pages and scrollytelling.
 *
 * ### Map Schemas
 * Schemas for map blocks, including configuration, controls, and legends.
 *
 * ### Scrollytelling Schemas
 * Schemas for narrative scrollytelling experiences with chapters and actions.
 *
 * ### Page Schemas
 * Top-level schemas for pages, blocks, and the root configuration structure.
 *
 * @example
 * Basic schema usage
 * ```typescript
 * import { RootSchema } from '@maplibre-yaml/core/schemas';
 *
 * const config = {
 *   pages: [
 *     {
 *       path: '/',
 *       title: 'Home',
 *       blocks: [
 *         {
 *           type: 'map',
 *           id: 'main-map',
 *           config: {
 *             center: [0, 0],
 *             zoom: 2,
 *             mapStyle: 'https://example.com/style.json'
 *           }
 *         }
 *       ]
 *     }
 *   ]
 * };
 *
 * const validated = RootSchema.parse(config);
 * ```
 *
 * @example
 * Type inference from schemas
 * ```typescript
 * import { z } from 'zod';
 * import { LayerSchema, PageSchema } from '@maplibre-yaml/core/schemas';
 *
 * type Layer = z.infer<typeof LayerSchema>;
 * type Page = z.infer<typeof PageSchema>;
 * ```
 */

// Base schemas
export {
  LongitudeSchema,
  LatitudeSchema,
  LngLatSchema,
  LngLatBoundsSchema,
  ColorSchema,
  ExpressionSchema,
  NumberOrExpressionSchema,
  ColorOrExpressionSchema,
  ZoomLevelSchema,
} from "./base.schema";

// Source schemas
export {
  StreamConfigSchema,
  LoadingConfigSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
  LayerSourceSchema,
} from "./source.schema";

// Layer schemas
export {
  PopupContentItemSchema,
  PopupContentSchema,
  InteractiveConfigSchema,
  LegendItemSchema,
  BaseLayerPropertiesSchema,
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  FillExtrusionLayerSchema,
  HeatmapLayerSchema,
  HillshadeLayerSchema,
  BackgroundLayerSchema,
  LayerSchema,
  LayerReferenceSchema,
  LayerOrReferenceSchema,
} from "./layer.schema";

// Content schemas
export {
  ValidTagNames,
  ContentElementSchema,
  ContentItemSchema,
  ContentBlockSchema,
} from "./content.schema";

// Map schemas
export {
  ControlPositionSchema,
  ControlsConfigSchema,
  LegendConfigSchema,
  MapConfigSchema,
  MapBlockSchema,
  MapFullPageBlockSchema,
} from "./map.schema";

// Scrollytelling schemas and types
export {
  ChapterActionSchema,
  ChapterLayersSchema,
  ChapterSchema,
  ScrollytellingBlockSchema,
} from "./scrollytelling.schema";
export type { Chapter, ChapterAction, ChapterLayers } from "./scrollytelling.schema";

// Page schemas
export {
  MixedBlockSchema,
  BlockSchema,
  PageSchema,
  GlobalConfigSchema,
  RootSchema,
} from "./page.schema";
