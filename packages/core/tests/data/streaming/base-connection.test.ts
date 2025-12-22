/**
 * @file Tests for BaseConnection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaseConnection } from "../../../src/data/streaming/base-connection";
import type {
  ConnectionState,
  ConnectionConfig,
} from "../../../src/data/streaming/base-connection";

/**
 * Concrete implementation for testing BaseConnection
 */
class TestConnection extends BaseConnection {
  public connectFn: () => Promise<void>;
  public disconnectFn: () => void;

  constructor(
    config: ConnectionConfig,
    connectFn?: () => Promise<void>,
    disconnectFn?: () => void
  ) {
    super(config);
    this.connectFn = connectFn || (async () => {});
    this.disconnectFn = disconnectFn || (() => {});
  }

  async connect(): Promise<void> {
    this.setState("connecting");
    await this.connectFn();
    this.setState("connected");
    this.resetManualDisconnect();
    this.emit("connect", undefined);
  }

  disconnect(): void {
    this.setManualDisconnect();
    this.disconnectFn();
    this.handleDisconnect("Manual disconnect");
  }

  // Expose protected methods for testing
  public testSetState(state: ConnectionState): void {
    this.setState(state);
  }

  public async testHandleDisconnect(reason: string): Promise<void> {
    await this.handleDisconnect(reason);
  }
}

