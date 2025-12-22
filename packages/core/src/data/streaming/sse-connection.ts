/**
 * @file Server-Sent Events connection implementation
 * @module @maplibre-yaml/core/data/streaming
 */

import { BaseConnection } from "./base-connection";
import type { ConnectionConfig } from "./base-connection";

/**
 * Configuration for SSE connections.
 *
 * @remarks
 * Server-Sent Events (SSE) is a server push technology enabling a client
 * to receive automatic updates from a server via an HTTP connection.
 *
 * SSE is unidirectional (server to client only) and automatically handles
 * reconnection when the connection is lost.
 */
export interface SSEConfig extends ConnectionConfig {
  /**
   * Event types to listen for (default: ['message'])
   *
   * @remarks
   * The EventSource API can listen for custom event types sent by the server.
   * By default, it listens to the 'message' event type.
   *
   * @example
   * ```typescript
   * eventTypes: ['update', 'delete', 'create']
   * ```
   */
  eventTypes?: string[];

  /**
   * Include credentials in CORS requests (default: false)
   *
   * @remarks
   * When true, the EventSource will include credentials (cookies, authorization
   * headers, etc.) when making cross-origin requests.
   */
  withCredentials?: boolean;
}

/**
 * Server-Sent Events connection.
 *
 * @remarks
 * Primary streaming mechanism for real-time updates. Uses the native
 * EventSource API for robust, automatic reconnection handling.
 *
 * Features:
 * - Automatic reconnection by the browser
 * - Event-based message streaming
 * - JSON message parsing with error handling
 * - Multiple event type support
 * - Last event ID tracking for resume
 *
 * @example
 * ```typescript
 * const sse = new SSEConnection({
 *   url: 'https://api.example.com/events',
 *   eventTypes: ['update', 'delete'],
 * });
 *
 * sse.on('message', ({ data }) => {
 *   console.log('Received:', data);
 * });
 *
 * sse.on('error', ({ error }) => {
 *   console.error('Error:', error);
 * });
 *
 * await sse.connect();
 * ```
 */
export class SSEConnection extends BaseConnection {
  private eventSource: EventSource | null = null;
  private lastEventId: string | null = null;
  private readonly sseConfig: Required<SSEConfig>;

  /**
   * Create a new SSE connection.
   *
   * @param config - SSE configuration
   *
   * @example
   * ```typescript
   * const connection = new SSEConnection({
   *   url: 'https://api.example.com/stream',
   *   eventTypes: ['message', 'update'],
   *   withCredentials: true,
   * });
   * ```
   */
  constructor(config: SSEConfig) {
    super(config);

    this.sseConfig = {
      ...this.config,
      eventTypes: config.eventTypes ?? ["message"],
      withCredentials: config.withCredentials ?? false,
    };
  }

  /**
   * Establish SSE connection.
   *
   * @remarks
   * Creates an EventSource and sets up event listeners for:
   * - Connection open
   * - Message events (for each configured event type)
   * - Error events
   *
   * The EventSource API handles reconnection automatically when the
   * connection is lost, unless explicitly closed.
   *
   * @throws Error if EventSource is not supported or connection fails
   *
   * @example
   * ```typescript
   * await connection.connect();
   * console.log('Connected to SSE stream');
   * ```
   */
  async connect(): Promise<void> {
    if (this.eventSource !== null) {
      throw new Error("Connection already exists");
    }

    this.setState("connecting");

    try {
      // Create EventSource with configuration
      this.eventSource = new EventSource(this.sseConfig.url, {
        withCredentials: this.sseConfig.withCredentials,
      });

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        if (!this.eventSource) {
          reject(new Error("EventSource not created"));
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
          const error = new Error("Failed to connect to SSE stream");
          this.emit("error", { error });
          reject(error);
        };

        const cleanup = () => {
          this.eventSource?.removeEventListener("open", onOpen);
          this.eventSource?.removeEventListener("error", onError);
        };

        this.eventSource.addEventListener("open", onOpen);
        this.eventSource.addEventListener("error", onError);
      });

      // Setup message listeners for each event type
      this.setupEventListeners();
    } catch (error) {
      this.closeEventSource();
      throw error;
    }
  }

  /**
   * Close SSE connection.
   *
   * @remarks
   * Closes the EventSource and cleans up all event listeners.
   * Sets the manual disconnect flag to prevent automatic reconnection.
   *
   * @example
   * ```typescript
   * connection.disconnect();
   * console.log('Disconnected from SSE stream');
   * ```
   */
  disconnect(): void {
    this.setManualDisconnect();
    this.closeEventSource();
    this.handleDisconnect("Manual disconnect");
  }

  /**
   * Get the last event ID received from the server.
   *
   * @returns Last event ID or null if none received
   *
   * @remarks
   * The event ID is used by the EventSource API to resume the stream
   * from the last received event after a reconnection. The browser
   * automatically sends this ID in the `Last-Event-ID` header.
   *
   * @example
   * ```typescript
   * const lastId = connection.getLastEventId();
   * if (lastId) {
   *   console.log(`Last event: ${lastId}`);
   * }
   * ```
   */
  getLastEventId(): string | null {
    return this.lastEventId;
  }

  /**
   * Setup event listeners for configured event types.
   */
  private setupEventListeners(): void {
    if (!this.eventSource) return;

    // Add listener for each configured event type
    for (const eventType of this.sseConfig.eventTypes) {
      this.eventSource.addEventListener(eventType, (event: MessageEvent) => {
        this.handleMessage(event);
      });
    }

    // Add error listener for connection issues
    this.eventSource.addEventListener("error", () => {
      this.handleError();
    });
  }

  /**
   * Handle incoming message event.
   */
  private handleMessage(event: MessageEvent): void {
    // Update last event ID if provided
    if (event.lastEventId) {
      this.lastEventId = event.lastEventId;
    }

    try {
      // Try to parse as JSON
      const data = JSON.parse(event.data);
      this.emit("message", { data });
    } catch (error) {
      // If parsing fails, emit error but don't disconnect
      const parseError = new Error(
        `Failed to parse SSE message as JSON: ${event.data}`
      );
      this.emit("error", { error: parseError });
    }
  }

  /**
   * Handle error event from EventSource.
   */
  private handleError(): void {
    // Only handle errors when connected (ignore reconnection attempts)
    if (this.state === "connected") {
      const error = new Error("SSE connection error");
      this.emit("error", { error });

      // Check if EventSource is closed
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.closeEventSource();
        this.handleDisconnect("Connection closed by server");
      }
    }
  }

  /**
   * Close EventSource and clean up.
   */
  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
