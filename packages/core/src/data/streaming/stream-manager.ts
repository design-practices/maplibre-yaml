import type { FeatureCollection } from "geojson";
import type { ConnectionState } from "./base-connection";
import { SSEConnection } from "./sse-connection";
import { WebSocketConnection } from "./websocket-connection";
import type { SSEConfig } from "./sse-connection";
import type { WebSocketConfig } from "./websocket-connection";

/**
 * Configuration for a streaming connection.
 *
 * @example
 * ```typescript
 * const config: StreamConfig = {
 *   type: 'sse',
 *   url: 'https://api.example.com/events',
 *   onData: (data) => console.log('Received:', data),
 *   reconnect: { enabled: true, maxRetries: 10 }
 * };
 * ```
 */
export interface StreamConfig {
  /** Type of streaming connection */
  type: "websocket" | "sse";

  /** URL for the streaming connection */
  url: string;

  /** Callback for incoming data */
  onData: (data: FeatureCollection) => void;

  /** Callback for connection state changes */
  onStateChange?: (state: ConnectionState) => void;

  /** Callback for errors */
  onError?: (error: Error) => void;

  /** Reconnection configuration */
  reconnect?: {
    enabled?: boolean;
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };

  /** Event types to listen for (SSE only) */
  eventTypes?: string[];

  /** WebSocket protocols (WebSocket only) */
  protocols?: string | string[];
}

/**
 * State of a streaming connection.
 */
export interface StreamState {
  /** Current connection state */
  connectionState: ConnectionState;

  /** Number of messages received */
  messageCount: number;

  /** Timestamp of last message (milliseconds) */
  lastMessage: number | null;

  /** Number of reconnection attempts */
  reconnectAttempts: number;
}

/**
 * Internal stream subscription.
 */
interface StreamSubscription {
  config: StreamConfig;
  connection: SSEConnection | WebSocketConnection;
  state: StreamState;
}

/**
 * Manages streaming connections (SSE and WebSocket).
 *
 * @remarks
 * Provides a unified interface for managing multiple streaming connections,
 * handling connection lifecycle, automatic reconnection, and message routing.
 *
 * Features:
 * - Multiple concurrent connections
 * - Automatic reconnection with exponential backoff
 * - Connection state tracking
 * - Message counting and statistics
 * - Type-safe callbacks
 *
 * @example
 * ```typescript
 * const manager = new StreamManager();
 *
 * // Connect to SSE stream
 * await manager.connect('earthquake-feed', {
 *   type: 'sse',
 *   url: 'https://earthquake.usgs.gov/events',
 *   onData: (data) => updateMap(data),
 *   reconnect: { enabled: true }
 * });
 *
 * // Connect to WebSocket stream
 * await manager.connect('vehicle-updates', {
 *   type: 'websocket',
 *   url: 'wss://transit.example.com/vehicles',
 *   onData: (data) => updateVehicles(data),
 *   protocols: ['json']
 * });
 *
 * // Send data via WebSocket
 * manager.send('vehicle-updates', { type: 'subscribe', channel: 'all' });
 *
 * // Check connection state
 * const state = manager.getState('earthquake-feed');
 * console.log(`Messages received: ${state?.messageCount}`);
 *
 * // Disconnect when done
 * manager.disconnect('earthquake-feed');
 * manager.disconnectAll();
 * ```
 */
export class StreamManager {
  private subscriptions = new Map<string, StreamSubscription>();

  /**
   * Connect to a streaming source.
   *
   * @param id - Unique identifier for this connection
   * @param config - Stream configuration
   * @throws {Error} If a connection with the given id already exists
   *
   * @example
   * ```typescript
   * await manager.connect('updates', {
   *   type: 'sse',
   *   url: 'https://api.example.com/stream',
   *   onData: (data) => console.log(data)
   * });
   * ```
   */
  async connect(id: string, config: StreamConfig): Promise<void> {
    if (this.subscriptions.has(id)) {
      throw new Error(`Stream with id "${id}" already exists`);
    }

    // Create connection based on type
    const connection = this.createConnection(config);

    // Initialize state
    const state: StreamState = {
      connectionState: "disconnected",
      messageCount: 0,
      lastMessage: null,
      reconnectAttempts: 0,
    };

    // Store subscription
    this.subscriptions.set(id, { config, connection, state });

    // Setup event handlers
    const handlers = this.setupEventHandlers(id, connection, config, state);

    // Connect. A first connection that fails is reported once (onError) and,
    // with reconnecting on, retried with the reconnect backoff in the
    // background; the returned promise still rejects. `disconnect(id)` stops
    // the retries.
    try {
      await connection.connect();
    } catch (error) {
      handlers.report(`the stream \`${config.url}\` couldn't connect`);
      void connection.reconnect();
      throw error;
    }
  }

  /**
   * Disconnect a specific stream.
   *
   * @param id - Stream identifier
   *
   * @example
   * ```typescript
   * manager.disconnect('updates');
   * ```
   */
  disconnect(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      return;
    }

