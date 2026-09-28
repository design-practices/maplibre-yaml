/**
 * @file U12 SPIKE session 2 — Tangram's crosshatch building shading on deck.gl
 *
 * @description
 * A port of the building style from Tangram's crosshatch (tangram-sandbox
 * styles/crosshatch.yaml, @patriciogv 2015, MIT) and its tonal hatch filter
 * (tangrams/blocks filter/hatch.yaml, after Jaume Sanchez's cross-hatching
 * shader, MIT) onto deck's SolidPolygonLayer by shader string-splice:
 *
 *  - texcoords: Tangram gives every wall face its own 0..1 texcoords; deck's
 *    side-wall vertex already carries exactly that (`positions.xy` = the
 *    quad corner: x along the wall, y up it).
 *  - brightness: Tangram's two lights (directional, default direction
 *    [0.2, 0.7, -0.5], diffuse 1; point light south-above centre, diffuse .5,
 *    treated as directional) × its base-darkening gradient clamp(v·1.5)+0.2,
 *    × `gain` (exposure; Tangram's absolute light levels differ from ours).
 *  - tone: brightness picks a cell of a 3×3 tonal atlas and blends to the next
 *    darker one — shaded faces get DENSER strokes, not a grey tint (the one
 *    thing a style.json fill-extrusion cannot do).
 *  - a noisy paper margin at face borders + a 1px ink outline (fwidth) on
 *    wall verticals and roof edges (Tangram's `buildingsLines`).
 *
 * The atlas is sampled with textureGrad on the continuous coordinate so
 * mipmapping works without seams at the cell borders fract() introduces.
 */

import { SolidPolygonLayer, type SolidPolygonLayerProps } from "@deck.gl/layers";
import type { DefaultProps, UpdateParameters } from "@deck.gl/core";
import type { Texture } from "@luma.gl/core";

export type CrosshatchLayerProps<D = unknown> = SolidPolygonLayerProps<D> & {
  /** The 3×3 tonal hatch atlas (tangrams/blocks filter/imgs/hatch.png). */
  hatchImage: ImageBitmap | null;
  /** Brightness exposure. */
  gain?: number;
};

const INK = "vec3(0.302, 0.302, 0.306)";
const PAPER = "vec3(0.976, 0.953, 0.890)";

const VS_DECL = /* glsl */ `
out vec2 vHatchUV;
out float vHatchDiffuse;
out float vHatchRoof;
`;

const VS_LIGHT = /* glsl */ `
  {
    vec3 n = normalize(normal);
#ifdef IS_SIDE_VERTEX
    n = -n; // deck's side normal points INTO the building for its ring winding
    vHatchUV = vec2(positions.x, positions.y);
    vHatchRoof = 0.0;
#else
    vHatchUV = vec2(0.5, 0.6);
    vHatchRoof = 1.0;
#endif
    vec3 Ld = normalize(vec3(-0.2, -0.7, 0.5));
    vec3 Lp = normalize(vec3(0.0, -1.0, 1.0));
    vHatchDiffuse = max(0.0, dot(n, Ld)) + 0.5 * max(0.0, dot(n, Lp));
  }
`;

const FS_DECL = /* glsl */ `
in vec2 vHatchUV;
in float vHatchDiffuse;
in float vHatchRoof;
uniform sampler2D hatchAtlas;
const float HATCH_GAIN = __GAIN__;
float hatch_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hatch_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hatch_hash(i), hatch_hash(i + vec2(1.0, 0.0)), u.x),
             mix(hatch_hash(i + vec2(0.0, 1.0)), hatch_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// One tone cell: 9 levels in a 3×3 grid, rows indexed bottom-up (Tangram
// uploads with GL flipY; we don't, so flip here).
float hatch_sample(float b, vec2 st, vec2 dx, vec2 dy) {
  vec2 p = fract(vec2(floor(b * 9.0) / 3.0, floor(b * 3.0) / 3.0) + st);
  return textureGrad(hatchAtlas, vec2(p.x, 1.0 - p.y), dx, dy).a;
}
float getHatch(vec2 uv, float brightness) {
  vec2 st = fract(uv) / 3.0;
  vec2 dx = dFdx(uv / 3.0), dy = dFdy(uv / 3.0);
  brightness = clamp(brightness, 0.0, 0.9999999);
  float minB = clamp(brightness - 0.111111111, 0.0, 1.0);
  return mix(hatch_sample(brightness, st, dx, dy), hatch_sample(minB, st, dx, dy),
             1.0 - fract(brightness * 9.0));
}
`;

