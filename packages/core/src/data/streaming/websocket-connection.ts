/**
 * @file WebSocket connection implementation
 * @module @maplibre-yaml/core/data/streaming
 */

import { BaseConnection } from "./base-connection";
import type { ConnectionConfig } from "./base-connection";

/**
 * Configuration for WebSocket connections.
 *
 * @remarks
 * WebSocket provides full-duplex communication over a single TCP connection,
 * enabling bidirectional data flow between client and server.
 */
export interface WebSocketConfig extends ConnectionConfig {
  /**
   * WebSocket sub-protocols to use
   *
   * @remarks
   * Sub-protocols allow the client and server to agree on a specific
   * protocol on top of WebSocket. Can be a single string or array of strings.
   *
   * @example
   * ```typescript
   * protocols: 'json'
   * protocols: ['json', 'msgpack']
   * ```
   */
  protocols?: string | string[];
}

/**
 * WebSocket connection for bidirectional streaming.
 *
 * @remarks
 * Provides real-time bidirectional communication with automatic reconnection.
 * Unlike SSE, WebSocket supports sending data from client to server.
 *
 * Features:
 * - Full-duplex communication
 * - JSON message parsing with text fallback
 * - Manual reconnection with exponential backoff
 * - Sub-protocol support
 * - Send capability with connection validation
 *
 * @example
 * ```typescript
 * const ws = new WebSocketConnection({
 *   url: 'wss://api.example.com/stream',
 *   protocols: 'json',
 * });
 *
 * ws.on('message', ({ data }) => {
 *   console.log('Received:', data);
 * });
 *
 * await ws.connect();
 * ws.send({ type: 'subscribe', channel: 'updates' });
 * ```
 */
export class WebSocketConnection extends BaseConnection {
  private ws: WebSocket | null = null;
  private readonly wsConfig: WebSocketConfig;

  /**
   * Create a new WebSocket connection.
   *
   * @param config - WebSocket configuration
   *
   * @example
   * ```typescript
   * const connection = new WebSocketConnection({
   *   url: 'wss://api.example.com/stream',
   *   protocols: ['json', 'v1'],
   * });
   * ```
   */
  constructor(config: WebSocketConfig) {
    super(config);

    this.wsConfig = {
      ...this.config,
      protocols: config.protocols,
    };
  }

  /**
   * Establish WebSocket connection.
   *
   * @remarks
   * Creates a WebSocket and sets up event listeners for:
   * - Connection open
   * - Message reception
   * - Connection close
   * - Errors
   *
   * Unlike EventSource, WebSocket does not have built-in reconnection,
   * so reconnection is handled manually via the BaseConnection.
   *
   * @throws Error if WebSocket is not supported or connection fails
   *
   * @example
   * ```typescript
   * await connection.connect();
   * console.log('Connected to WebSocket');
   * ```
   */
  async connect(): Promise<void> {
    if (this.ws !== null) {
      throw new Error("Connection already exists");
    }

    this.setState("connecting");

    try {
      // Create WebSocket with optional protocols
      this.ws = this.wsConfig.protocols
        ? new WebSocket(this.wsConfig.url, this.wsConfig.protocols)
        : new WebSocket(this.wsConfig.url);

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new Error("WebSocket not created"));
          return;
        }

        const onOpen = () => {
          cleanup();
          this.setState("connected");
          this.resetManualDisconnect();
          this.emit("connect", undefined);
          resolve();
        };

        const onError = () => {
          cleanup();
          const error = new Error("Failed to connect to WebSocket");
          this.emit("error", { error });
          reject(error);
        };

        const cleanup = () => {
          if (this.ws) {
            this.ws.removeEventListener("open", onOpen);
            this.ws.removeEventListener("error", onError);
          }
        };

        this.ws.addEventListener("open", onOpen);
        this.ws.addEventListener("error", onError);
      });

      // Setup message and close listeners
      this.setupEventListeners();
    } catch (error) {
      this.closeWebSocket();
      throw error;
    }
  }

  /**
   * Close WebSocket connection.
   *
   * @remarks
   * Closes the WebSocket with a normal closure code (1000).
   * Sets the manual disconnect flag to prevent automatic reconnection.
   *
   * @example
   * ```typescript
   * connection.disconnect();
   * console.log('Disconnected from WebSocket');
   * ```
   */
  disconnect(): void {
    this.setManualDisconnect();
    this.closeWebSocket();
    this.handleDisconnect("Manual disconnect");
  }

  /**
   * Send data through WebSocket.
   *
   * @param data - Data to send (will be JSON stringified)
   * @throws Error if not connected
   *
   * @remarks
   * The data is automatically converted to JSON before sending.
   * Throws an error if called when the connection is not established.
   *
   * @example
   * ```typescript
   * connection.send({ type: 'ping' });
   * connection.send({ type: 'subscribe', channel: 'updates' });
   * ```
   */
  send(data: unknown): void {
    if (!this.isConnected() || !this.ws) {
      throw new Error("Cannot send: not connected");
    }

    const message = JSON.stringify(data);
    this.ws.send(message);
  }

  /**
   * Setup WebSocket event listeners.
   */
  private setupEventListeners(): void {
    if (!this.ws) return;

    // Message listener
    this.ws.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event);
    });

    // Close listener
    this.ws.addEventListener("close", (event: CloseEvent) => {
      this.handleClose(event);
    });

    // Error listener
    this.ws.addEventListener("error", () => {
      this.handleError();
    });
  }

  /**
   * Handle incoming message event.
   */
  private handleMessage(event: MessageEvent): void {
    try {
      // Try to parse as JSON
      const data = JSON.parse(event.data);
      this.emit("message", { data });
    } catch {
      // If parsing fails, emit raw text data
      this.emit("message", { data: event.data });
    }
  }

  /**
   * Handle close event from WebSocket.
   */
  private handleClose(event: CloseEvent): void {
    this.closeWebSocket();

    const reason = event.reason || `WebSocket closed (code: ${event.code})`;
    this.handleDisconnect(reason);
  }

  /**
   * Handle error event from WebSocket.
   */
  private handleError(): void {
    if (this.state === "connecting" || this.state === "connected") {
      const error = new Error("WebSocket connection error");
      this.emit("error", { error });
    }
  }

  /**
   * Close WebSocket and clean up.
   */
  private closeWebSocket(): void {
    if (this.ws) {
      // Use normal closure code (1000)
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Normal closure");
      }
      this.ws = null;
    }
  }
}
