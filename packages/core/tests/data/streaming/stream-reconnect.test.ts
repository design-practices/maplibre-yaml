/**
 * @file Reconnecting streams through StreamManager (ml-7qa.12)
 *
 * @description
 * What a stream does when its connection drops or never opens, as the map
 * sees it through `onError`: a drop the stream is reconnecting from is not a
 * failure; giving up (attempts exhausted, or `reconnect: false`) is reported
 * once; the reconnect options set the attempts and the waits; a first
 * connection that fails is reported once and retried.
 *
 * EventSource is modelled as the browser runs it: after an open stream ends,
 * it fires `error` with `readyState` CONNECTING and reconnects by itself
 * (resuming with `Last-Event-ID`); when it gives up (an HTTP error) it fires
 * `error` with `readyState` CLOSED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StreamManager } from "../../../src/data/streaming/stream-manager";
import type { StreamConfig } from "../../../src/data/streaming/stream-manager";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeEventSource {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSED = CLOSED;
  readyState = CONNECTING;
  closed = false;
  private listeners = new Map<string, Set<(event: any) => void>>();
  constructor(public url: string) {
    sources.push(this);
  }
  addEventListener(type: string, fn: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: any) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.readyState = CLOSED;
    this.closed = true;
  }
  private fire(type: string, event: Event): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  open(): void {
    this.readyState = OPEN;
    this.fire("open", new Event("open"));
  }
  /** The stream ended or the network dropped: the browser will retry (CONNECTING) or has given up (CLOSED). */
  error(readyState: number = CONNECTING): void {
    this.readyState = readyState;
    this.fire("error", new Event("error"));
  }
  message(data: unknown, type = "message"): void {
    this.fire(type, new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

class FakeWebSocket {
  static OPEN = OPEN;
  readyState = CONNECTING;
  private listeners = new Map<string, Set<(event: any) => void>>();
  constructor(public url: string) {
    sockets.push(this);
  }
  addEventListener(type: string, fn: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: any) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.readyState = 3;
  }
  send(): void {}
  private fire(type: string, event: Event): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  open(): void {
    this.readyState = OPEN;
    this.fire("open", new Event("open"));
  }
  error(): void {
    this.fire("error", new Event("error"));
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.fire("close", new CloseEvent("close", { code }));
  }
}

let sources: FakeEventSource[] = [];
let sockets: FakeWebSocket[] = [];
const last = <T>(list: T[]): T => list[list.length - 1]!;

const fc = (id: string) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [0, 0] } }],
});

