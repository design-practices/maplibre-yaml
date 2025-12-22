/**
 * @file Streaming connections module exports
 * @module @maplibre-yaml/core/data/streaming
 */

export { BaseConnection } from "./base-connection";
export type {
  ConnectionState,
  ConnectionEvents,
  ConnectionConfig,
} from "./base-connection";

export { SSEConnection } from "./sse-connection";
export type { SSEConfig } from "./sse-connection";

export { WebSocketConnection } from "./websocket-connection";
export type { WebSocketConfig } from "./websocket-connection";

export { StreamManager } from "./stream-manager";
export type { StreamConfig, StreamState } from "./stream-manager";