    // Forgotten first: what the disconnect emits isn't reported.
    this.subscriptions.delete(id);
    subscription.connection.disconnect();
  }

  /**
   * Disconnect all active streams.
   *
   * @example
   * ```typescript
   * manager.disconnectAll();
   * ```
   */
  disconnectAll(): void {
    for (const id of this.subscriptions.keys()) {
      this.disconnect(id);
    }
  }

  /**
   * Get the current state of a stream.
   *
   * @param id - Stream identifier
   * @returns Stream state or null if not found
   *
   * @example
   * ```typescript
   * const state = manager.getState('updates');
   * if (state) {
   *   console.log(`State: ${state.connectionState}`);
   *   console.log(`Messages: ${state.messageCount}`);
   * }
   * ```
   */
  getState(id: string): StreamState | null {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription.state } : null;
  }

  /**
   * Check if a stream is currently connected.
   *
   * @param id - Stream identifier
   * @returns True if connected, false otherwise
   *
   * @example
   * ```typescript
   * if (manager.isConnected('updates')) {
   *   console.log('Stream is active');
   * }
   * ```
   */
  isConnected(id: string): boolean {
    const subscription = this.subscriptions.get(id);
    return subscription ? subscription.connection.isConnected() : false;
  }

  /**
   * Get all active stream IDs.
   *
   * @returns Array of active stream identifiers
   *
   * @example
   * ```typescript
   * const activeStreams = manager.getActiveIds();
   * console.log(`Active streams: ${activeStreams.join(', ')}`);
   * ```
   */
  getActiveIds(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Send data to a WebSocket connection.
   *
   * @param id - Stream identifier
   * @param data - Data to send (will be JSON stringified)
   * @throws {Error} If stream is not a WebSocket connection or not connected
   *
   * @example
   * ```typescript
   * manager.send('ws-updates', {
   *   type: 'subscribe',
   *   channels: ['news', 'sports']
   * });
   * ```
   */
  send(id: string, data: unknown): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      throw new Error(`Stream "${id}" not found`);
    }

    if (!(subscription.connection instanceof WebSocketConnection)) {
      throw new Error(`Stream "${id}" is not a WebSocket connection`);
    }

    subscription.connection.send(data);
  }

  /**
   * Clean up all resources.
   *
   * @example
   * ```typescript
   * manager.destroy();
   * ```
   */
  destroy(): void {
    this.disconnectAll();
  }

  /**
   * Create a connection instance based on config type.
   */
  private createConnection(
    config: StreamConfig
  ): SSEConnection | WebSocketConnection {
    const reconnectConfig =
      config.reconnect?.enabled !== false
        ? {
            reconnect: true,
            reconnectConfig: {
              maxRetries: config.reconnect?.maxRetries ?? 10,
              initialDelay: config.reconnect?.initialDelay ?? 1000,
              maxDelay: config.reconnect?.maxDelay ?? 30000,
            },
          }
        : { reconnect: false };

    if (config.type === "sse") {
      const sseConfig: SSEConfig = {
        url: config.url,
        ...reconnectConfig,
        eventTypes: config.eventTypes,
      };
      return new SSEConnection(sseConfig);
    } else {
      const wsConfig: WebSocketConfig = {
        url: config.url,
        ...reconnectConfig,
        protocols: config.protocols,
      };
      return new WebSocketConnection(wsConfig);
    }
  }

  /**
   * Setup event handlers for a connection.
   *
   * @remarks
   * A stream's outage is reported to `onError` once: a first connection
   * that fails, the attempts running out after a drop, or a drop with
   * reconnecting off. A drop it is reconnecting from is not reported, and
   * the next connection resets the count. The error carries the stream's
   * URL as `stream`, so a host can say the data it has stays.
   */
  private setupEventHandlers(
    id: string,
    connection: SSEConnection | WebSocketConnection,
    config: StreamConfig,
    state: StreamState
  ): { report: (message: string) => void } {
    let reported = false;
    const report = (message: string): void => {
      // Disconnected meanwhile (`disconnect(id)`): nothing to report.
      if (reported || this.subscriptions.get(id)?.connection !== connection) return;
      reported = true;
      config.onError?.(Object.assign(new Error(message), { stream: config.url }));
    };

    // State change handler
    connection.on("stateChange", ({ to }) => {
      state.connectionState = to;
      config.onStateChange?.(to);
    });

    // A new outage is reported again.
    connection.on("connect", () => {
      reported = false;
    });

    // Message handler
    connection.on("message", ({ data }) => {
      state.messageCount++;
      state.lastMessage = Date.now();

      // Validate data is a FeatureCollection
      if (this.isFeatureCollection(data)) {
        config.onData(data);
      } else {
        const error = new Error(
          "Received data is not a valid GeoJSON FeatureCollection"
        );
        config.onError?.(error);
      }
    });

    // A message that isn't JSON. A connection that fails to open is
    // reported by `report` (above, and in `connect`), not here.
    connection.on("error", ({ error }) => {
      if (connection.isConnected()) config.onError?.(error);
    });

    // A drop with reconnecting off: the stream has ended.
    connection.on("disconnect", () => {
      if (config.reconnect?.enabled === false) {
        report(`the stream \`${config.url}\` closed, and \`reconnect: false\` keeps it closed`);
      }
    });

    // Reconnection tracking
    connection.on("reconnecting", () => {
      state.reconnectAttempts++;
    });

    // Reset attempts on successful reconnection
    connection.on("reconnected", () => {
      state.reconnectAttempts = 0;
    });

    // Reconnecting gave up
    connection.on("failed", ({ attempts }) => {
      report(
        `the stream \`${config.url}\` closed and didn't reconnect` +
          (attempts ? ` (${attempts} attempt${attempts === 1 ? "" : "s"})` : "")
      );
    });

    return { report };
  }

  /**
   * Type guard to check if data is a FeatureCollection.
   */
  private isFeatureCollection(data: unknown): data is FeatureCollection {
    return (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "FeatureCollection" &&
      "features" in data &&
      Array.isArray(data.features)
    );
  }
}