describe("StreamManager: reconnecting (ml-7qa.12)", () => {
  let manager: StreamManager;

  beforeEach(() => {
    vi.useFakeTimers();
    // No jitter: the waits are exactly the configured backoff.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sources = [];
    sockets = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    manager = new StreamManager();
  });

  afterEach(() => {
    manager.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Connect `id` and open its first connection. */
  async function connected(config: Partial<StreamConfig> & { type: StreamConfig["type"] }, id = "s") {
    const onData = vi.fn();
    const onError = vi.fn();
    const pending = manager.connect(id, { url: "https://example.com/feed", onData, onError, ...config });
    await Promise.resolve();
    (config.type === "sse" ? last(sources) : last(sockets)).open();
    await pending;
    return { onData, onError };
  }

  describe("SSE: a drop the browser reconnects from (bug 1)", () => {
    it("is not reported as an error, and the stream carries on after the browser reconnects", async () => {
      const { onData, onError } = await connected({ type: "sse" });
      const es = last(sources);
      es.message(fc("a"));

      es.error(CONNECTING);
      expect(onError).not.toHaveBeenCalled();
      expect(manager.getState("s")).toMatchObject({ connectionState: "reconnecting", reconnectAttempts: 1 });
      // The browser's own reconnect: no second EventSource, so Last-Event-ID resumes it.
      expect(es.closed).toBe(false);
      expect(sources).toHaveLength(1);

      es.open();
      es.message(fc("b"));
      expect(manager.getState("s")).toMatchObject({ connectionState: "connected", reconnectAttempts: 0 });
      expect(onData).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
    });

    it("reports once, and stops the browser retrying, when reconnectMaxAttempts browser retries fail", async () => {
      const { onError } = await connected({ type: "sse", reconnect: { maxRetries: 3 } });
      const es = last(sources);
      es.error(CONNECTING); // the drop: attempt 1
      es.error(CONNECTING); // attempt 1 failed: attempt 2
      es.error(CONNECTING); // attempt 2 failed: attempt 3
      expect(onError).not.toHaveBeenCalled();
      expect(es.closed).toBe(false);
      es.error(CONNECTING); // attempt 3 failed: give up
      expect(es.closed).toBe(true);
      expect(manager.getState("s")?.connectionState).toBe("failed");
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/didn't reconnect/);
      await vi.runAllTimersAsync();
      expect(sources).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("takes over with its own backoff when the browser gives up (CLOSED), and recovers", async () => {
      const { onData, onError } = await connected({
        type: "sse",
        reconnect: { maxRetries: 5, initialDelay: 1000, maxDelay: 30_000 },
      });
      last(sources).error(CLOSED);
      expect(sources[0].closed).toBe(true);
      await vi.advanceTimersByTimeAsync(999);
      expect(sources).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sources).toHaveLength(2);
      last(sources).open();
      await vi.advanceTimersByTimeAsync(0);
      last(sources).message(fc("c"));
      expect(onData).toHaveBeenCalledTimes(1);
      expect(manager.getState("s")?.connectionState).toBe("connected");
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("reconnect: false (bug 2)", () => {
    it("SSE: closes the EventSource on a drop, so the browser doesn't reconnect, and reports the end once", async () => {
      const { onError } = await connected({ type: "sse", reconnect: { enabled: false } });
      const es = last(sources);
      es.error(CONNECTING);
      expect(es.closed).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/reconnect: false/);
      es.error(CLOSED);
      await vi.runAllTimersAsync();
      expect(sources).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("WebSocket: no reconnect after a drop, and the end is reported once", async () => {
      const { onError } = await connected({ type: "websocket", reconnect: { enabled: false } });
      last(sockets).error();
      last(sockets).drop();
      await vi.runAllTimersAsync();
      expect(sockets).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/reconnect: false/);
    });
  });

  describe("the reconnect options take effect (bug 3)", () => {
    it("WebSocket: waits reconnectDelay, doubles up to reconnectMaxDelay, and gives up after reconnectMaxAttempts", async () => {
      const { onError } = await connected({
        type: "websocket",
        reconnect: { maxRetries: 3, initialDelay: 500, maxDelay: 800 },
      });
      // An error on an open socket comes before its close: the close is what's reported.
      last(sockets).error();
      last(sockets).drop();
      expect(onError).not.toHaveBeenCalled();

      const at: number[] = [];
      const start = Date.now();
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = sockets.length;
        while (sockets.length === before && Date.now() - start < 10_000) await vi.advanceTimersByTimeAsync(10);
        at.push(Date.now() - start);
        last(sockets).error(); // this attempt fails
        await vi.advanceTimersByTimeAsync(0);
      }
      // 500, then 500 + 800 (1000 capped at 800), then + 800.
      expect(at).toEqual([500, 1300, 2100]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(4); // the first and three attempts
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/didn't reconnect/);
      expect(manager.getState("s")?.connectionState).toBe("failed");
    });

    it("WebSocket: a reconnect that opens resumes the stream and resets the attempts", async () => {
      const { onData, onError } = await connected({ type: "websocket", reconnect: { initialDelay: 200 } });
      last(sockets).drop();
      await vi.advanceTimersByTimeAsync(200);
      expect(sockets).toHaveLength(2);
      last(sockets).open();
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.getState("s")).toMatchObject({ connectionState: "connected" });
      (last(sockets) as any).fire("message", new MessageEvent("message", { data: JSON.stringify(fc("w")) }));
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("a first connection that fails (bug 5)", () => {
    it("is reported once and retried per the reconnect options; the stream runs once it opens", async () => {
      const onData = vi.fn();
      const onError = vi.fn();
      const pending = manager.connect("s", {
        type: "sse",
        url: "https://example.com/feed",
        onData,
        onError,
        reconnect: { maxRetries: 3, initialDelay: 400 },
      });
      await Promise.resolve();
      last(sources).error(CLOSED); // 404: the browser won't retry
      await expect(pending).rejects.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/couldn't connect/);
      expect((onError.mock.calls[0][0] as { stream?: string }).stream).toBe("https://example.com/feed");

      await vi.advanceTimersByTimeAsync(400);
      expect(sources).toHaveLength(2);
      last(sources).error(CLOSED); // still down: silent, already reported
      await vi.advanceTimersByTimeAsync(800);
      expect(sources).toHaveLength(3);
      last(sources).open();
      await vi.advanceTimersByTimeAsync(0);
      last(sources).message(fc("late"));
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("with reconnect: false is reported once and not retried", async () => {
      const onError = vi.fn();
      const pending = manager.connect("s", {
        type: "websocket",
        url: "wss://example.com/feed",
        onData: vi.fn(),
        onError,
        reconnect: { enabled: false },
      });
      await Promise.resolve();
      last(sockets).error();
      await expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      expect(sockets).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("stops retrying once disconnected", async () => {
      const pending = manager.connect("s", {
        type: "sse",
        url: "https://example.com/feed",
        onData: vi.fn(),
        onError: vi.fn(),
        reconnect: { initialDelay: 400 },
      });
      await Promise.resolve();
      last(sources).error(CLOSED);
      await expect(pending).rejects.toThrow();
      manager.disconnect("s");
      await vi.runAllTimersAsync();
      expect(sources).toHaveLength(1);
    });
  });
});
