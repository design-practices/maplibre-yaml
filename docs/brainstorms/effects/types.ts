/**
 * @maplibre-yaml/effects — extension contract (draft spec v0.2)
 *
 * Design invariants this file encodes:
 *
 *  1. ERASABILITY IS PER-EFFECT AND MANDATORY. Every effect must declare
 *     `fallback()`, returning plain spec-valid layer(s). The compiler's
 *     `--with-fallbacks` mode and mapparty's "Static bundle" export both
 *     call it. An effect without a meaningful fallback cannot be merged.
 *
 *  2. THE SCHEMA IS THE UI. `paramsSchema` is a real schema object (zod).
 *     It drives (a) build-time validation in the compiler, (b) generated
 *     TypeScript types, and (c) auto-generated parameter panels in the app
 *     via zod introspection + the `ui` annotations below.
 *
 *  3. EFFECTS OWN NOTHING GLOBAL. An effect receives a resolved data source
 *     and a context; it may not touch the style, other layers, or the DOM.
 *     Interactivity belongs to @maplibre-yaml/interactions. Lighting is
 *     scene-scoped (`runtime.lighting`), not per-effect.
 *
 *  4. WHOLE-SOURCE ONLY (v1). Effects operate on fully-loaded GeoJSON.
 *     No tile plumbing: custom layers don't participate in MapLibre's tile
 *     lifecycle, and reimplementing it is explicitly out of scope.
 *
 *  5. TWO BACKENDS, ONE CONTRACT. `create()` may return either a raw
 *     MapLibre CustomLayerInterface or a DeckEffectDescriptor. The fallback
 *     contract is identical for both; the eject guarantee never learns
 *     which backend an effect used.
 */

