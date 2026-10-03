/**
 * @file U12 SPIKE session 3 — route 1's optimized geometry: one prebuilt mesh per tile
 *
 * @description
 * Profiling route 1 on SwiftShader showed the cost is the vertex stage of
 * deck's SolidPolygonLayer (viewport-insensitive, a depth prepass that
 * re-runs the vertex stage made it WORSE): per ring vertex one instanced
 * 4-vertex wall quad through deck's full extrusion shader (fp64-low
 * positions, gouraud lighting, normals), plus the tile BUFFER geometry that
 * ClipExtension then throws away per fragment with `discard`.
 *
 * This layer draws route 2's tile mesh (`buildTileMesh`: walls and roofs
 * clipped to the tile square at parse time — no ClipExtension, no fake
 * walls, no seam outlines; diffuse precomputed per face) through deck:
 * TileLayer picks and caches the tiles, `project32` places them
 * (CARTESIAN tile-local coordinates + the same modelMatrix/coordinateOrigin
 * MVTLayer uses), and the fragment stage is route 1's hatch, verbatim. The
 * vertex stage is one projection; back faces are culled;
 * the depth prepass is a uniform switch on the same program.
 */

import { Layer, project32, type DefaultProps, type UpdateParameters, type LayerProps } from "@deck.gl/core";
import { Model } from "@luma.gl/engine";
import type { Buffer, Texture } from "@luma.gl/core";
import { fsDecl, FS_HATCH, createAtlasTexture } from "./crosshatch-layer";

export interface TileMesh {
  vertices: Float32Array; // 7 floats / vertex: x, y (tile units), z (metres), u, v, diffuse, roof
  indices: Uint32Array;
  extent: number;
}

export type CrosshatchMeshLayerProps = LayerProps & {
  mesh: TileMesh | null;
  hatchImage: ImageBitmap | null;
  gain?: number;
  elevationScale?: number;
  cull?: boolean;
  /** a real mip chain for the atlas (route 1 never had one — see createAtlasTexture) */
  mips?: boolean;
  prepass?: boolean;
  minorLod?: boolean;
};

const meshModule = {
  name: "crosshatchMesh",
  vs: /* glsl */ `\
layout(std140) uniform crosshatchMeshUniforms {
  float elevationScale;
  float invExtent;
  float depthOnly;
} crosshatchMesh;
`,
  fs: /* glsl */ `\
layout(std140) uniform crosshatchMeshUniforms {
  float elevationScale;
  float invExtent;
  float depthOnly;
} crosshatchMesh;
`,
  uniformTypes: { elevationScale: "f32", invExtent: "f32", depthOnly: "f32" },
} as const;

const VS = /* glsl */ `\
#version 300 es
#define SHADER_NAME crosshatch-mesh-layer-vertex-shader
in vec3 positions;
in vec4 hatchAttrs;
out vec2 vHatchUV;
out float vHatchDiffuse;
out float vHatchRoof;
void main(void) {
  vec3 pos = vec3(positions.xy * crosshatchMesh.invExtent, positions.z * crosshatchMesh.elevationScale);
  geometry.worldPosition = pos;
  gl_Position = project_position_to_clipspace(pos, vec3(0.0), vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vHatchUV = hatchAttrs.xy;
  vHatchDiffuse = hatchAttrs.z;
  vHatchRoof = hatchAttrs.w;
}
`;

