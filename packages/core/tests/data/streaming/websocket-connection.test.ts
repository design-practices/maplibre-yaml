import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WebSocketConnection } from "../../../src/data/streaming/websocket-connection";
import type { WebSocketConfig } from "../../../src/data/streaming/websocket-connection";

/**
 * Mock WebSocket implementation for testing
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

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      const event = new CloseEvent("close", { code, reason });
      this.listeners.get("close")?.forEach((listener) => listener(event));
    }, 0);
  }

  // Test helper methods
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

describe("WebSocketConnection", () => {
  let connection: WebSocketConnection;
  let config: WebSocketConfig;
  let mockWebSocket: MockWebSocket | null = null;

  beforeEach(() => {
    // Mock the global WebSocket
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor(url: string, protocols?: string | string[]) {
          mockWebSocket = new MockWebSocket(url, protocols);
          return mockWebSocket;
        }
      }
    );

    config = {
      url: "wss://example.com/stream",
      reconnect: false,
    };

    connection = new WebSocketConnection(config);
  });

  afterEach(() => {
    connection.disconnect();
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("creates connection with basic config", () => {
      expect(connection).toBeInstanceOf(WebSocketConnection);
    });

    it("accepts protocols configuration", () => {
      const wsConfig: WebSocketConfig = {
        url: "wss://example.com/stream",
        protocols: "json",
      };
      const conn = new WebSocketConnection(wsConfig);
      expect(conn).toBeInstanceOf(WebSocketConnection);
    });

    it("accepts array of protocols", () => {
      const wsConfig: WebSocketConfig = {
        url: "wss://example.com/stream",
        protocols: ["json", "v1"],
      };
      const conn = new WebSocketConnection(wsConfig);
      expect(conn).toBeInstanceOf(WebSocketConnection);
    });
  });

  describe("connect", () => {
    it("establishes WebSocket connection", async () => {
      const connectPromise = connection.connect();

      // Wait a tick for WebSocket creation
      await Promise.resolve();
      expect(mockWebSocket).not.toBeNull();
      expect(mockWebSocket?.url).toBe("wss://example.com/stream");

      // Trigger open
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(connection.getState()).toBe("connected");
    });

    it("creates WebSocket with protocols", async () => {
      const wsConfig: WebSocketConfig = {
        url: "wss://example.com/stream",
        protocols: ["json", "msgpack"],
      };
      connection = new WebSocketConnection(wsConfig);

      const connectPromise = connection.connect();
      await Promise.resolve();

      expect(mockWebSocket?.protocol).toBe("json");

      mockWebSocket?.triggerOpen();
      await connectPromise;
    });

    it("emits connect event on successful connection", async () => {
      const onConnect = vi.fn();
      connection.on("connect", onConnect);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(onConnect).toHaveBeenCalledWith(undefined);
    });

    it("emits stateChange event", async () => {
      const onStateChange = vi.fn();
      connection.on("stateChange", onStateChange);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      expect(onStateChange).toHaveBeenCalledWith({
        from: "disconnected",
        to: "connecting",
      });
      expect(onStateChange).toHaveBeenCalledWith({
        from: "connecting",
        to: "connected",
      });
    });

    it("throws error if connection already exists", async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      await expect(connection.connect()).rejects.toThrow(
        "Connection already exists"
      );
    });

    it("rejects if WebSocket fails to connect", async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerError();

      await expect(connectPromise).rejects.toThrow(
        "Failed to connect to WebSocket"
      );
    });

    it("emits error event on connection failure", async () => {
      const onError = vi.fn();
      connection.on("error", onError);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerError();

      await expect(connectPromise).rejects.toThrow();
      expect(onError).toHaveBeenCalledWith({ error: expect.any(Error) });
    });
  });

  describe("disconnect", () => {
    beforeEach(async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;
    });

    it("closes WebSocket connection", async () => {
      connection.disconnect();
      await Promise.resolve();

      expect(connection.getState()).toBe("disconnected");
    });

    it("emits disconnect event with reason", async () => {
      const onDisconnect = vi.fn();
      connection.on("disconnect", onDisconnect);

      connection.disconnect();
      await Promise.resolve();

      expect(onDisconnect).toHaveBeenCalledWith({
        reason: "Manual disconnect",
      });
    });

    it("sets manual disconnect flag", () => {
      connection.disconnect();

      expect(connection.getState()).toBe("disconnected");
    });
  });

  describe("send", () => {
    beforeEach(async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;
    });

    it("sends JSON stringified data", () => {
      const sendSpy = vi.spyOn(mockWebSocket!, "send");
      const data = { type: "ping", timestamp: Date.now() };

      connection.send(data);

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it("throws error when not connected", () => {
      connection.disconnect();

      expect(() => connection.send({ type: "ping" })).toThrow(
        "Cannot send: not connected"
      );
    });

    it("sends various data types", () => {
      const sendSpy = vi.spyOn(mockWebSocket!, "send");

      connection.send({ type: "subscribe", channel: "updates" });
      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: "subscribe", channel: "updates" })
      );

      connection.send({ count: 42 });
      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ count: 42 }));

      connection.send("plain string");
      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify("plain string"));
    });
  });

  describe("message handling", () => {
    beforeEach(async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;
    });

    it("parses JSON messages", async () => {
      const onMessage = vi.fn();
      connection.on("message", onMessage);

      const data = { type: "update", value: 42 };
      mockWebSocket?.triggerMessage(JSON.stringify(data));

      await Promise.resolve();
      expect(onMessage).toHaveBeenCalledWith({ data });
    });

    it("handles text messages when JSON parsing fails", async () => {
      const onMessage = vi.fn();
      connection.on("message", onMessage);

      const textData = "plain text message";
      mockWebSocket?.triggerMessage(textData);

      await Promise.resolve();
      expect(onMessage).toHaveBeenCalledWith({ data: textData });
    });

    it("handles multiple messages", async () => {
      const onMessage = vi.fn();
      connection.on("message", onMessage);

      mockWebSocket?.triggerMessage(JSON.stringify({ id: 1 }));
      mockWebSocket?.triggerMessage(JSON.stringify({ id: 2 }));
      mockWebSocket?.triggerMessage("text");

      await Promise.resolve();
      expect(onMessage).toHaveBeenCalledTimes(3);
      expect(onMessage).toHaveBeenNthCalledWith(1, { data: { id: 1 } });
      expect(onMessage).toHaveBeenNthCalledWith(2, { data: { id: 2 } });
      expect(onMessage).toHaveBeenNthCalledWith(3, { data: "text" });
    });
  });

  describe("close handling", () => {
    beforeEach(async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;
    });

    it("handles normal closure", async () => {
      const onDisconnect = vi.fn();
      connection.on("disconnect", onDisconnect);

      mockWebSocket?.triggerClose(1000, "Normal closure");
      await Promise.resolve();

      expect(connection.getState()).toBe("disconnected");
      expect(onDisconnect).toHaveBeenCalledWith({
        reason: "Normal closure",
      });
    });

    it("handles abnormal closure", async () => {
      const onDisconnect = vi.fn();
      connection.on("disconnect", onDisconnect);

      mockWebSocket?.triggerClose(1006, "Abnormal closure");
      await Promise.resolve();

      expect(connection.getState()).toBe("disconnected");
      expect(onDisconnect).toHaveBeenCalledWith({
        reason: "Abnormal closure",
      });
    });

    it("includes close code when no reason provided", async () => {
      const onDisconnect = vi.fn();
      connection.on("disconnect", onDisconnect);

      mockWebSocket?.triggerClose(1001, "");
      await Promise.resolve();

      expect(onDisconnect).toHaveBeenCalledWith({
        reason: "WebSocket closed (code: 1001)",
      });
    });
  });

  describe("error handling", () => {
    it("emits error event during connection", async () => {
      const onError = vi.fn();
      connection.on("error", onError);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerError();

      await expect(connectPromise).rejects.toThrow();
      expect(onError).toHaveBeenCalled();
    });

    it("emits error event when connected", async () => {
      const onError = vi.fn();
      connection.on("error", onError);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      mockWebSocket?.triggerError();
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith({ error: expect.any(Error) });
    });

    it("does not emit error when disconnected", async () => {
      const onError = vi.fn();
      connection.on("error", onError);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      connection.disconnect();
      await Promise.resolve();

      // Clear previous error calls
      onError.mockClear();

      mockWebSocket?.triggerError();
      await Promise.resolve();

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("reconnection", () => {
    it("does not reconnect when reconnect is false", async () => {
      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      mockWebSocket?.triggerClose(1006, "Connection lost");
      await Promise.resolve();

      expect(connection.getState()).toBe("disconnected");
    });

    it("does not reconnect after manual disconnect", async () => {
      const wsConfig: WebSocketConfig = {
        url: "wss://example.com/stream",
        reconnect: true,
      };
      connection = new WebSocketConnection(wsConfig);

      const onReconnecting = vi.fn();
      connection.on("reconnecting", onReconnecting);

      const connectPromise = connection.connect();
      await Promise.resolve();
      mockWebSocket?.triggerOpen();
      await connectPromise;

      connection.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(connection.getState()).toBe("disconnected");
      expect(onReconnecting).not.toHaveBeenCalled();
    });
  });
});
