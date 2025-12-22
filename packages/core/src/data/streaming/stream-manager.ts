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
    this.setupEventHandlers(connection, config, state);

    // Connect
    await connection.connect();
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

    subscription.connection.disconnect();
    this.subscriptions.delete(id);
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
            retryConfig: {
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
   */
  private setupEventHandlers(
    connection: SSEConnection | WebSocketConnection,
    config: StreamConfig,
    state: StreamState
  ): void {
    // State change handler
    connection.on("stateChange", ({ to }) => {
      state.connectionState = to;
      config.onStateChange?.(to);
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

    // Error handler
    connection.on("error", ({ error }) => {
      config.onError?.(error);
    });

    // Reconnection tracking
    connection.on("reconnecting", () => {
      state.reconnectAttempts++;
    });

    // Reset attempts on successful reconnection
    connection.on("reconnected", () => {
      state.reconnectAttempts = 0;
    });

    // Failed connection
    connection.on("failed", ({ lastError }) => {
      config.onError?.(lastError);
    });
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
