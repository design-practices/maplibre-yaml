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