const fs = (gain: number, minorLod: boolean) => /* glsl */ `\
#version 300 es
#define SHADER_NAME crosshatch-mesh-layer-fragment-shader
precision highp float;
${fsDecl(gain, minorLod)}
out vec4 fragColor;
void main(void) {
  if (crosshatchMesh.depthOnly > 0.5) {
    fragColor = vec4(0.0);
    return;
  }
${FS_HATCH}
  fragColor = vec4(hatchRgb, 1.0);
  geometry.uv = vHatchUV;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

// One atlas texture per device (every tile sublayer shares it).
const atlasCache = new WeakMap<object, { image: ImageBitmap; texture: Texture; refs: number }>();

const defaultProps: DefaultProps<CrosshatchMeshLayerProps> = {
  mesh: { type: "object", value: null, compare: false } as never,
  hatchImage: { type: "object", value: null, async: false } as never,
  gain: 0.72,
  elevationScale: 1,
  cull: true,
  mips: false,
  prepass: false,
  minorLod: true,
};

export class CrosshatchMeshLayer extends Layer<CrosshatchMeshLayerProps> {
  static override layerName = "CrosshatchMeshLayer";
  static override defaultProps = defaultProps as never;

  declare state: { model?: Model; buffers?: Buffer[]; mesh?: TileMesh | null; atlasKey?: object };

  override getShaders() {
    return super.getShaders({
      vs: VS,
      fs: fs(this.props.gain ?? 0.72, this.props.minorLod ?? true),
      modules: [project32, meshModule],
    });
  }

  override initializeState() {
    this.state = {};
  }

  override updateState({ props }: UpdateParameters<this>) {
    if (props.mesh !== this.state.mesh) this._rebuild(props.mesh);
    const device = this.context.device;
    if (props.hatchImage && !this.state.atlasKey) {
      let entry = atlasCache.get(device);
      if (!entry || entry.image !== props.hatchImage) {
        entry = { image: props.hatchImage, texture: createAtlasTexture(device, props.hatchImage, !!props.mips), refs: 0 };
        atlasCache.set(device, entry);
      }
      entry.refs++;
      this.state.atlasKey = device;
    }
  }

  private _rebuild(mesh: TileMesh | null) {
    this.state.model?.destroy();
    for (const b of this.state.buffers ?? []) b.destroy();
    this.state.mesh = mesh;
    this.state.model = undefined;
    this.state.buffers = [];
    if (!mesh || mesh.indices.length === 0) return;
    const device = this.context.device;
    const vbo = device.createBuffer({ data: mesh.vertices });
    const ibo = device.createBuffer({ usage: 0x0010 /* Buffer.INDEX */, data: mesh.indices, indexType: "uint32" } as never);
    this.state.buffers = [vbo, ibo];
    this.state.model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: [
        {
          name: "mesh",
          byteStride: 28,
          attributes: [
            { attribute: "positions", format: "float32x3", byteOffset: 0 },
            { attribute: "hatchAttrs", format: "float32x4", byteOffset: 12 },
          ],
        },
      ],
      attributes: { mesh: vbo },
      indexBuffer: ibo,
      vertexCount: mesh.indices.length,
      topology: "triangle-list",
      isInstanced: false,
    });
  }

  override draw({ renderPass }: { renderPass: Parameters<Model["draw"]>[0] }) {
    const { model, mesh } = this.state;
    const atlas = atlasCache.get(this.context.device);
    if (!model || !mesh || !atlas) return;
    model.setBindings({ hatchAtlas: atlas.texture });
    const u = { elevationScale: this.props.elevationScale ?? 1, invExtent: 1 / mesh.extent };
    // Raw GL for cull + color mask (luma's state tracker sees these calls).
    // luma's `cullMode`/`frontFace` pipeline parameters were tried first:
    // its push/popState then restores an untracked frontFace of 0
    // (GL_INVALID_ENUM spam). MapLibre resets its own GL state cache after
    // every custom layer, so leaving cull disabled again is all it needs.
    const gl = (this.context.device as unknown as { gl: WebGL2RenderingContext }).gl;
    if (this.props.cull) {
      // Seen from outside the mesh's faces are CW, as in route 2 (verified
      // by image: CCW culls the roofs and outer walls instead).
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CW);
    }
    if (this.props.prepass) {
      model.shaderInputs.setProps({ crosshatchMesh: { ...u, depthOnly: 1 } });
      gl.colorMask(false, false, false, false);
      model.draw(renderPass);
      gl.colorMask(true, true, true, true);
    }
    model.shaderInputs.setProps({ crosshatchMesh: { ...u, depthOnly: 0 } });
    model.draw(renderPass);
    if (this.props.cull) {
      gl.frontFace(gl.CCW);
      gl.disable(gl.CULL_FACE);
    }
  }

  override finalizeState(context: Parameters<Layer["finalizeState"]>[0]) {
    super.finalizeState(context);
    this._rebuild(null);
    const entry = this.state.atlasKey ? atlasCache.get(this.state.atlasKey) : undefined;
    if (entry && --entry.refs <= 0) {
      entry.texture.destroy();
      atlasCache.delete(this.state.atlasKey!);
    }
  }
}