describe("BaseConnection", () => {
  let connection: TestConnection;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("initializes with disconnected state", () => {
      connection = new TestConnection({ url: "http://example.com" });

      expect(connection.getState()).toBe("disconnected");
      expect(connection.isConnected()).toBe(false);
    });

    it("applies default config", () => {
      connection = new TestConnection({ url: "http://example.com" });

      // Config should have reconnect enabled by default
      expect(connection.getReconnectAttempts()).toBe(0);
    });

    it("accepts custom reconnect config", () => {
      connection = new TestConnection({
        url: "http://example.com",
        reconnect: false,
      });

      expect(connection.getState()).toBe("disconnected");
    });
  });

  describe("connect()", () => {
    it("transitions through connecting to connected", async () => {
      const states: ConnectionState[] = [];

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("stateChange", ({ to }) => states.push(to));

      await connection.connect();

      expect(states).toEqual(["connecting", "connected"]);
      expect(connection.getState()).toBe("connected");
      expect(connection.isConnected()).toBe(true);
    });

    it("emits connect event", async () => {
      const onConnect = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("connect", onConnect);

      await connection.connect();

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it("handles connection errors", async () => {
      const error = new Error("Connection failed");
      const connectFn = vi.fn().mockRejectedValue(error);

      connection = new TestConnection(
        { url: "http://example.com" },
        connectFn
      );

      await expect(connection.connect()).rejects.toThrow("Connection failed");
      expect(connection.getState()).toBe("connecting");
    });
  });

  describe("disconnect()", () => {
    it("disconnects and emits disconnect event", async () => {
      const onDisconnect = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("disconnect", onDisconnect);

      await connection.connect();
      connection.disconnect();

      expect(connection.getState()).toBe("disconnected");
      expect(connection.isConnected()).toBe(false);
      expect(onDisconnect).toHaveBeenCalledWith({ reason: "Manual disconnect" });
    });

    it("does not attempt reconnection on manual disconnect", async () => {
      const onReconnecting = vi.fn();

      connection = new TestConnection({
        url: "http://example.com",
        reconnect: true,
      });
      connection.on("reconnecting", onReconnecting);

      await connection.connect();
      connection.disconnect();

      await vi.runAllTimersAsync();

      expect(onReconnecting).not.toHaveBeenCalled();
      expect(connection.getState()).toBe("disconnected");
    });
  });

  describe("setState()", () => {
    it("updates state and emits stateChange event", () => {
      const onStateChange = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("stateChange", onStateChange);

      connection.testSetState("connecting");

      expect(connection.getState()).toBe("connecting");
      expect(onStateChange).toHaveBeenCalledWith({
        from: "disconnected",
        to: "connecting",
      });
    });

    it("does not emit event if state is unchanged", () => {
      const onStateChange = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("stateChange", onStateChange);

      connection.testSetState("disconnected");

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe("handleDisconnect()", () => {
    it("emits disconnect event with reason", async () => {
      const onDisconnect = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("disconnect", onDisconnect);

      await connection.connect();
      await connection.testHandleDisconnect("Connection lost");

      expect(onDisconnect).toHaveBeenCalledWith({ reason: "Connection lost" });
    });

    it("does not reconnect when reconnect is disabled", async () => {
      const onReconnecting = vi.fn();
      const connectFn = vi.fn().mockResolvedValue(undefined);

      connection = new TestConnection(
        { url: "http://example.com", reconnect: false },
        connectFn
      );
      connection.on("reconnecting", onReconnecting);

      await connection.connect();
      expect(connectFn).toHaveBeenCalledTimes(1);

      await connection.testHandleDisconnect("Connection lost");
      await vi.runAllTimersAsync();

      expect(onReconnecting).not.toHaveBeenCalled();
      expect(connectFn).toHaveBeenCalledTimes(1); // No reconnect attempt
    });

    it("attempts reconnection when enabled", async () => {
      const onReconnecting = vi.fn();
      const onReconnected = vi.fn();
      let attemptCount = 0;
      const connectFn = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          // Initial connection succeeds
          return;
        }
        if (attemptCount === 2) {
          // First reconnect fails
          throw new Error("Reconnect failed");
        }
        // Second reconnect succeeds
        return;
      });

      connection = new TestConnection(
        {
          url: "http://example.com",
          reconnect: true,
          reconnectConfig: { maxRetries: 5, initialDelay: 100 },
        },
        connectFn
      );
      connection.on("reconnecting", onReconnecting);
      connection.on("reconnected", onReconnected);

      await connection.connect();
      expect(attemptCount).toBe(1);

      // Simulate disconnection
      connection.testSetState("connected");
      const disconnectPromise = connection.testHandleDisconnect("Connection lost");

      await vi.runAllTimersAsync();
      await disconnectPromise;

      // onRetry is only called on retries (after first attempt fails)
      expect(onReconnecting).toHaveBeenCalledTimes(1);
      expect(onReconnecting).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number),
      });

      expect(onReconnected).toHaveBeenCalledWith({ attempts: 2 });
      expect(connection.getState()).toBe("connected");
    });

    it("emits failed event after max reconnect attempts", async () => {
      const onReconnecting = vi.fn();
      const onFailed = vi.fn();
      const error = new Error("Connection failed");
      const connectFn = vi.fn().mockImplementation(async () => {
        throw error;
      });

      connection = new TestConnection(
        {
          url: "http://example.com",
          reconnect: true,
          reconnectConfig: { maxRetries: 2, initialDelay: 100, maxDelay: 200 },
        },
        connectFn
      );
      connection.on("reconnecting", onReconnecting);
      connection.on("failed", onFailed);

      // Initial successful connection
      connectFn.mockResolvedValueOnce(undefined);
      await connection.connect();

      // Now it will fail on reconnect
      connectFn.mockRejectedValue(error);

      connection.testSetState("connected");
      const disconnectPromise = connection.testHandleDisconnect("Connection lost");

      await vi.runAllTimersAsync();
      await disconnectPromise;

      expect(onReconnecting).toHaveBeenCalledTimes(2);
      expect(onFailed).toHaveBeenCalledWith({
        attempts: 3, // Initial + 2 retries
        lastError: expect.any(Error),
      });
      expect(connection.getState()).toBe("failed");
    });
  });

  describe("getReconnectAttempts()", () => {
    it("tracks reconnection attempts", async () => {
      let connectCount = 0;
      const connectFn = vi.fn().mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) {
          // Initial connection succeeds
          return;
        }
        if (connectCount === 2) {
          // First reconnect fails
          throw new Error("Fail 1");
        }
        // Second reconnect succeeds
        return;
      });

      connection = new TestConnection(
        {
          url: "http://example.com",
          reconnect: true,
          reconnectConfig: { maxRetries: 5, initialDelay: 100 },
        },
        connectFn
      );

      await connection.connect();

      expect(connection.getReconnectAttempts()).toBe(0);

      // Trigger reconnection
      connection.testSetState("connected");
      const disconnectPromise = connection.testHandleDisconnect("Connection lost");

      await vi.runAllTimersAsync();
      await disconnectPromise;

      // After successful reconnect, should reset to 0
      expect(connection.getReconnectAttempts()).toBe(0);
    });
  });

  describe("event emitter integration", () => {
    it("allows multiple listeners for same event", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      connection.on("connect", listener1);
      connection.on("connect", listener2);

      await connection.connect();

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("allows unsubscribing from events", async () => {
      const listener = vi.fn();

      connection = new TestConnection({ url: "http://example.com" });
      const unsubscribe = connection.on("connect", listener);

      unsubscribe();
      await connection.connect();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
