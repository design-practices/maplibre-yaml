/**
 * @file Polling manager for periodic data refresh
 * @module @maplibre-yaml/core/data
 */

/**
 * Configuration for a polling subscription.
 *
 * @remarks
 * The polling manager ensures non-overlapping execution by waiting for each
 * tick to complete before scheduling the next one. This prevents concurrent
 * execution of the same polling task.
 *
 * @example
 * ```typescript
 * const polling = new PollingManager();
 *
 * polling.start('vehicles', {
 *   interval: 5000,
 *   onTick: async () => {
 *     const data = await fetch('/api/vehicles');
 *     updateMap(data);
 *   },
 *   onError: (error) => console.error(error),
 *   immediate: true,
 *   pauseWhenHidden: true,
 * });
 * ```
 */
export interface PollingConfig {
  /** Polling interval in milliseconds (minimum 1000ms) */
  interval: number;

  /** Function to execute on each tick */
  onTick: () => Promise<void>;

  /** Error handler for tick failures */
  onError?: (error: Error) => void;

  /** Execute immediately on start (default: false) */
  immediate?: boolean;

  /** Pause polling when document is hidden (default: true) */
  pauseWhenHidden?: boolean;
}

/**
 * Current state of a polling subscription.
 */
export interface PollingState {
  /** Whether polling is active */
  isActive: boolean;

  /** Whether polling is paused */
  isPaused: boolean;

  /** Timestamp of last successful tick */
  lastTick: number | null;

  /** Timestamp of next scheduled tick */
  nextTick: number | null;

  /** Total number of successful ticks */
  tickCount: number;

  /** Total number of errors */
  errorCount: number;
}

/**
 * Internal subscription data.
 */
interface Subscription {
  config: PollingConfig;
  state: PollingState;
  timerId: ReturnType<typeof setTimeout> | null;
  isExecuting: boolean;
  pausedByVisibility: boolean;
}

/**
 * Manages polling intervals for data refresh.
 *
 * @remarks
 * Features:
 * - Independent intervals per subscription
 * - Visibility-aware (pause when tab hidden)
 * - Tracks tick count and error count
 * - Non-overlapping execution (waits for tick to complete)
 * - Pause/resume functionality
 * - Manual trigger support
 *
 * The polling manager automatically pauses polling when the document becomes
 * hidden (unless `pauseWhenHidden` is false) and resumes when visible again.
 *
 * @example
 * ```typescript
 * const polling = new PollingManager();
 *
 * // Start polling
 * polling.start('data-refresh', {
 *   interval: 10000,
 *   onTick: async () => {
 *     await fetchAndUpdateData();
 *   },
 *   immediate: true,
 * });
 *
 * // Pause temporarily
 * polling.pause('data-refresh');
 *
 * // Resume
 * polling.resume('data-refresh');
 *
 * // Trigger immediately
 * await polling.triggerNow('data-refresh');
 *
 * // Stop completely
 * polling.stop('data-refresh');
 * ```
 */
export class PollingManager {
  private subscriptions = new Map<string, Subscription>();
  private visibilityListener: (() => void) | null = null;

  constructor() {
    this.setupVisibilityListener();
  }

  /**
   * Start a new polling subscription.
   *
   * @param id - Unique identifier for the subscription
   * @param config - Polling configuration
   * @throws Error if a subscription with the same ID already exists
   *
   * @example
   * ```typescript
   * polling.start('layer-1', {
   *   interval: 5000,
   *   onTick: async () => {
   *     await updateLayerData();
   *   },
   * });
   * ```
   */
  start(id: string, config: PollingConfig): void {
    if (this.subscriptions.has(id)) {
      throw new Error(`Polling subscription with id "${id}" already exists`);
    }

    const subscription: Subscription = {
      config,
      state: {
        isActive: true,
        isPaused: false,
        lastTick: null,
        nextTick: null,
        tickCount: 0,
        errorCount: 0,
      },
      timerId: null,
      isExecuting: false,
      pausedByVisibility: false,
    };

    this.subscriptions.set(id, subscription);

    // Execute immediately if requested
    if (config.immediate) {
      this.executeTick(id);
    } else {
      this.scheduleNextTick(id);
    }
  }

  /**
   * Stop a polling subscription and clean up resources.
   *
   * @param id - Subscription identifier
   *
   * @example
   * ```typescript
   * polling.stop('layer-1');
   * ```
   */
  stop(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;

    if (subscription.timerId !== null) {
      clearTimeout(subscription.timerId);
    }

    subscription.state.isActive = false;
    this.subscriptions.delete(id);
  }

  /**
   * Stop all polling subscriptions.
   *
   * @example
   * ```typescript
   * polling.stopAll();
   * ```
   */
  stopAll(): void {
    for (const id of this.subscriptions.keys()) {
      this.stop(id);
    }
  }

  /**
   * Pause a polling subscription without stopping it.
   *
   * @param id - Subscription identifier
   *
   * @remarks
   * Paused subscriptions can be resumed with {@link resume}.
   * The subscription maintains its state while paused.
   *
   * @example
   * ```typescript
   * polling.pause('layer-1');
   * ```
   */
  pause(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription || subscription.state.isPaused) return;

    if (subscription.timerId !== null) {
      clearTimeout(subscription.timerId);
      subscription.timerId = null;
    }