import type {
  CustomLayerInterface,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { ZodType } from "zod";
import type { FeatureCollection } from "geojson";

/** Geometry class an effect can bind to. Drives catalog filtering in the app. */
export type EffectGeometry = "point" | "line" | "polygon";

/**
 * UI hints per parameter, keyed by param name. Purely presentational;
 * validation always comes from the zod schema itself.
 */
export interface ParamUIHints {
  [param: string]: {
    label?: string;
    control?: "slider" | "color" | "palette" | "select" | "toggle";
    min?: number;
    max?: number;
    step?: number;
    unit?: string; // display only, e.g. 'px', 's', '°'
  };
}

/** What the runtime hands an effect when instantiating it. */
export interface EffectContext {
  map: MapLibreMap;
  /** Fully resolved GeoJSON for the bound layer's source. */
  data: FeatureCollection;
  /** Resolved `global:` values so effects can consume $color.* tokens. */
  globals: Record<string, unknown>;
  /** Layer id from the YAML document; use to derive stable GL layer ids. */
  layerId: string;
  /** Insert-before target computed by the compiler's order resolution. */
  beforeId?: string;
}

/**
 * Capability requirements checked before instantiation. If unmet, the
 * runtime renders `fallback()` instead and emits a console warning —
 * degradation, never a blank layer.
 */
export interface EffectRequirements {
  webgl2?: boolean;
  /**
   * Effect is incompatible with globe projection (renders fallback there).
   * All deck-backed effects should set this until the interleaved-mode
   * globe story matures.
   */
  mercatorOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/* Deck backend                                                        */
/* ------------------------------------------------------------------ */

/**
 * Returned by `create()` for deck-backed effects. Deck types are opaque
 * here (`unknown[]`) so that @maplibre-yaml/effects carries no deck
 * dependency; @maplibre-yaml/effects-deck narrows them.
 *
 * Runtime contract:
 *  - Exactly ONE shared MapboxOverlay (interleaved mode) exists per map;
 *    the runtime merges every descriptor's layers into it, ordered by the
 *    compiler's order resolution via each layer's `beforeId`.
 *  - If `animate` is true, the runtime drives a rAF clock and re-invokes
 *    `getLayers(clock)` each frame, calling overlay.setProps({ layers }).
 *    Effects never own their own animation loop.
 *  - `getEffects()` contributions (e.g. LightingEffect) are merged, but a
 *    document-level `runtime.lighting` block takes precedence — lighting
 *    is honest about being scene-global.
 */
export interface DeckEffectDescriptor {
  backend: "deck";
  animate?: boolean;
  /** deck Layer instances for the shared overlay. `clock` is seconds. */
  getLayers(clock: number): unknown[];
  /** Optional deck Effect instances (lighting etc.). */
  getEffects?(): unknown[];
}

export function isDeckDescriptor(
  v: CustomLayerInterface | DeckEffectDescriptor,
): v is DeckEffectDescriptor {
  return (v as DeckEffectDescriptor).backend === "deck";
}

/* ------------------------------------------------------------------ */
/* Fallbacks                                                           */
/* ------------------------------------------------------------------ */

/**
 * A fallback is one or more spec layers, optionally plus sprite assets the
 * build pipeline must rasterize and merge into the project sprite sheet.
 * `id` and `source` are injected by the compiler — fallbacks declare only
 * type/paint/layout/filter (plus an optional idSuffix when emitting
 * multiple layers).
 */
export interface FallbackResult {
  layers: Array<
    Omit<LayerSpecification, "id" | "source"> & { idSuffix?: string }
  >;
  sprites?: SpriteRequest[];
}

/** An SVG the build step rasterizes into the sprite sheet (via spreet). */
export interface SpriteRequest {
  /** Referenced by fallback paint, e.g. 'fill-pattern': name. */
  name: string;
  /** Generated SVG markup — must be a deterministic function of params. */
  svg: string;
}

/* ------------------------------------------------------------------ */
/* The effect definition                                               */
/* ------------------------------------------------------------------ */

export interface EffectDefinition<P = unknown> {
  /** Kebab-case identifier used as `effect.type` in YAML. */
  type: string;

  /** One-line description surfaced in the app's effect catalog. */
  description: string;

  /** Geometry classes this effect accepts. */
  geometry: EffectGeometry[];

  /** Zod schema for the params object. Source of truth for validation + UI. */
  paramsSchema: ZodType<P>;

  /** Optional presentational hints for the generated parameter panel. */
  ui?: ParamUIHints;

  requirements?: EffectRequirements;

  /**
   * Build the live layer. Called client-side by the runtime after params
   * validate and requirements pass. Raw-GL effects return a
   * CustomLayerInterface whose `id` derives from ctx.layerId (convention:
   * `${ctx.layerId}__fx`). Deck-backed effects return a
   * DeckEffectDescriptor.
   */
  create(
    params: P,
    ctx: EffectContext,
  ): CustomLayerInterface | DeckEffectDescriptor;

  /**
   * REQUIRED. Static degradation as plain style-spec layer(s), styled to
   * approximate the effect's resting state. Runs at COMPILE time (node),
   * so it may not touch WebGL, deck, or the map — params and globals only.
   */
  fallback(params: P, globals: Record<string, unknown>): FallbackResult;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const registry = new Map<string, EffectDefinition<any>>();

export function registerEffect<P>(def: EffectDefinition<P>): void {
  if (registry.has(def.type)) {
    throw new Error(
      `[maplibre-yaml/effects] duplicate effect type "${def.type}"`,
    );
  }
  if (typeof def.fallback !== "function") {
    // Enforced at registration, not just by types: JS consumers exist.
    throw new Error(
      `[maplibre-yaml/effects] effect "${def.type}" has no fallback(); ` +
        `every effect must degrade to spec-valid layers`,
    );
  }
  registry.set(def.type, def);
}

export function getEffect(type: string): EffectDefinition<any> | undefined {
  return registry.get(type);
}

/** Used by the compiler to hard-fail on unknown runtime keys (--strict). */
export function listEffects(): string[] {
  return [...registry.keys()];
}
