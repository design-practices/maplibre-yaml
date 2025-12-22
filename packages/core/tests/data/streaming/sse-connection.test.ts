/**
 * @file Tests for SSEConnection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SSEConnection } from "../../../src/data/streaming/sse-connection";

/**
 * Mock EventSource for testing
 */
class MockEventSource {
  public url: string;
  public withCredentials: boolean;
  public readyState: number;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<(event: any) => void>>();

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string, config?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = config?.withCredentials ?? false;
    this.readyState = MockEventSource.CONNECTING;
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  // Test helper methods
  triggerOpen(): void {
    this.readyState = MockEventSource.OPEN;
    const event = new Event("open");
    this.listeners.get("open")?.forEach((listener) => listener(event));
  }

  triggerError(): void {
    const event = new Event("error");
    this.listeners.get("error")?.forEach((listener) => listener(event));
  }

  triggerMessage(
    data: string,
    eventType = "message",
    lastEventId?: string
  ): void {
    const event = new MessageEvent(eventType, {
      data,
      lastEventId: lastEventId ?? "",
    });
    this.listeners.get(eventType)?.forEach((listener) => listener(event));
  }
}

describe("SSEConnection", () => {
  let connection: SSEConnection;
  let mockEventSource: MockEventSource | null = null;

  beforeEach(() => {
    // Mock global EventSource
    global.EventSource = vi.fn((url: string, config?: any) => {
      mockEventSource = new MockEventSource(url, config);
      return mockEventSource as any;
    }) as any;
  });

  afterEach(() => {
    connection?.disconnect();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("initializes with default config", () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      expect(connection.getState()).toBe("disconnected");
      expect(connection.getLastEventId()).toBeNull();
    });

    it("accepts custom event types", () => {
      connection = new SSEConnection({
        url: "http://example.com/events",
        eventTypes: ["update", "delete"],
      });

      expect(connection.getState()).toBe("disconnected");
    });

    it("accepts withCredentials option", () => {
      connection = new SSEConnection({
        url: "http://example.com/events",
        withCredentials: true,
      });

      expect(connection.getState()).toBe("disconnected");
    });
  });

  describe("connect()", () => {
    it("creates EventSource with URL", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(global.EventSource).toHaveBeenCalledWith(
        "http://example.com/events",
        { withCredentials: false }
      );
      expect(connection.getState()).toBe("connected");
    });

    it("creates EventSource with withCredentials", async () => {
      connection = new SSEConnection({
        url: "http://example.com/events",
        withCredentials: true,
      });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(global.EventSource).toHaveBeenCalledWith(
        "http://example.com/events",
        { withCredentials: true }
      );
    });

    it("emits connect event on success", async () => {
      const onConnect = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("connect", onConnect);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(connection.isConnected()).toBe(true);
    });

    it("throws on connection error", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerError();

      await expect(connectPromise).rejects.toThrow("Failed to connect");
    });

    it("throws if already connected", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      await expect(connection.connect()).rejects.toThrow(
        "Connection already exists"
      );
    });

    it("listens to default message event type", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      // Verify message listener was added
      expect(mockEventSource?.listeners.has("message")).toBe(true);
    });

    it("listens to custom event types", async () => {
      connection = new SSEConnection({
        url: "http://example.com/events",
        eventTypes: ["update", "delete"],
      });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(mockEventSource?.listeners.has("update")).toBe(true);
      expect(mockEventSource?.listeners.has("delete")).toBe(true);
    });
  });

  describe("disconnect()", () => {
    it("closes EventSource", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      const closeSpy = vi.spyOn(mockEventSource!, "close");

      connection.disconnect();

      expect(closeSpy).toHaveBeenCalled();
      expect(connection.getState()).toBe("disconnected");
    });

    it("emits disconnect event", async () => {
      const onDisconnect = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("disconnect", onDisconnect);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      connection.disconnect();

      expect(onDisconnect).toHaveBeenCalledWith({
        reason: "Manual disconnect",
      });
    });

    it("handles disconnect when not connected", () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      expect(() => connection.disconnect()).not.toThrow();
    });
  });

  describe("message handling", () => {
    it("parses JSON messages", async () => {
      const onMessage = vi.fn();
      const testData = { type: "update", id: 123 };

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("message", onMessage);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(JSON.stringify(testData));

      expect(onMessage).toHaveBeenCalledWith({ data: testData });
    });

    it("handles multiple messages", async () => {
      const onMessage = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("message", onMessage);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(JSON.stringify({ id: 1 }));
      mockEventSource?.triggerMessage(JSON.stringify({ id: 2 }));
      mockEventSource?.triggerMessage(JSON.stringify({ id: 3 }));

      expect(onMessage).toHaveBeenCalledTimes(3);
    });

    it("emits error on invalid JSON", async () => {
      const onError = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("error", onError);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage("not valid json");

      expect(onError).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: expect.stringContaining("Failed to parse SSE message"),
        }),
      });
    });

    it("continues receiving messages after JSON parse error", async () => {
      const onMessage = vi.fn();
      const onError = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("message", onMessage);
      connection.on("error", onError);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage("invalid");
      mockEventSource?.triggerMessage(JSON.stringify({ valid: true }));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({ data: { valid: true } });
    });

    it("handles custom event types", async () => {
      const onMessage = vi.fn();

      connection = new SSEConnection({
        url: "http://example.com/events",
        eventTypes: ["update"],
      });
      connection.on("message", onMessage);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(
        JSON.stringify({ type: "update" }),
        "update"
      );

      expect(onMessage).toHaveBeenCalledWith({ data: { type: "update" } });
    });
  });

  describe("getLastEventId()", () => {
    it("returns null initially", () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      expect(connection.getLastEventId()).toBeNull();
    });

    it("tracks last event ID", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(
        JSON.stringify({ id: 1 }),
        "message",
        "event-123"
      );

      expect(connection.getLastEventId()).toBe("event-123");
    });

    it("updates last event ID with each message", async () => {
      connection = new SSEConnection({ url: "http://example.com/events" });

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerMessage(
        JSON.stringify({ id: 1 }),
        "message",
        "event-1"
      );
      expect(connection.getLastEventId()).toBe("event-1");

      mockEventSource?.triggerMessage(
        JSON.stringify({ id: 2 }),
        "message",
        "event-2"
      );
      expect(connection.getLastEventId()).toBe("event-2");
    });
  });

  describe("error handling", () => {
    it("emits error event on connection error", async () => {
      const onError = vi.fn();

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("error", onError);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      mockEventSource?.triggerError();

      expect(onError).toHaveBeenCalledWith({
        error: expect.any(Error),
      });
    });

    it("detects when EventSource is closed", async () => {
      const onError = vi.fn();

      connection = new SSEConnection({
        url: "http://example.com/events",
      });
      connection.on("error", onError);

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      // Simulate connection error while connected
      mockEventSource?.triggerError();

      expect(onError).toHaveBeenCalledWith({
        error: expect.any(Error),
      });
    });
  });

  describe("state changes", () => {
    it("transitions through connecting to connected", async () => {
      const states: string[] = [];

      connection = new SSEConnection({ url: "http://example.com/events" });
      connection.on("stateChange", ({ to }) => states.push(to));

      const connectPromise = connection.connect();
      mockEventSource?.triggerOpen();
      await connectPromise;

      expect(states).toEqual(["connecting", "connected"]);
    });
  });
});
