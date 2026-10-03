/**
 * @file U12 SPIKE — hatch-fill as a deck.gl layer (throwaway; evidence, not product)
 *
 * @description
 * The prior art's raw-GL hatch shader (docs/brainstorms/effects/hatchFill.ts)
 * re-expressed on the deck backend (KTD2): a SolidPolygonLayer whose
 * fragment color is replaced, via deck's `fs:DECKGL_FILTER_COLOR` hook, by a
 * SCREEN-SPACE stripe field computed from gl_FragCoord — so stroke density
 * stays constant across zoom, the one property a fill-pattern fallback
 * cannot reproduce (patterns scale with tiles).
 *
 * Params → uniforms: angle/spacing/thickness/cross/ink live in a luma.gl
 * uniform-block shader module (`hatch`), set per draw from layer props.
 * Changing a param is a plain `setProps` — deck diffs props and redraws once;
 * nothing here schedules frames (KTD7's static clause).
 *
 * `animate` (spike-only knob): when > 0 the stripe field drifts by
 * `phase`, which the harness advances per frame to model an ANIMATED
 * effect for the perf budget. Hatch-fill itself is static.
 */

import { SolidPolygonLayer, type SolidPolygonLayerProps } from "@deck.gl/layers";
import type { DefaultProps, UpdateParameters } from "@deck.gl/core";

/** Effect params (flat, KTD6) — the shape `x-effect` carries in the doc. */
export interface HatchParams {
  angle: number; // degrees
  spacing: number; // CSS px between stroke centerlines
  thickness: number; // CSS px
  cross: boolean;
  color: [number, number, number, number]; // RGBA 0–255
}

export type HatchLayerProps<D = unknown> = SolidPolygonLayerProps<D> & {
  hatch: HatchParams;
  /** Stripe phase in CSS px (animation knob for the perf harness). */
  phase?: number;
  /** Synthetic per-fragment cost multiplier (harness validity only). */
  heavy?: number;
};

const hatchModule = {
  name: "hatch",
  fs: /* glsl */ `\
layout(std140) uniform hatchUniforms {
  vec4 ink;
  float angle;
  float spacing;
  float thickness;
  float cross;
  float dpr;
  float phase;
  float heavy;
} hatch;

float hatch_stripes(vec2 p, float angle) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float d = dot(p, vec2(-dir.y, dir.x)) + hatch.phase * hatch.dpr;
  float spacing = hatch.spacing * hatch.dpr;
  float half_t = hatch.thickness * hatch.dpr * 0.5;
  float m = abs(fract(d / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(half_t - 0.5, half_t + 0.5, m);
}
`,
  uniformTypes: {
    ink: "vec4<f32>",
    angle: "f32",
    spacing: "f32",
    thickness: "f32",
    cross: "f32",
    dpr: "f32",
    phase: "f32",
    heavy: "f32",
  },
} as const;

const defaultProps: DefaultProps<HatchLayerProps> = {
  hatch: {
    type: "object",
    value: { angle: 45, spacing: 8, thickness: 1.25, cross: false, color: [29, 53, 87, 255] },
    compare: true,
  },
  phase: 0,
  heavy: 0,
};

export class HatchLayer<D = unknown> extends SolidPolygonLayer<D, HatchLayerProps<D>> {
  static override layerName = "HatchLayer";
  static override defaultProps = defaultProps as never;

  override getShaders(type: "top" | "side") {
    const shaders = super.getShaders(type);
    return {
      ...shaders,
      modules: [...shaders.modules, hatchModule],
      inject: {
        "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  float ink = hatch_stripes(gl_FragCoord.xy, hatch.angle);
  if (hatch.cross > 0.5) ink = max(ink, hatch_stripes(gl_FragCoord.xy, hatch.angle + 1.5707963));
  // Harness-validity knob: burn ALU per fragment without changing output.
  float burn = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (float(i) >= hatch.heavy) break;
    burn += sin(float(i) * gl_FragCoord.x) * 1e-9;
  }
  color = vec4(hatch.ink.rgb, hatch.ink.a * ink + burn);
`,
      },
    };
  }

  override draw(opts: { uniforms: unknown }) {
    const { hatch, phase = 0, heavy = 0 } = this.props;
    const uniforms = {
      ink: hatch.color.map((c) => c / 255) as [number, number, number, number],
      angle: (hatch.angle * Math.PI) / 180,
      spacing: hatch.spacing,
      thickness: hatch.thickness,
      cross: hatch.cross ? 1 : 0,
      dpr: this.context.device.canvasContext?.cssToDeviceRatio?.() ?? globalThis.devicePixelRatio ?? 1,
      phase,
      heavy,
    };
    const { topModel, sideModel } = this.state as {
      topModel?: { shaderInputs: { setProps(p: unknown): void } };
      sideModel?: { shaderInputs: { setProps(p: unknown): void } };
    };
    topModel?.shaderInputs.setProps({ hatch: uniforms });
    sideModel?.shaderInputs.setProps({ hatch: uniforms });
    super.draw(opts as never);
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);
  }
}
