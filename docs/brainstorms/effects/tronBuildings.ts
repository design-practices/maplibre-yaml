/**
 * tron-buildings — extruded buildings with an animated emissive grid,
 * demonstrating the deck backend of the effect contract. Lives in
 * @maplibre-yaml/effects-deck (deck.gl is a peer dependency of THIS
 * package only; @maplibre-yaml/effects never imports deck).
 *
 * YAML:
 *   runtime:
 *     effects:
 *       downtown:
 *         layer: buildings
 *         type: tron-buildings
 *         heightProperty: height_m
 *         grid: 24
 *         pulse: 0.4
 *         base: '#0b1026'
 *         glow: $color.primary
 *
 * What this example proves about the contract:
 *  - `create()` returning a DeckEffectDescriptor instead of a
 *    CustomLayerInterface, with `animate: true` so the shared runtime's
 *    clock drives `getLayers(clock)` → overlay.setProps each frame.
 *    Effects never own an animation loop.
 *  - A luma.gl LayerExtension with a DECKGL_FILTER_COLOR injection is
 *    Tangram's `blocks: color:` reborn — tessellation, extrusion, normals,
 *    and the render loop are deck's problem; we write a fragment.
 *  - `mercatorOnly: true`: interleaved deck under globe projection is not
 *    supported, so the runtime renders the fallback there. Degradation,
 *    never blankness.
 *  - The fallback is a plain `fill-extrusion` with a height ramp — the
 *    eject guarantee never learns deck exists.
 */

import { z } from "zod";
import { LayerExtension } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import type { Feature } from "geojson";
import {
  registerEffect,
  type DeckEffectDescriptor,
  type EffectContext,
  type FallbackResult,
} from "@maplibre-yaml/effects"; // re-exports ./types
import { resolveColor, type RGBA } from "@maplibre-yaml/effects/util";

const paramsSchema = z.object({
  heightProperty: z.string().default("height"),
  heightScale: z.number().min(0.1).max(10).default(1),
  grid: z.number().min(4).max(128).default(24), // grid cell, meters
  pulse: z.number().min(0).max(2).default(0.4), // pulses / second
  base: z.string().default("#0b1026"),
  glow: z.string().default("#00e5ff"),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * Emissive grid via shader injection. Uses the layer's common position
 * (meters, layer-relative) so grid lines are stable in world space, and
 * brightens near cell edges with a pulse traveling up the z axis.
 *
 * Injection points are luma.gl's standard hooks; `inject` keys are the
 * documented stable surface for extensions.
 */
class EmissiveGridExtension extends LayerExtension<{
  gridSize: number;
  pulseHz: number;
  glowColor: RGBA;
  clock: number;
}> {
  static extensionName = "EmissiveGridExtension";

  getShaders() {
    return {
      inject: {
        "vs:#decl": /* glsl */ `
          out vec3 grid_commonPos;
        `,
        "vs:#main-end": /* glsl */ `
          grid_commonPos = geometry.position.xyz;
        `,
        "fs:#decl": /* glsl */ `
          in vec3 grid_commonPos;
          uniform float grid_size;
          uniform float grid_pulseHz;
          uniform float grid_clock;
          uniform vec4  grid_glow;

          float gridLine(float v) {
            float m = abs(fract(v / grid_size) - 0.5) * grid_size;
            return 1.0 - smoothstep(0.0, 1.5, m);
          }
        `,
        "fs:DECKGL_FILTER_COLOR": /* glsl */ `
          float g = max(
            max(gridLine(grid_commonPos.x), gridLine(grid_commonPos.y)),
            gridLine(grid_commonPos.z)
          );
          float wave = 0.5 + 0.5 * sin(
            grid_commonPos.z * 0.15 - grid_clock * grid_pulseHz * 6.2831853
          );
          color.rgb = mix(color.rgb, grid_glow.rgb, g * (0.35 + 0.65 * wave));
        `,
      },
    };
  }

  draw(this: any): void {
    const { gridSize, pulseHz, glowColor, clock } = this.props;
    for (const model of this.getModels()) {
      model.setUniforms({
        grid_size: gridSize,
        grid_pulseHz: pulseHz,
        grid_clock: clock,
        grid_glow: glowColor,
      });
    }
  }
}

function create(params: Params, ctx: EffectContext): DeckEffectDescriptor {
  const base = resolveColor(params.base, ctx.globals);
  const glow = resolveColor(params.glow, ctx.globals);
  const to255 = (c: RGBA): [number, number, number, number] =>
    [c[0] * 255, c[1] * 255, c[2] * 255, c[3] * 255].map(Math.round) as [
      number,
      number,
      number,
      number,
    ];

  const getElevation = (f: Feature): number =>
    Number(f.properties?.[params.heightProperty] ?? 10) * params.heightScale;

  return {
    backend: "deck",
    animate: params.pulse > 0,

    getLayers(clock: number) {
      return [
        new SolidPolygonLayer({
          id: `${ctx.layerId}__fx`,
          // interleaved-mode stacking: honor the compiler's order resolution
          beforeId: ctx.beforeId,
          data: ctx.data.features,
          getPolygon: (f: Feature) =>
            f.geometry.type === "Polygon"
              ? f.geometry.coordinates
              : f.geometry.type === "MultiPolygon"
              ? f.geometry.coordinates[0] // v1: largest-ring simplification
              : [],
          extruded: true,
          getElevation,
          getFillColor: to255(base),
          material: { ambient: 0.35, diffuse: 0.6, shininess: 40 },
          pickable: true, // routes into @maplibre-yaml/interactions handlers
          extensions: [new EmissiveGridExtension()],
          // extension props (passed through to draw())
          gridSize: params.grid,
          pulseHz: params.pulse,
          glowColor: glow,
          clock,
          updateTriggers: { clock },
        } as any),
      ];
    },
    // No getEffects(): lighting comes from the document-level
    // `runtime.lighting` block, merged by the shared runtime.
  };
}

/**
 * Fallback: plain fill-extrusion with the base color and a subtle
 * height-driven brightening toward the glow color — the resting-state
 * silhouette of the effect, in pure style spec.
 */
function fallback(
  params: Params,
  globals: Record<string, unknown>,
): FallbackResult {
  return {
    layers: [
      {
        type: "fill-extrusion",
        paint: {
          "fill-extrusion-height": [
            "*",
            ["coalesce", ["get", params.heightProperty], 10],
            params.heightScale,
          ],
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", params.heightProperty], 10],
            0,
            resolveColor(params.base, globals, "css"),
            150,
            resolveColor(params.glow, globals, "css"),
          ],
          "fill-extrusion-opacity": 0.95,
        },
      },
    ],
  };
}

registerEffect<Params>({
  type: "tron-buildings",
  description: "Extruded buildings with an animated emissive grid (deck)",
  geometry: ["polygon"],
  paramsSchema,
  ui: {
    heightProperty: { label: "Height field", control: "select" },
    heightScale: {
      label: "Height scale",
      control: "slider",
      min: 0.1,
      max: 10,
      step: 0.1,
    },
    grid: {
      label: "Grid size",
      control: "slider",
      min: 4,
      max: 128,
      unit: "m",
    },
    pulse: {
      label: "Pulse",
      control: "slider",
      min: 0,
      max: 2,
      step: 0.1,
      unit: "Hz",
    },
    base: { label: "Base", control: "color" },
    glow: { label: "Glow", control: "color" },
  },
  requirements: { webgl2: true, mercatorOnly: true },
  create,
  fallback,
});
