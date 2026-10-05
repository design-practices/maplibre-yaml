/**
 * Shader assembly (uniform inference, reserved names) and the MapLibre
 * internals adapter's feature checks.
 */
import { describe, it, expect } from "vitest";
import { resolveUniform, buildFragmentShader, parseHexColor, FRAGMENT_PRELUDE, tonalHatch, blueprint } from "../src/index";
import { probeTiles, probeMainMatrix, isMercator, hasTerrain, layerOrder } from "../src/backends/extrusions/adapter";

describe("uniform inference", () => {
  it("maps values to GLSL types", () => {
    expect(resolveUniform("fx", "u_a", 0.5)).toEqual({ name: "u_a", type: "float", value: [0.5] });
    expect(resolveUniform("fx", "u_b", true)).toEqual({ name: "u_b", type: "bool", value: [1] });
    expect(resolveUniform("fx", "u_c", "#ff8000").type).toBe("vec3");
    expect(resolveUniform("fx", "u_c", "#ff8000").value[1]).toBeCloseTo(128 / 255, 6);
    expect(resolveUniform("fx", "u_d", [1, 2]).type).toBe("vec2");
    expect(resolveUniform("fx", "u_e", [1, 2, 3, 4]).type).toBe("vec4");
    expect(parseHexColor("#abc")).toEqual(parseHexColor("#aabbcc"));
  });

  it("refuses reserved prefixes, bad identifiers, and unconvertible values", () => {
    expect(() => resolveUniform("fx", "u_fx_time", 1)).toThrow(/reserved prefix/);
    expect(() => resolveUniform("fx", "gl_X", 1)).toThrow(/reserved prefix/);
    expect(() => resolveUniform("fx", "2bad", 1)).toThrow(/valid GLSL identifier/);
    expect(() => resolveUniform("fx", "u_s", "red")).toThrow(/only hex colors/);
    expect(() => resolveUniform("fx", "u_s", [1])).toThrow(/unsupported value/);
  });

  it("assembles a fragment shader: declarations, prelude, main, and the author's code under #line 1", () => {
    const fs = buildFragmentShader(
      "vec4 effect_color(EffectInput i) { return vec4(u_ink, 1.0); }",
      [resolveUniform("fx", "u_ink", "#000000")],
      ["u_atlas"]
    );
    expect(fs.startsWith("#version 300 es")).toBe(true);
    expect(fs).toContain("uniform vec3 u_ink;");
    expect(fs).toContain("uniform sampler2D u_atlas;");
    expect(fs).toContain(FRAGMENT_PRELUDE);
    expect(fs).toMatch(/fx_fragColor = effect_color\(i\);[\s\S]*#line 1\nvec4 effect_color/);
  });

  it("the built-ins only use what the contract supplies", () => {
    for (const fx of [tonalHatch, blueprint]) {
      const used = [...fx.fragment.matchAll(/\b(u_[a-z_]+)\b/g)].map((m) => m[1]!);
      const supplied = new Set([
        ...Object.keys(fx.uniforms?.(fx.params.parse({}) as never) ?? {}),
        ...Object.keys(fx.textures?.(fx.params.parse({}) as never) ?? {}),
      ]);
      for (const name of used) expect(supplied.has(name), `${fx.type} reads ${name}`).toBe(true);
    }
  });
});

describe("MapLibre internals adapter (feature check)", () => {
  const coord = { key: "k", wrap: 0, overscaledZ: 14, canonical: { z: 14, x: 1, y: 2 } };
  const manager = {
    getVisibleCoordinates: () => [coord],
    getTileByID: () => ({ latestRawTileData: new ArrayBuffer(8), state: "loaded" }),
  };

  it("reads style.tileManagers (maplibre-gl 5)", () => {
    const probe = probeTiles({ style: { tileManagers: { omt: manager } } } as never, "omt");
    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    expect(probe.value.coords()).toEqual([coord]);
    expect(probe.value.raw(coord)?.byteLength).toBe(8);
    expect(probe.value.loaded(coord)).toBe(true);
  });

  it("falls back to the pre-rename style.sourceCaches", () => {
    expect(probeTiles({ style: { sourceCaches: { omt: manager } } } as never, "omt").ok).toBe(true);
  });

  it("declares absence when the internals are missing", () => {
    const none = probeTiles({ style: {} } as never, "omt");
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toMatch(/tile managers/);
    const noSource = probeTiles({ style: { tileManagers: {} } } as never, "omt");
    expect(noSource.ok).toBe(false);
    const broken = probeTiles({ style: { tileManagers: { omt: {} } } } as never, "omt");
    expect(broken.ok).toBe(false);
    expect(probeTiles({} as never, "omt").ok).toBe(false);
  });

  it("raw bytes may be absent while a tile loads", () => {
    const probe = probeTiles(
      { style: { tileManagers: { omt: { ...manager, getTileByID: () => ({ state: "loading" }) } } } } as never,
      "omt"
    );
    expect(probe.ok && probe.value.raw(coord)).toBe(null);
  });

  it("checks the v5 custom-layer render arguments", () => {
    expect(probeMainMatrix({ defaultProjectionData: { mainMatrix: new Float64Array(16) } })).not.toBeNull();
    expect(probeMainMatrix(new Float32Array(16))).toBeNull(); // v4 passed the matrix itself
    expect(probeMainMatrix(undefined)).toBeNull();
  });

  it("mercator only; no terrain", () => {
    expect(isMercator({ getProjection: () => ({ type: "mercator" }) } as never)).toBe(true);
    expect(isMercator({ getProjection: () => undefined } as never)).toBe(true);
    expect(isMercator({ getProjection: () => ({ type: "globe" }) } as never)).toBe(false);
    expect(isMercator({} as never)).toBe(true);
    expect(hasTerrain({ getTerrain: () => ({ source: "dem" }) } as never)).toBe(true);
    expect(hasTerrain({ getTerrain: () => null } as never)).toBe(false);
  });

  it("reads the layer order (with a getStyle fallback)", () => {
    expect(layerOrder({ getLayersOrder: () => ["a", "b"] } as never)).toEqual(["a", "b"]);
    expect(layerOrder({ getStyle: () => ({ layers: [{ id: "x" }] }) } as never)).toEqual(["x"]);
  });
});
