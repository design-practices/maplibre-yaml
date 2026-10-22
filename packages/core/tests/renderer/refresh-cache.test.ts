// @vitest-environment node
/**
 * A polling source refetches on every tick, even with the data cache on
 * (ml-ahu).
 *
 * The data cache is on by default with a 5-minute TTL. A refresh tick used
 * to read through it, so `refreshInterval: 60000` without `cache: { enabled:
 * false }` served the first response again for five minutes. These tests run
 * the live-data guide's own YAML against a real local server whose response
 * changes on every request.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LayerManager } from "../../src/renderer/layer-manager";
import { YAMLParser } from "../../src/parser";

/** A feed whose answer changes on every request: request N returns N features. */
function startFeed(): Promise<{ server: Server; url: string; requests: () => number }> {
  let count = 0;
  const server = createServer((_req, res) => {
    count += 1;
    const features = Array.from({ length: count }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [i, 0] },
      properties: { n: count },
    }));
    res.writeHead(200, { "content-type": "application/geo+json", etag: `"v${count}"` });
    res.end(JSON.stringify({ type: "FeatureCollection", features }));
  });
  return new Promise((done) => {
    // Port 0: the OS picks a free port, so parallel runs never collide.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      done({ server, url: `http://127.0.0.1:${port}/feed.geojson`, requests: () => count });
    });
  });
}

/** The guide's polling demo, pointed at the local feed. */
function guideLayer(url: string, refreshInterval?: number) {
  let yaml = readFileSync(
    resolve(__dirname, "../../../../docs/public/configs/polling-demo.yaml"),
    "utf8"
  ).replace(/url: "https:\/\/earthquake\.usgs\.gov\/[^"]*"/, `url: "${url}"`); // any USGS feed the demo uses
  if (refreshInterval) yaml = yaml.replace("refreshInterval: 60000", `refreshInterval: ${refreshInterval}`);
  const parsed = YAMLParser.safeParseMapBlock(yaml);
  expect(parsed.success).toBe(true);
  const layer = parsed.data!.layers![0] as any;
  expect(layer.source.url).toBe(url);
  expect(layer.source.cache).toBeUndefined(); // the default cache is on
  return layer;
}

describe("a refreshing source never serves a cached copy (ml-ahu)", () => {
  let feed: Awaited<ReturnType<typeof startFeed>>;
  let manager: LayerManager;
  let setData: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    feed = await startFeed();
    setData = vi.fn();
    const map: any = {
      addSource: vi.fn(),
      getSource: vi.fn(() => ({ setData })),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setLayoutProperty: vi.fn(),
    };
    manager = new LayerManager(map, {});
  });

  afterEach(async () => {
    manager.destroy();
    vi.useRealTimers();
    await new Promise((done) => feed.server.close(done));
  });

  const lastCount = () => (setData.mock.calls.at(-1)![0] as { features: unknown[] }).features.length;

  it("the guide's 60-second poll fetches the feed again a minute later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await manager.addLayer(guideLayer(feed.url));
    expect(feed.requests()).toBe(1);
    expect(lastCount()).toBe(1);

    // One minute on: well inside the cache's 5-minute TTL.
    vi.setSystemTime(Date.now() + 60_000);
    await manager.refreshNow("earthquakes");
    expect(feed.requests()).toBe(2);
    expect(lastCount()).toBe(2);

    vi.setSystemTime(Date.now() + 60_000);
    await manager.refreshNow("earthquakes");
    expect(feed.requests()).toBe(3);
    expect(lastCount()).toBe(3);
  });

  it("a scheduled tick (refreshInterval: 1000) shows the feed's new answer", async () => {
    await manager.addLayer(guideLayer(feed.url, 1000));
    expect(lastCount()).toBe(1);
    await vi.waitFor(() => expect(lastCount()).toBe(2), { timeout: 3000, interval: 50 });
    expect(feed.requests()).toBe(2);
  });
});
