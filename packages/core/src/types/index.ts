/**
 * @file Type re-exports for convenient access to all schema-inferred types
 * @module @maplibre-yaml/core/types
 *
 * @description
 * This module provides convenient access to all TypeScript types inferred from Zod schemas.
 * Use this for type annotations without importing from individual schema files.
 *
 * @example
 * ```typescript
 * import type { MapConfig, Layer, Page, RootConfig } from '@maplibre-yaml/core/types';
 *
 * const config: MapConfig = {
 *   mapStyle: 'https://demotiles.maplibre.org/style.json',
 *   center: [-74, 40],
 *   zoom: 10,
 * };
 * ```
 */

import type { z } from "zod";
import type {
  // Base types
  LngLatSchema,
  LngLatBoundsSchema,
  ColorSchema,
  ExpressionSchema,

  // Source types
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
  LayerSourceSchema,

  // Layer types
  LayerSchema,
  CircleLayerSchema,
  LineLayerSchema,
  FillLayerSchema,
  SymbolLayerSchema,
  RasterLayerSchema,
  HillshadeLayerSchema,
  HeatmapLayerSchema,
  FillExtrusionLayerSchema,
  BackgroundLayerSchema,

  // Map types
  MapConfigSchema,
  ControlsConfigSchema,
  LegendConfigSchema,
  MapBlockSchema,

  // Content types
  ContentBlockSchema,

  // Scrollytelling types
  ChapterSchema,
  ScrollytellingBlockSchema,

  // Page and root types
  PageSchema,
  RootSchema,
} from "../schemas";

// GeoJSON types
export type { GeoJSON } from "geojson";

// Base types
export type LngLat = z.infer<typeof LngLatSchema>;
export type LngLatBounds = z.infer<typeof LngLatBoundsSchema>;
export type Color = z.infer<typeof ColorSchema>;
export type Expression = z.infer<typeof ExpressionSchema>;

// Source types
export type GeoJSONSourceConfig = z.infer<typeof GeoJSONSourceSchema>;
export type VectorSourceConfig = z.infer<typeof VectorSourceSchema>;
export type RasterSourceConfig = z.infer<typeof RasterSourceSchema>;
export type ImageSourceConfig = z.infer<typeof ImageSourceSchema>;
export type VideoSourceConfig = z.infer<typeof VideoSourceSchema>;
export type LayerSource = z.infer<typeof LayerSourceSchema>;

// Layer types
export type Layer = z.infer<typeof LayerSchema>;
export type CircleLayer = z.infer<typeof CircleLayerSchema>;
export type LineLayer = z.infer<typeof LineLayerSchema>;
export type FillLayer = z.infer<typeof FillLayerSchema>;
export type SymbolLayer = z.infer<typeof SymbolLayerSchema>;
export type RasterLayer = z.infer<typeof RasterLayerSchema>;
export type HillshadeLayer = z.infer<typeof HillshadeLayerSchema>;
export type HeatmapLayer = z.infer<typeof HeatmapLayerSchema>;
export type FillExtrusionLayer = z.infer<typeof FillExtrusionLayerSchema>;
export type BackgroundLayer = z.infer<typeof BackgroundLayerSchema>;

// Map types
export type MapConfig = z.infer<typeof MapConfigSchema>;
export type ControlsConfig = z.infer<typeof ControlsConfigSchema>;
export type LegendConfig = z.infer<typeof LegendConfigSchema>;
export type MapBlock = z.infer<typeof MapBlockSchema>;

// Content types
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// Scrollytelling types
export type Chapter = z.infer<typeof ChapterSchema>;
export type ScrollytellingBlock = z.infer<typeof ScrollytellingBlockSchema>;

// Page and root types
export type Page = z.infer<typeof PageSchema>;
export type RootConfig = z.infer<typeof RootSchema>;

// Union types for convenience
export type Block = MapBlock | ContentBlock | ScrollytellingBlock;
export type AnyLayer =
  | CircleLayer
  | LineLayer
  | FillLayer
  | SymbolLayer
  | RasterLayer
  | HillshadeLayer
  | HeatmapLayer
  | FillExtrusionLayer
  | BackgroundLayer;
