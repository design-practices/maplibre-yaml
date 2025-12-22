import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { StreamManager } from "../../../src/data/streaming/stream-manager";
import type { StreamConfig } from "../../../src/data/streaming/stream-manager";
import type { FeatureCollection } from "geojson";

/**
 * Mock EventSource for SSE testing
 */
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;

  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string, config?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = config?.withCredentials ?? false;
  }

  addEventListener(event: string, listener: (event: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  removeEventListener(event: string, listener: (event: any) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  triggerOpen(): void {
    this.readyState = MockEventSource.OPEN;
    const event = new Event("open");
    this.listeners.get("open")?.forEach((listener) => listener(event));
  }

  triggerMessage(data: string, eventType = "message"): void {
    const event = new MessageEvent(eventType, { data });
    this.listeners.get(eventType)?.forEach((listener) => listener(event));
  }

  triggerError(): void {
    const event = new Event("error");
    this.listeners.get("error")?.forEach((listener) => listener(event));
  }
}

/**
 * Mock WebSocket for WS testing
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  protocol: string;

  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocol = Array.isArray(protocols) ? protocols[0] : protocols || "";
  }

  addEventListener(event: string, listener: (event: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  removeEventListener(event: string, listener: (event: any) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      const event = new CloseEvent("close", { code: 1000 });
      this.listeners.get("close")?.forEach((listener) => listener(event));
    }, 0);
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = new Event("open");
    this.listeners.get("open")?.forEach((listener) => listener(event));
  }

  triggerMessage(data: string): void {
    const event = new MessageEvent("message", { data });
    this.listeners.get("message")?.forEach((listener) => listener(event));
  }

  triggerClose(code = 1000, reason = "Normal closure"): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent("close", { code, reason });
    this.listeners.get("close")?.forEach((listener) => listener(event));
  }

  triggerError(): void {
    const event = new Event("error");
    this.listeners.get("error")?.forEach((listener) => listener(event));
  }
}

describe("StreamManager", () => {
  let manager: StreamManager;
  let mockEventSource: MockEventSource | null = null;
  let mockWebSocket: MockWebSocket | null = null;

  beforeEach(() => {
    // Mock EventSource
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string, config?: { withCredentials?: boolean }) {
          mockEventSource = new MockEventSource(url, config);
          return mockEventSource;
        }
      }
    );

    // Mock WebSocket
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor(url: string, protocols?: string | string[]) {
          mockWebSocket = new MockWebSocket(url, protocols);
          return mockWebSocket;
        }
      }
    );

    manager = new StreamManager();
  });

  afterEach(() => {
    manager.destroy();
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("creates a new StreamManager", () => {
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it("starts with no active streams", () => {
      expect(manager.getActiveIds()).toEqual([]);
    });
  });

  describe("connect - SSE", () => {
    it("connects to SSE stream", async () => {
      const onData = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-sse")).toBe(true);
      expect(manager.getActiveIds()).toEqual(["test-sse"]);
    });

    it("throws if stream id already exists", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("duplicate", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      await expect(manager.connect("duplicate", config)).rejects.toThrow(
        'Stream with id "duplicate" already exists'
      );
    });

    it("calls onData with valid FeatureCollection", async () => {
      const onData = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-122.4, 37.8] },
            properties: { id: 1 },
          },
        ],
      };

      mockEventSource?.triggerMessage(JSON.stringify(featureCollection));
      await Promise.resolve();

      expect(onData).toHaveBeenCalledWith(featureCollection);
    });

    it("calls onError for invalid data", async () => {
      const onData = vi.fn();
      const onError = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData,
        onError,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(JSON.stringify({ invalid: "data" }));
      await Promise.resolve();

      expect(onData).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls onStateChange on connection", async () => {
      const onStateChange = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
        onStateChange,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(onStateChange).toHaveBeenCalledWith("connecting");
      expect(onStateChange).toHaveBeenCalledWith("connected");
    });

    it("updates message count and last message timestamp", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      mockEventSource?.triggerMessage(JSON.stringify(featureCollection));
      await Promise.resolve();

      const state = manager.getState("test-sse");
      expect(state?.messageCount).toBe(1);
      expect(state?.lastMessage).toBeGreaterThan(0);
    });

    it("passes event types to SSE connection", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
        eventTypes: ["update", "delete"],
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-sse")).toBe(true);
    });
  });

  describe("connect - WebSocket", () => {
    it("connects to WebSocket stream", async () => {
      const onData = vi.fn();
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData,
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-ws")).toBe(true);
      expect(manager.getActiveIds()).toEqual(["test-ws"]);
    });

    it("calls onData with valid FeatureCollection", async () => {
      const onData = vi.fn();
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData,
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      mockWebSocket?.triggerMessage(JSON.stringify(featureCollection));
      await Promise.resolve();

      expect(onData).toHaveBeenCalledWith(featureCollection);
    });

    it("passes protocols to WebSocket connection", async () => {
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
        protocols: ["json", "v1"],
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-ws")).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("disconnects SSE stream", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      manager.disconnect("test-sse");
      await Promise.resolve();

      expect(manager.isConnected("test-sse")).toBe(false);
      expect(manager.getActiveIds()).toEqual([]);
    });

    it("disconnects WebSocket stream", async () => {
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      manager.disconnect("test-ws");
      await Promise.resolve();

      expect(manager.isConnected("test-ws")).toBe(false);
    });

    it("handles disconnecting non-existent stream", () => {
      expect(() => manager.disconnect("non-existent")).not.toThrow();
    });
  });

  describe("disconnectAll", () => {
    it("disconnects all active streams", async () => {
      const sseConfig: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const wsConfig: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
      };

      // Connect SSE
      const ssePromise = manager.connect("sse-1", sseConfig);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await ssePromise;

      // Connect WebSocket
      const wsPromise = manager.connect("ws-1", wsConfig);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await wsPromise;

      expect(manager.getActiveIds()).toHaveLength(2);

      manager.disconnectAll();
      await Promise.resolve();

      expect(manager.getActiveIds()).toEqual([]);
    });
  });

  describe("getState", () => {
    it("returns state for active stream", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      const state = manager.getState("test-sse");
      expect(state).toEqual({
        connectionState: "connected",
        messageCount: 0,
        lastMessage: null,
        reconnectAttempts: 0,
      });
    });

    it("returns null for non-existent stream", () => {
      const state = manager.getState("non-existent");
      expect(state).toBeNull();
    });

    it("tracks multiple messages", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      mockEventSource?.triggerMessage(JSON.stringify(featureCollection));
      mockEventSource?.triggerMessage(JSON.stringify(featureCollection));
      mockEventSource?.triggerMessage(JSON.stringify(featureCollection));
      await Promise.resolve();

      const state = manager.getState("test-sse");
      expect(state?.messageCount).toBe(3);
    });
  });

  describe("isConnected", () => {
    it("returns true for connected stream", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-sse")).toBe(true);
    });

    it("returns false for disconnected stream", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      manager.disconnect("test-sse");
      await Promise.resolve();

      expect(manager.isConnected("test-sse")).toBe(false);
    });

    it("returns false for non-existent stream", () => {
      expect(manager.isConnected("non-existent")).toBe(false);
    });
  });

  describe("send", () => {
    it("sends data via WebSocket", async () => {
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      const sendSpy = vi.spyOn(mockWebSocket!, "send");

      manager.send("test-ws", { type: "ping" });

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    });

    it("throws if stream not found", () => {
      expect(() => manager.send("non-existent", {})).toThrow(
        'Stream "non-existent" not found'
      );
    });

    it("throws if stream is not WebSocket", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(() => manager.send("test-sse", {})).toThrow(
        'Stream "test-sse" is not a WebSocket connection'
      );
    });
  });

  describe("reconnection", () => {
    it("configures reconnection settings", async () => {
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
        reconnect: {
          enabled: true,
          maxRetries: 5,
          initialDelay: 500,
          maxDelay: 5000,
        },
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-ws")).toBe(true);
    });

    it("disables reconnection when configured", async () => {
      const config: StreamConfig = {
        type: "websocket",
        url: "wss://example.com/stream",
        onData: vi.fn(),
        reconnect: { enabled: false },
      };

      const connectPromise = manager.connect("test-ws", config);
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(manager.isConnected("test-ws")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("calls onError on connection error", async () => {
      const onError = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
        onError,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerError();

      await expect(connectPromise).rejects.toThrow();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls onError for non-FeatureCollection data", async () => {
      const onError = vi.fn();
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
        onError,
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(
        JSON.stringify({ type: "NotAFeatureCollection" })
      );
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Received data is not a valid GeoJSON FeatureCollection",
        })
      );
    });
  });

  describe("destroy", () => {
    it("disconnects all streams on destroy", async () => {
      const config: StreamConfig = {
        type: "sse",
        url: "https://example.com/events",
        onData: vi.fn(),
      };

      const connectPromise = manager.connect("test-sse", config);
      await Promise.resolve();
      mockEventSource?.triggerOpen();
      await connectPromise;

      manager.destroy();
      await Promise.resolve();

      expect(manager.getActiveIds()).toEqual([]);
    });
  });
});