const FS_MAIN = /* glsl */ `
  vec2 uv = vHatchUV;
  float b = HATCH_GAIN * vHatchDiffuse * (clamp(uv.y * 1.5, 0.0, 1.0) + 0.2);
  float pattern = 1.0 - getHatch(uv, b);
  vec2 edge = vec2(0.1, 0.05) * hatch_noise(uv * 20.0);
  vec2 blend = smoothstep(vec2(0.0), edge, uv) * smoothstep(vec2(0.0), edge, vec2(1.0) - uv);
  float t = mix(1.0, pattern, blend.x * blend.y);
  vec2 fw = max(fwidth(uv), vec2(1e-5));
  float px = min(min(uv.x, 1.0 - uv.x) / fw.x, (1.0 - uv.y) / fw.y);
  float line = (1.0 - vHatchRoof) * (1.0 - smoothstep(0.6, 1.4, px));
  fragColor = vec4(mix(mix(${INK}, ${PAPER}, t), ${INK}, line * 0.85), vColor.a);
`;

function splice(src: string, anchor: string, insert: string, replace = false): string {
  if (!src.includes(anchor)) {
    throw new Error(`[crosshatch] shader anchor not found: ${anchor} (deck version drift)`);
  }
  return src.replace(anchor, replace ? insert : `${anchor}\n${insert}`);
}

const defaultProps: DefaultProps<CrosshatchLayerProps> = {
  hatchImage: { type: "object", value: null, async: false } as never,
  gain: 0.72,
};

export class CrosshatchLayer<D = unknown> extends SolidPolygonLayer<D, CrosshatchLayerProps<D>> {
  static override layerName = "CrosshatchLayer";
  static override defaultProps = defaultProps as never;

  declare state: SolidPolygonLayer["state"] & { hatchTexture?: Texture; hatchSource?: ImageBitmap };

  override getShaders(type: "top" | "side") {
    const s = super.getShaders(type);
    let vs = splice(s.vs, "out vec4 vColor;", VS_DECL);
    vs = splice(vs, "geometry.normal = normal;", VS_LIGHT);
    let fs = splice(s.fs, "out vec4 fragColor;", FS_DECL.replace("__GAIN__", (this.props.gain ?? 0.72).toFixed(4)));
    fs = splice(fs, "fragColor = vColor;", FS_MAIN, true);
    return { ...s, vs, fs };
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    // `gain` is compiled into the shader (spike simplicity): the runtime keys
    // the layer id on it, so a gain change is a fresh layer, not an update.
    const { props } = params;
    const image = props.hatchImage;
    if (image && this.state.hatchSource !== image) {
      this.state.hatchTexture?.destroy();
      this.state.hatchTexture = this.context.device.createTexture({
        data: image,
        mipmaps: true,
        sampler: {
          minFilter: "linear",
          magFilter: "linear",
          mipmapFilter: "linear",
          addressModeU: "repeat",
          addressModeV: "repeat",
        },
      });
      this.state.hatchSource = image;
    }
  }

  override draw(opts: Parameters<SolidPolygonLayer["draw"]>[0]) {
    if (!this.state.hatchTexture) return;
    for (const model of this.getModels()) model.setBindings({ hatchAtlas: this.state.hatchTexture });
    super.draw(opts);
  }

  override finalizeState(context: Parameters<SolidPolygonLayer["finalizeState"]>[0]) {
    super.finalizeState(context);
    this.state.hatchTexture?.destroy();
  }
}
