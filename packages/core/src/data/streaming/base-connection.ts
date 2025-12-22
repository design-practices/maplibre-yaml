/**
 * @file Base connection class for streaming connections
 * @module @maplibre-yaml/core/data/streaming
 */

import { EventEmitter } from "../../utils/event-emitter";
import { RetryManager } from "../retry-manager";
import type { RetryConfig } from "../retry-manager";

/**
 * Connection state enum.
 *
 * @remarks
 * State transitions:
 * - disconnected → connecting → connected
 * - connected → disconnected (on manual disconnect)
 * - connected → reconnecting → connected (on connection loss with reconnect enabled)
 * - reconnecting → failed (after max reconnect attempts)
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * Events emitted by streaming connections.
 *
 * @remarks
 * All connections emit these events to allow consumers to react to
 * connection lifecycle changes and incoming messages.
 */
export interface ConnectionEvents extends Record<string, unknown> {
  /** Emitted when connection is established */
  connect: void;

  /** Emitted when connection is closed */
  disconnect: { reason: string };

  /** Emitted when a message is received */
  message: { data: unknown };

  /** Emitted when an error occurs */
  error: { error: Error };

  /** Emitted when attempting to reconnect */
  reconnecting: { attempt: number; delay: number };

  /** Emitted when reconnection succeeds */
  reconnected: { attempts: number };

  /** Emitted when reconnection fails after max attempts */
  failed: { attempts: number; lastError: Error };

  /** Emitted whenever connection state changes */
  stateChange: { from: ConnectionState; to: ConnectionState };
}

/**
 * Base configuration for all connection types.
 */
export interface ConnectionConfig {
  /** Connection URL */
  url: string;

  /** Enable automatic reconnection on disconnect (default: true) */
  reconnect?: boolean;

  /** Reconnection retry configuration */
  reconnectConfig?: Partial<RetryConfig>;
}

/**
 * Abstract base class for streaming connections.
 *
 * @remarks
 * Provides common functionality for all streaming connection types:
 * - Connection state management
 * - Event emission via EventEmitter
 * - Automatic reconnection with exponential backoff
 * - State change tracking
 *
 * Subclasses must implement:
 * - `connect()`: Establish the connection
 * - `disconnect()`: Close the connection
 *
 * @example
 * ```typescript
 * class MyConnection extends BaseConnection {
 *   async connect(): Promise<void> {
 *     this.setState('connecting');
 *     // ... connection logic
 *     this.setState('connected');
 *     this.emit('connect', undefined);
 *   }
 *
 *   disconnect(): void {
 *     // ... disconnection logic
 *     this.handleDisconnect('Manual disconnect');
 *   }
 * }
 * ```
 */
export abstract class BaseConnection extends EventEmitter<ConnectionEvents> {
  protected state: ConnectionState = "disconnected";
  protected config: Required<ConnectionConfig>;
  protected retryManager: RetryManager;
  protected reconnectAttempts = 0;
  protected manualDisconnect = false;

  /**
   * Create a new base connection.
   *
   * @param config - Connection configuration
   */
  constructor(config: ConnectionConfig) {
    super();

    this.config = {
      reconnect: true,
      reconnectConfig: {},
      ...config,
    };

    // Setup retry manager for reconnection
    this.retryManager = new RetryManager({
      maxRetries: 10,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      jitterFactor: 0.25,
      ...this.config.reconnectConfig,
    });
  }

  /**
   * Establish connection to the server.
   *
   * @remarks
   * Must be implemented by subclasses. Should:
   * 1. Set state to 'connecting'
   * 2. Establish the connection
   * 3. Set state to 'connected'
   * 4. Emit 'connect' event
   *
   * @throws Error if connection fails
   */
  abstract connect(): Promise<void>;

  /**
   * Close the connection.
   *
   * @remarks
   * Must be implemented by subclasses. Should:
   * 1. Close the underlying connection
   * 2. Call handleDisconnect() with reason
   */
  abstract disconnect(): void;

  /**
   * Get current connection state.
   *
   * @returns Current state
   *
   * @example
   * ```typescript
   * const state = connection.getState();
   * if (state === 'connected') {
   *   // Connection is ready
   * }
   * ```
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connection is currently connected.
   *
   * @returns True if connected
   *
   * @example
   * ```typescript
   * if (connection.isConnected()) {
   *   connection.send(data);
   * }
   * ```
   */
  isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Get the number of reconnection attempts.
   *
   * @returns Number of reconnect attempts
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Update connection state and emit state change event.
   *
   * @param newState - New connection state
   *
   * @remarks
   * Automatically emits 'stateChange' event when state changes.
   * Subclasses should call this method instead of setting state directly.
   *
   * @example
   * ```typescript
   * protected async connect() {
   *   this.setState('connecting');
   *   await this.establishConnection();
   *   this.setState('connected');
   * }
   * ```
   */
  protected setState(newState: ConnectionState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    this.emit("stateChange", { from: oldState, to: newState });
  }

  /**
   * Handle disconnection and optionally attempt reconnection.
   *
   * @param reason - Reason for disconnection
   *
   * @remarks
   * This method should be called by subclasses when the connection is lost.
   * It will:
   * 1. Emit 'disconnect' event
   * 2. Attempt reconnection if enabled and not manually disconnected
   * 3. Emit 'reconnecting', 'reconnected', or 'failed' events as appropriate
   *
   * @example
   * ```typescript
   * ws.onclose = () => {
   *   this.handleDisconnect('Connection closed');
   * };
   * ```
   */
  protected async handleDisconnect(reason: string): Promise<void> {
    // Set state before emitting disconnect event
    const wasConnected = this.state === "connected";
    this.setState("disconnected");

    // Emit disconnect event
    this.emit("disconnect", { reason });

    // Only attempt reconnection if:
    // 1. Reconnect is enabled
    // 2. Not manually disconnected
    // 3. Was previously connected (not a failed initial connection)
    if (!this.config.reconnect || this.manualDisconnect || !wasConnected) {
      return;
    }

    // Attempt reconnection with exponential backoff
    await this.attemptReconnection();
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private async attemptReconnection(): Promise<void> {
    this.setState("reconnecting");
    this.reconnectAttempts = 0;

    try {
      await this.retryManager.execute(
        async () => {
          this.reconnectAttempts++;
          await this.connect();
        },
        {
          onRetry: (attempt, delay) => {
            this.emit("reconnecting", { attempt, delay });
          },
          onSuccess: (attempts) => {
            this.reconnectAttempts = 0;
            this.emit("reconnected", { attempts });
          },
        }
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState("failed");
      this.emit("failed", {
        attempts: this.reconnectAttempts,
        lastError: error,
      });
    }
  }

  /**
   * Mark disconnection as manual to prevent reconnection.
   *
   * @remarks
   * Should be called by subclasses in their disconnect() implementation
   * before closing the connection.
   *
   * @example
   * ```typescript
   * disconnect(): void {
   *   this.setManualDisconnect();
   *   this.ws.close();
   * }
   * ```
   */
  protected setManualDisconnect(): void {
    this.manualDisconnect = true;
  }

  /**
   * Reset manual disconnect flag.
   *
   * @remarks
   * Should be called when establishing a new connection to allow
   * automatic reconnection for subsequent disconnections.
   */
  protected resetManualDisconnect(): void {
    this.manualDisconnect = false;
  }
}
