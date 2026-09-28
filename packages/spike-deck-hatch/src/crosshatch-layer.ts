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
 *
 * Session 3 (route-1 optimization) adds opt-in `cull` / `prepass` /
 * `minorLod` (route 2's levers). The route-1 runtime's default path no longer
 * uses this layer — see crosshatch-mesh-layer.ts — but it stays as the
 * `geom=mvt` variant and the before/after baseline.
 */

import { SolidPolygonLayer, type SolidPolygonLayerProps } from "@deck.gl/layers";
import type { DefaultProps, UpdateParameters } from "@deck.gl/core";
import type { Texture } from "@luma.gl/core";

export type CrosshatchLayerProps<D = unknown> = SolidPolygonLayerProps<D> & {
  /** The 3×3 tonal hatch atlas (tangrams/blocks filter/imgs/hatch.png). */
  hatchImage: ImageBitmap | null;
  /** Brightness exposure. */
  gain?: number;
  /** Back-face culling (walls CCW, roofs CW — measured). */
  cull?: boolean;
  /** Depth-only pass first, so the hatch runs once per visible pixel. */
  prepass?: boolean;
  /** Mip level from the minor derivative axis (route 2's anti-smear). */
  minorLod?: boolean;
};

export const INK = "vec3(0.302, 0.302, 0.306)";
export const PAPER = "vec3(0.976, 0.953, 0.890)";

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

/** Fragment-stage declarations shared by both route-1 layers. */
export const FS_DECL = /* glsl */ `
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
#if HATCH_MINOR_LOD
  // Route 2's anti-smear: isotropic filtering takes the LOD from the MAJOR
  // derivative axis and smears strokes on long thin walls; scale both
  // gradients so it follows the MINOR axis (cheap; aniso costs ~3x in SwiftShader).
  float lx = length(dx), ly = length(dy);
  float k = min(lx, ly) / max(max(lx, ly), 1e-8);
  dx *= k; dy *= k;
#endif
  brightness = clamp(brightness, 0.0, 0.9999999);
  float minB = clamp(brightness - 0.111111111, 0.0, 1.0);
  return mix(hatch_sample(brightness, st, dx, dy), hatch_sample(minB, st, dx, dy),
             1.0 - fract(brightness * 9.0));
}
`;

/** The hatch itself: `uv`, `vHatchDiffuse`, `vHatchRoof` in; ink/paper rgb out. */
export const FS_HATCH = /* glsl */ `
  vec2 uv = vHatchUV;
  float b = HATCH_GAIN * vHatchDiffuse * (clamp(uv.y * 1.5, 0.0, 1.0) + 0.2);
  float pattern = 1.0 - getHatch(uv, b);
  vec2 edge = vec2(0.1, 0.05) * hatch_noise(uv * 20.0);
  vec2 blend = smoothstep(vec2(0.0), edge, uv) * smoothstep(vec2(0.0), edge, vec2(1.0) - uv);
  float t = mix(1.0, pattern, blend.x * blend.y);
  vec2 fw = max(fwidth(uv), vec2(1e-5));
  float px = min(min(uv.x, 1.0 - uv.x) / fw.x, (1.0 - uv.y) / fw.y);
  float line = (1.0 - vHatchRoof) * (1.0 - smoothstep(0.6, 1.4, px));
  vec3 hatchRgb = mix(mix(${INK}, ${PAPER}, t), ${INK}, line * 0.85);
`;

const FS_MAIN = /* glsl */ `
  // no early return: DECKGL_FILTER_COLOR below carries ClipExtension's discard
  if (crosshatch.depthOnly > 0.5) {
    fragColor = vec4(0.0);
  } else {
${FS_HATCH}
    fragColor = vec4(hatchRgb, vColor.a);
  }
`;

/** Per-draw switch for the depth prepass (a luma uniform-block module). */
export const crosshatchModule = {
  name: "crosshatch",
  fs: /* glsl */ `\
layout(std140) uniform crosshatchUniforms {
  float depthOnly;
} crosshatch;
`,
  uniformTypes: { depthOnly: "f32" },
} as const;

export function fsDecl(gain: number, minorLod: boolean): string {
  return `#define HATCH_MINOR_LOD ${minorLod ? 1 : 0}\n` + FS_DECL.replace("__GAIN__", gain.toFixed(4));
}

function splice(src: string, anchor: string, insert: string, replace = false): string {
  if (!src.includes(anchor)) {
    throw new Error(`[crosshatch] shader anchor not found: ${anchor} (deck version drift)`);
  }
  return src.replace(anchor, replace ? insert : `${anchor}\n${insert}`);
}

type SolidModel = {
  setInstanceCount(n: number): void;
  setVertexCount(n: number): void;
  shaderInputs: { setProps(p: object): void };
  draw(renderPass: unknown): boolean;
};

const defaultProps: DefaultProps<CrosshatchLayerProps> = {
  hatchImage: { type: "object", value: null, async: false } as never,
  gain: 0.72,
  cull: false,
  prepass: false,
  minorLod: false,
};

export class CrosshatchLayer<D = unknown> extends SolidPolygonLayer<D, CrosshatchLayerProps<D>> {
  static override layerName = "CrosshatchLayer";
  static override defaultProps = defaultProps as never;

  declare state: SolidPolygonLayer["state"] & { hatchTexture?: Texture; hatchSource?: ImageBitmap };

  override getShaders(type: "top" | "side") {
    const s = super.getShaders(type);
    let vs = splice(s.vs, "out vec4 vColor;", VS_DECL);
    vs = splice(vs, "geometry.normal = normal;", VS_LIGHT);
    let fs = splice(s.fs, "out vec4 fragColor;", fsDecl(this.props.gain ?? 0.72, !!this.props.minorLod));
    fs = splice(fs, "fragColor = vColor;", FS_MAIN, true);
    return { ...s, vs, fs, modules: [...s.modules, crosshatchModule] };
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    // `gain` / `minorLod` are compiled into the shader (spike simplicity):
    // the runtime keys the layer id on them, so a change is a fresh layer.
    const { props } = params;
    const image = props.hatchImage;
    if (image && this.state.hatchSource !== image) {
      this.state.hatchTexture?.destroy();
      this.state.hatchTexture = createAtlasTexture(this.context.device, image);
      this.state.hatchSource = image;
    }
  }

  override draw(opts: Parameters<SolidPolygonLayer["draw"]>[0]) {
    if (!this.state.hatchTexture) return;
    const models = this.getModels();
    for (const model of models) model.setBindings({ hatchAtlas: this.state.hatchTexture });
    const { prepass } = this.props;
    // Raw GL for cull + color mask (luma's state tracker sees the calls;
    // its pipeline cull parameters restore an untracked frontFace of 0).
    const gl = (this.context.device as unknown as { gl: WebGL2RenderingContext }).gl;
    if (prepass) {
      for (const model of models) model.shaderInputs.setProps({ crosshatch: { depthOnly: 1 } });
      gl.colorMask(false, false, false, false);
      this._drawModels();
      gl.colorMask(true, true, true, true);
    }
    for (const model of models) model.shaderInputs.setProps({ crosshatch: { depthOnly: 0 } });
    this._drawModels();
  }

  /** SolidPolygonLayer.draw (filled, extruded, no wireframe), with per-model culling. */
  private _drawModels() {
    const { elevationScale, cull } = this.props;
    const { topModel, sideModel, polygonTesselator } = this.state as unknown as {
      topModel?: SolidModel;
      sideModel?: SolidModel;
      polygonTesselator: { instanceCount: number; vertexCount: number };
    };
    const gl = (this.context.device as unknown as { gl: WebGL2RenderingContext }).gl;
    const u = { extruded: true, elevationScale, isWireframe: false };
    // Measured: seen from outside, deck's side walls are CCW and its earcut
    // roofs CW (one frontFace for both culls one or the other).
    if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
    if (sideModel) {
      if (cull) gl.frontFace(gl.CCW);
      sideModel.setInstanceCount(polygonTesselator.instanceCount - 1);
      sideModel.shaderInputs.setProps({ solidPolygon: u });
      sideModel.draw(this.context.renderPass);
    }
    if (topModel) {
      if (cull) gl.frontFace(gl.CW);
      topModel.setVertexCount(polygonTesselator.vertexCount);
      topModel.shaderInputs.setProps({ solidPolygon: u });
      topModel.draw(this.context.renderPass);
    }
    if (cull) { gl.frontFace(gl.CCW); gl.disable(gl.CULL_FACE); }
  }

  override finalizeState(context: Parameters<SolidPolygonLayer["finalizeState"]>[0]) {
    super.finalizeState(context);
    this.state.hatchTexture?.destroy();
  }
}

/**
 * FINDING (session 3): luma 9.4 ignores `mipmaps: true` — a texture gets
 * `mipLevels` (default 1) and mips only via generateMipmapsWebGL(). So
 * route 1's atlas has only ever been sampled at level 0 (the session-2 look,
 * kept as the default for fidelity); `mips` builds the real chain.
 */
export function createAtlasTexture(
  device: { createTexture(p: object): Texture; getMipLevelCount?(w: number, h: number): number },
  image: ImageBitmap,
  mips = false
): Texture {
  const tex = device.createTexture({
    data: image,
    mipmaps: true,
    ...(mips && device.getMipLevelCount ? { mipLevels: device.getMipLevelCount(image.width, image.height) } : {}),
    sampler: {
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    },
  });
  if (mips) (tex as unknown as { generateMipmapsWebGL(): void }).generateMipmapsWebGL();
  return tex;
}
