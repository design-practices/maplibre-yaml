/**
 * @file The dev-reload integration (ml-aot.24, ml-7jc.3)
 *
 * @description
 * `loadGlobalMapConfig` in a module-level `await` kept serving the old
 * `src/config/maps.yaml` until `astro dev` restarted: the file is read with
 * fs, so Vite neither reloaded the page nor re-ran the module. The loaders
 * now record what they read, and the integration's Vite plugin invalidates
 * the server modules and reloads the browser when one of those files (or
 * map data under public/) changes. Driven here against a fake dev server
 * shaped like Vite 5 (Astro 4) and Vite 6+ (Astro 5-7).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import maplibreYaml, { devReloadPlugin } from "../../src/integration.mjs";
import { loadGlobalMapConfig } from "../../src/utils/global-config";
import { loadMapConfig } from "../../src/utils/loader";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mlyaml-integration-"));
  writeFileSync(
    join(dir, "maps.yaml"),
    'defaultMapStyle: "https://tiles.openfreemap.org/styles/liberty"\ndefaultZoom: 14\n'
  );
  writeFileSync(
    join(dir, "map.yaml"),
    [
      "type: map",
      "id: m",
      "config:",
      "  center: [0, 0]",
      "  zoom: 2",
      '  mapStyle: "https://tiles.openfreemap.org/styles/liberty"',
      "layers: []",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(dir, "map.toml"),
    [
      'type = "map"',
      'id = "m"',
      "layers = []",
      "",
      "[config]",
      "center = [0, 0]",
      "zoom = 2",
      'mapStyle = "https://tiles.openfreemap.org/styles/liberty"',
      "",
    ].join("\n")
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Sent = { channel: string; payload: unknown };

/** A dev server double; `vite6` adds the environment API Astro 5-7 run on. */
function fakeServer(vite6: boolean) {
  const handlers: Record<string, ((file: string) => void)[]> = {};
  const sent: Sent[] = [];
  const invalidated: string[] = [];
  const channel = (name: string) => ({ send: (payload: unknown) => sent.push({ channel: name, payload }) });
  const graph = (name: string) => ({ invalidateAll: () => invalidated.push(name) });
  const server: Record<string, unknown> = {
    watcher: {
      on: (event: string, cb: (file: string) => void) => (handlers[event] ??= []).push(cb),
    },
    ws: channel("ws"),
    moduleGraph: graph("mixed"),
  };
  if (vite6) {
    server.environments = {
      client: { hot: channel("client"), moduleGraph: graph("client") },
      ssr: { hot: channel("ssr"), moduleGraph: graph("ssr") },
    };
  }
  const emit = (event: string, file: string) => handlers[event]?.forEach((cb) => cb(file));
  return { server, sent, invalidated, emit };
}

describe("maplibreYaml() integration", () => {
  it("adds its Vite plugin in astro dev only", () => {
    const integration = maplibreYaml();
    const setup = integration.hooks["astro:config:setup"] as (params: unknown) => void;
    const updates: any[] = [];
    const params = (command: string) => ({
      command,
      config: { publicDir: new URL(`file://${dir}/public/`) },
      updateConfig: (c: unknown) => updates.push(c),
      logger: { info() {} },
    });
    setup(params("build"));
    expect(updates).toHaveLength(0);
    setup(params("dev"));
    expect(updates).toHaveLength(1);
    expect(updates[0].vite.plugins[0].name).toBe("maplibre-yaml:dev-reload");
    // The components' client deps are pre-bundled up front, so the first
    // map page does not trigger a re-optimize + reload (504 Outdated
    // Optimize Dep) mid-visit.
    expect(updates[0].vite.optimizeDeps.include).toEqual(["maplibre-gl", "@maplibre-yaml/core/register"]);
  });

  for (const vite6 of [false, true]) {
    describe(vite6 ? "Vite 6+ (Astro 5-7)" : "Vite 5 (Astro 4)", () => {
      it("a file loadGlobalMapConfig / loadMapConfig read: invalidate server modules + full reload", async () => {
        await loadGlobalMapConfig(join(dir, "maps.yaml"));
        await loadMapConfig(join(dir, "map.yaml"));
        const { server, sent, invalidated, emit } = fakeServer(vite6);
        devReloadPlugin(join(dir, "public")).configureServer(server);

        emit("change", join(dir, "maps.yaml"));
        expect(invalidated).toEqual([vite6 ? "ssr" : "mixed"]);
        expect(sent).toContainEqual({
          channel: vite6 ? "client" : "ws",
          payload: { type: "full-reload", path: "*" },
        });
        if (vite6) {
          // The SSR module runner drops its evaluated modules too.
          expect(sent).toContainEqual({ channel: "ssr", payload: { type: "full-reload" } });
        }

        sent.length = 0;
        emit("change", join(dir, "map.yaml"));
        expect(sent.length).toBeGreaterThan(0);
      });

      it("map data under public/: full reload; unrelated files: nothing", () => {
        const { server, sent, invalidated, emit } = fakeServer(vite6);
        devReloadPlugin(join(dir, "public")).configureServer(server);

        emit("change", join(dir, "public", "configs", "hero-map.yaml"));
        emit("add", join(dir, "public", "data", "points.geojson"));
        expect(sent.filter((s) => s.channel !== "ssr")).toHaveLength(2);
        expect(invalidated).toEqual([]);

        sent.length = 0;
        emit("change", join(dir, "public", "favicon.svg"));
        emit("change", join(dir, "src", "pages", "index.astro"));
        emit("change", join(dir, "src", "content", "never-loaded.yaml"));
        expect(sent).toEqual([]);
      });

      // JSON and TOML documents (0.10): `<Map src="/maps/city.toml">` reloads
      // like its YAML twin, and so does a TOML file a loader read.
      it("JSON and TOML map documents under public/: full reload", () => {
        const { server, sent, invalidated, emit } = fakeServer(vite6);
        devReloadPlugin(join(dir, "public")).configureServer(server);

        emit("change", join(dir, "public", "maps", "city.toml"));
        emit("change", join(dir, "public", "maps", "CITY.TOML"));
        emit("change", join(dir, "public", "maps", "city.json"));
        expect(sent.filter((s) => s.channel !== "ssr")).toHaveLength(3);
        expect(invalidated).toEqual([]);
      });

      it("a TOML file loadMapConfig read: invalidate server modules + full reload", async () => {
        await loadMapConfig(join(dir, "map.toml"));
        const { server, sent, invalidated, emit } = fakeServer(vite6);
        devReloadPlugin(join(dir, "public")).configureServer(server);

        emit("change", join(dir, "map.toml"));
        expect(invalidated).toEqual([vite6 ? "ssr" : "mixed"]);
        expect(sent).toContainEqual({
          channel: vite6 ? "client" : "ws",
          payload: { type: "full-reload", path: "*" },
        });
      });
    });
  }
});
