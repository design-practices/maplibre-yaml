/**
 * @maplibre-yaml/core
 *
 * Declarative web maps with YAML configuration.
 *
 * @packageDocumentation
 */

// Schemas
export * from "./schemas";

// Parser
export * from "./parser";

// Renderer
export * from "./renderer";

// Data
export * from "./data";

// UI
export * from "./ui";

// Utils
export { EventEmitter } from "./utils/event-emitter";
export type { EventHandler } from "./utils/event-emitter";

// Note: Components are exported separately via './components' entry point
// to avoid auto-registering custom elements when not needed
