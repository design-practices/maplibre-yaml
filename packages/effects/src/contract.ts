/**
 * @file The effect contract — what `registerEffect()` takes
 * @module @maplibre-yaml/effects
 *
 * @description
 * **Experimental** (0.7, D-A3): this contract may change in minor releases.
 *
 * An effect is a named, parameterized shader that *enhances* an ordinary
 * static layer. The document references it by name (`effect: { type, ...params }`)
 * and never carries GLSL; page JavaScript registers the shader. The static
 * layer the effect sits on is its fallback, by construction: without the
 * effects package, under an unsupported projection, or on export, that layer
 * renders as authored.
 */

import type { ZodType, ZodTypeDef } from "zod";
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * A uniform value an effect hands its fragment shader.
 *
 * - `number` → `float`
 * - `boolean` → `bool`
 * - a hex color string (`"#rgb"`, `"#rrggbb"`) → `vec3` (0–1 RGB)
 * - a 2/3/4-element number array → `vec2`/`vec3`/`vec4`
 *
 * @experimental
 */
export type UniformValue = number | boolean | string | readonly number[];

/**
 * A texture an effect samples. A string names an image in the map — the
 * document's `images:` entries are registered under their names — or, when
 * it contains a `/`, a URL fetched directly. Programmatic callers may pass
 * decoded pixels.
 *
 * @experimental
 */
export type TextureSource =
  | string
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageData
  | { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** A style-spec layer object, as the fallback hook sees it. @experimental */
export type LayerSpec = Record<string, unknown>;

/**
 * What the library supplies to `effect_color(EffectInput i)`.
 *
 * Documented here for TypeScript readers; the GLSL struct is:
 *
 * ```glsl
 * struct EffectInput {
 *   vec2  uv;        // walls: (along the whole wall, up) in 0..1; roofs: (0.5, 0.5)
 *   vec2  faceSize;  // walls: (length, height) in metres as drawn; roofs: (0, 0)
 *   vec3  normal;    // outward unit normal, x east, y north, z up
 *   float diffuse;   // library lighting: two fixed lights (Tangram's), ~0–1.2
 *   float height;    // metres above the ground, as drawn
 *   bool  isRoof;
 *   vec2  screen;    // gl_FragCoord.xy, device pixels, y up
 *   float time;      // seconds since attach (advances only when `animated`)
 *   vec3  world;     // metres from the effect's anchor: x east, y north, z up
 * };
 * ```
 *
 * @experimental
 */
export interface EffectInputDoc {
  uv: [number, number];
  faceSize: [number, number];
  normal: [number, number, number];
  diffuse: number;
  height: number;
  isRoof: boolean;
  screen: [number, number];
  time: number;
  world: [number, number, number];
}

/** Options a host passes when attaching (all optional). @experimental */
export interface AttachOptions {
  /**
   * Where the extrusions backend's mesh worker lives. Defaults to
   * `extrusions-worker.js` beside the effects bundle.
   */
  workerUrl?: string | URL;
  /** Back-face culling (default true). */
  cull?: boolean;
  /**
   * Depth-only prepass so the effect shades each pixel once (default true;
   * the prepass fetches a single 8-byte attribute, so on a GPU it costs far
   * less than the occluded shading it saves — on SwiftShader it is roughly
   * neutral).
   */
  prepass?: boolean;
  /** Per-frame main-thread budget for uploading built tiles, ms (default 12). */
  buildBudgetMs?: number;
  /**
   * Stitch walls the tile generator cut at tile edges so their texture
   * coordinates run over the whole wall (default true). Diagnostic switch.
   */
  seams?: boolean;
}

/** What a backend needs to draw one effect on one layer. @experimental */
export interface BackendContext<P = unknown> {
  map: MapLibreMap;
  /** The static layer the effect enhances. */
  layerId: string;
  definition: EffectDefinition<P>;
  /** Params after zod parsing (defaults applied). */
  params: P;
  options: AttachOptions;
}

/** A backend's live attachment for one layer. @experimental */
export interface BackendHandle {
  /** False when the backend declared absence (the static layer is showing). */
  readonly active: boolean;
  /** Why it is inactive, when it is. */
  readonly reason?: string;
  /** Resolves once the visible tiles are built (or immediately when inactive). */
  ready(): Promise<void>;
  /** Remove the effect and restore the static layer. Idempotent. */
  detach(): void;
  /** Backend-specific counters, for tests and the demo HUD. */
  readonly stats?: Record<string, number>;
  /** The id of the layer the backend added to the map, when it adds one. */
  readonly customLayerId?: string;
  /** The layer the effect was inserted before (the static layer's upper neighbour). */
  readonly beforeId?: string;
  /** Backend diagnostics for tests (shape may change freely). */
  readonly debug?: Record<string, () => unknown>;
}

/**
 * A rendering backend. Effects choose one; documents never name it (R17).
 *
 * @experimental
 */
export interface Backend {
  readonly name: string;
  /** Layer types this backend can enhance, e.g. `["fill-extrusion"]`. */
  readonly layerTypes: readonly string[];
  attach<P>(ctx: BackendContext<P>): BackendHandle;
}

/**
 * An effect definition — the argument to `registerEffect()`.
 *
 * @experimental
 */
export interface EffectDefinition<P = unknown> {
  /** The name documents use: `effect: { type: <this> }`. Kebab-case. */
  type: string;
  /** Which backend draws it (e.g. `backends.extrusions`). */
  backend: Backend;
  /**
   * The params schema. Documents carry params flat beside `type` (KTD6);
   * with the package loaded, core validates them against this schema at
   * parse time, with line numbers. Use `.default()` for every optional param.
   */
  params: ZodType<P, ZodTypeDef, unknown>;
  /**
   * Sampler uniforms: GLSL name → texture. Strings name the document's
   * `images:` entries.
   */
  textures?: (params: P) => Record<string, TextureSource>;
  /** Value uniforms: GLSL name → value (types inferred, see {@link UniformValue}). */
  uniforms?: (params: P) => Record<string, UniformValue>;
  /**
   * GLSL ES 3.00 source defining `vec4 effect_color(EffectInput i)`; may
   * declare its own helper functions. The library declares the uniforms and
   * samplers above, the `EffectInput` struct and the `fx_*` helpers. Return
   * premultiplied RGBA (alpha 1 for opaque).
   */
  fragment: string;
  /**
   * The export lowering: the layer the emitted style should carry instead of
   * the effect — usually the layer unchanged (`(p, layer) => layer`), or
   * `null` when the layer doesn't export. Mandatory: an effect without a fallback is a
   * silent hole in every exported map.
   */
  fallback: (params: P, layer: LayerSpec) => LayerSpec | null;
  /**
   * True when the shader reads `i.time`: the backend then repaints every
   * frame while attached. False (the default) means the effect never calls
   * `triggerRepaint` on its own — an idle map stays idle (KTD7).
   */
  animated?: boolean;
  /**
   * A height multiplier the backend applies on top of the layer's own
   * `fill-extrusion-height`/`-base` (e.g. Tangram's zoom-dependent
   * exaggeration). Default: 1.
   */
  heightScale?: (zoom: number, params: P) => number;
  /** One line for docs and error messages. */
  description?: string;
}