    subscription.state.isPaused = true;
    subscription.state.nextTick = null;
  }

  /**
   * Pause all active polling subscriptions.
   *
   * @example
   * ```typescript
   * polling.pauseAll();
   * ```
   */
  pauseAll(): void {
    for (const id of this.subscriptions.keys()) {
      this.pause(id);
    }
  }

  /**
   * Resume a paused polling subscription.
   *
   * @param id - Subscription identifier
   *
   * @example
   * ```typescript
   * polling.resume('layer-1');
   * ```
   */
  resume(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription || !subscription.state.isPaused) return;

    subscription.state.isPaused = false;
    subscription.pausedByVisibility = false;
    this.scheduleNextTick(id);
  }

  /**
   * Resume all paused polling subscriptions.
   *
   * @example
   * ```typescript
   * polling.resumeAll();
   * ```
   */
  resumeAll(): void {
    for (const id of this.subscriptions.keys()) {
      this.resume(id);
    }
  }

  /**
   * Trigger an immediate execution of the polling tick.
   *
   * @param id - Subscription identifier
   * @returns Promise that resolves when the tick completes
   * @throws Error if the subscription doesn't exist
   *
   * @remarks
   * This does not affect the regular polling schedule. The next scheduled
   * tick will still occur at the expected time.
   *
   * @example
   * ```typescript
   * await polling.triggerNow('layer-1');
   * ```
   */
  async triggerNow(id: string): Promise<void> {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      throw new Error(`Polling subscription "${id}" not found`);
    }

    await this.executeTick(id);
  }

  /**
   * Get the current state of a polling subscription.
   *
   * @param id - Subscription identifier
   * @returns Current state or null if not found
   *
   * @example
   * ```typescript
   * const state = polling.getState('layer-1');
   * if (state) {
   *   console.log(`Ticks: ${state.tickCount}, Errors: ${state.errorCount}`);
   * }
   * ```
   */
  getState(id: string): PollingState | null {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription.state } : null;
  }

  /**
   * Get all active polling subscription IDs.
   *
   * @returns Array of subscription IDs
   *
   * @example
   * ```typescript
   * const ids = polling.getActiveIds();
   * console.log(`Active pollers: ${ids.join(', ')}`);
   * ```
   */
  getActiveIds(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if a polling subscription exists.
   *
   * @param id - Subscription identifier
   * @returns True if the subscription exists
   *
   * @example
   * ```typescript
   * if (polling.has('layer-1')) {
   *   polling.pause('layer-1');
   * }
   * ```
   */
  has(id: string): boolean {
    return this.subscriptions.has(id);
  }

  /**
   * Update the interval for an active polling subscription.
   *
   * @param id - Subscription identifier
   * @param interval - New interval in milliseconds (minimum 1000ms)
   * @throws Error if the subscription doesn't exist
   *
   * @remarks
   * The new interval takes effect after the current tick completes.
   *
   * @example
   * ```typescript
   * polling.setInterval('layer-1', 10000);
   * ```
   */
  setInterval(id: string, interval: number): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      throw new Error(`Polling subscription "${id}" not found`);
    }

    if (interval < 1000) {
      throw new Error("Interval must be at least 1000ms");
    }

    subscription.config.interval = interval;

    // Reschedule if active and not paused
    if (
      !subscription.state.isPaused &&
      !subscription.isExecuting &&
      subscription.timerId !== null
    ) {
      clearTimeout(subscription.timerId);
      this.scheduleNextTick(id);
    }
  }

  /**
   * Clean up all resources and stop all polling.
   *
   * @remarks
   * Should be called when the polling manager is no longer needed.
   * After calling destroy, the polling manager should not be used.
   *
   * @example
   * ```typescript
   * polling.destroy();
   * ```
   */
  destroy(): void {
    this.stopAll();
    this.teardownVisibilityListener();
  }

  /**
   * Execute a single tick for a subscription.
   */
  private async executeTick(id: string): Promise<void> {
    const subscription = this.subscriptions.get(id);
    if (!subscription || subscription.isExecuting) return;

    subscription.isExecuting = true;

    try {
      await subscription.config.onTick();
      subscription.state.tickCount++;
      subscription.state.lastTick = Date.now();
    } catch (error) {
      subscription.state.errorCount++;
      const err = error instanceof Error ? error : new Error(String(error));
      subscription.config.onError?.(err);
    } finally {
      subscription.isExecuting = false;

      // Schedule next tick if still active and not paused
      if (
        this.subscriptions.has(id) &&
        subscription.state.isActive &&
        !subscription.state.isPaused
      ) {
        this.scheduleNextTick(id);
      }
    }
  }

  /**
   * Schedule the next tick for a subscription.
   */
  private scheduleNextTick(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;

    const nextTime = Date.now() + subscription.config.interval;
    subscription.state.nextTick = nextTime;

    subscription.timerId = setTimeout(() => {
      this.executeTick(id);
    }, subscription.config.interval);
  }

  /**
   * Setup document visibility listener for automatic pause/resume.
   */
  private setupVisibilityListener(): void {
    if (typeof document === "undefined") return;

    this.visibilityListener = () => {
      if (document.hidden) {
        this.handleVisibilityChange(true);
      } else {
        this.handleVisibilityChange(false);
      }
    };

    document.addEventListener("visibilitychange", this.visibilityListener);
  }

  /**
   * Handle document visibility changes.
   */
  private handleVisibilityChange(hidden: boolean): void {
    for (const [id, subscription] of this.subscriptions) {
      const pauseEnabled = subscription.config.pauseWhenHidden !== false;

      if (hidden && pauseEnabled && !subscription.state.isPaused) {
        // Pause due to visibility
        subscription.pausedByVisibility = true;
        this.pause(id);
      } else if (!hidden && pauseEnabled && subscription.pausedByVisibility) {
        // Resume from visibility pause
        this.resume(id);
      }
    }
  }

  /**
   * Remove document visibility listener.
   */
  private teardownVisibilityListener(): void {
    if (this.visibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
  }
}
