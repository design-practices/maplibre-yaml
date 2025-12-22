/**
 * @file Type-safe event emitter utility
 * @module @maplibre-yaml/core/utils
 */

/**
 * Event handler function type
 */
export type EventHandler<T> = (data: T) => void;

/**
 * Type-safe event emitter with strongly-typed event names and payloads
 *
 * @remarks
 * This class provides a type-safe event emitter pattern where event names
 * and their payload types are strictly enforced. It's designed to be extended
 * by classes that need event emission capabilities.
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   connect: void;
 *   message: { text: string };
 *   error: { error: Error };
 * }
 *
 * class MyEmitter extends EventEmitter<MyEvents> {
 *   connect() {
 *     this.emit('connect', undefined);
 *   }
 *
 *   sendMessage(text: string) {
 *     this.emit('message', { text });
 *   }
 * }
 *
 * const emitter = new MyEmitter();
 * emitter.on('message', (data) => {
 *   console.log(data.text); // Strongly typed!
 * });
 * ```
 *
 * @typeParam Events - Record of event names to payload types
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<EventHandler<any>>>();

  /**
   * Register an event handler
   *
   * @param event - Event name to listen for
   * @param handler - Callback function to invoke when event is emitted
   * @returns Unsubscribe function that removes this specific handler
   *
   * @example
   * ```typescript
   * const unsubscribe = emitter.on('message', (data) => {
   *   console.log(data.text);
   * });
   *
   * // Later, to unsubscribe:
   * unsubscribe();
   * ```
   */
  on<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Register a one-time event handler
   *
   * @remarks
   * The handler will be automatically removed after being invoked once.
   *
   * @param event - Event name to listen for
   * @param handler - Callback function to invoke once
   *
   * @example
   * ```typescript
   * emitter.once('connect', () => {
   *   console.log('Connected!');
   * });
   * ```
   */
  once<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): void {
    const onceWrapper: EventHandler<Events[K]> = (data) => {
      this.off(event, onceWrapper);
      handler(data);
    };

    this.on(event, onceWrapper);
  }

  /**
   * Remove an event handler
   *
   * @param event - Event name
   * @param handler - Handler function to remove
   *
   * @example
   * ```typescript
   * const handler = (data) => console.log(data);
   * emitter.on('message', handler);
   * emitter.off('message', handler);
   * ```
   */
  off<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Emit an event to all registered handlers
   *
   * @remarks
   * This method is protected to ensure only the extending class can emit events.
   * All handlers are invoked synchronously in the order they were registered.
   *
   * @param event - Event name to emit
   * @param data - Event payload data
   *
   * @example
   * ```typescript
   * class MyEmitter extends EventEmitter<MyEvents> {
   *   doSomething() {
   *     this.emit('something-happened', { value: 42 });
   *   }
   * }
   * ```
   */
  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /**
   * Remove all handlers for an event, or all handlers for all events
   *
   * @param event - Optional event name. If omitted, removes all handlers for all events.
   *
   * @example
   * ```typescript
   * // Remove all handlers for 'message' event
   * emitter.removeAllListeners('message');
   *
   * // Remove all handlers for all events
   * emitter.removeAllListeners();
   * ```
   */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get the number of handlers registered for an event
   *
   * @param event - Event name
   * @returns Number of registered handlers
   *
   * @example
   * ```typescript
   * const count = emitter.listenerCount('message');
   * console.log(`${count} handlers registered`);
   * ```
   */
  listenerCount<K extends keyof Events>(event: K): number {
    const handlers = this.handlers.get(event);
    return handlers ? handlers.size : 0;
  }

  /**
   * Get all event names that have registered handlers
   *
   * @returns Array of event names
   *
   * @example
   * ```typescript
   * const events = emitter.eventNames();
   * console.log('Events with handlers:', events);
   * ```
   */
  eventNames(): Array<keyof Events> {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if an event has any registered handlers
   *
   * @param event - Event name
   * @returns True if the event has at least one handler
   *
   * @example
   * ```typescript
   * if (emitter.hasListeners('message')) {
   *   emitter.emit('message', { text: 'Hello' });
   * }
   * ```
   */
  hasListeners<K extends keyof Events>(event: K): boolean {
    return this.listenerCount(event) > 0;
  }
}
