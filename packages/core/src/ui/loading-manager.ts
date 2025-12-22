import { EventEmitter } from "../utils/event-emitter";

/**
 * Configuration for the loading manager.
 */
export interface LoadingConfig {
  /** Whether to show loading UI overlays (default: false) */
  showUI: boolean;

  /** Custom messages for loading states */
  messages?: {
    loading?: string;
    error?: string;
    retry?: string;
  };

  /** Spinner style (default: 'circle') */
  spinnerStyle?: "circle" | "dots";

  /** Minimum time to display loading UI in milliseconds (default: 300) */
  minDisplayTime?: number;
}

/**
 * Events emitted by the loading manager.
 */
export interface LoadingEvents extends Record<string, unknown> {
  "loading:start": { layerId: string; message?: string };
  "loading:progress": { layerId: string; loaded: number; total?: number };
  "loading:complete": {
    layerId: string;
    duration: number;
    fromCache: boolean;
  };
  "loading:error": { layerId: string; error: Error; retrying: boolean };
  "loading:retry": { layerId: string; attempt: number; delay: number };
}

/**
 * State of a loading operation.
 */
export interface LoadingState {
  /** Whether currently loading */
  isLoading: boolean;

  /** When loading started (timestamp) */
  startTime: number | null;

  /** Custom loading message */
  message?: string;

  /** Current error if any */
  error?: Error;

  /** Current retry attempt number */
  retryAttempt?: number;
}

/**
 * Internal loading subscription with UI elements.
 */
interface LoadingSubscription {
  state: LoadingState;
  container: HTMLElement | null;
  overlay: HTMLElement | null;
  minDisplayTimer: number | null;
}

/**
 * Manages loading states and optional UI overlays.
 *
 * @remarks
 * Provides centralized loading state management with optional visual feedback.
 * Emits events for all loading state changes, allowing external UI integration.
 * Can optionally show built-in loading overlays with spinners and error messages.
 *
 * Features:
 * - Event-driven state changes
 * - Optional loading UI overlays
 * - Customizable messages and spinner styles
 * - Minimum display time to prevent flashing
 * - Retry support with visual feedback
 * - Multiple concurrent loading operations
 *
 * @example
 * ```typescript
 * const manager = new LoadingManager({
 *   showUI: true,
 *   minDisplayTime: 300
 * });
 *
 * // Listen to loading events
 * manager.on('loading:start', ({ layerId }) => {
 *   console.log(`Loading ${layerId}...`);
 * });
 *
 * // Show loading state
 * const container = document.getElementById('map-container');
 * manager.showLoading('vehicles', container, 'Loading vehicle data...');
 *
 * // Hide when complete
 * manager.hideLoading('vehicles', { fromCache: false });
 *
 * // Show error with retry
 * manager.showError('vehicles', container, new Error('Failed'), () => {
 *   // Retry logic
 * });
 * ```
 */
export class LoadingManager extends EventEmitter<LoadingEvents> {
  private config: Required<LoadingConfig>;
  private subscriptions = new Map<string, LoadingSubscription>();

  private static readonly DEFAULT_CONFIG: Required<LoadingConfig> = {
    showUI: false,
    messages: {
      loading: "Loading...",
      error: "Failed to load data",
      retry: "Retrying...",
    },
    spinnerStyle: "circle",
    minDisplayTime: 300,
  };

  /**
   * Create a new LoadingManager.
   *
   * @param config - Loading manager configuration
   *
   * @example
   * ```typescript
   * const manager = new LoadingManager({
   *   showUI: true,
   *   messages: {
   *     loading: 'Fetching data...',
   *     error: 'Could not load data'
   *   },
   *   spinnerStyle: 'dots',
   *   minDisplayTime: 500
   * });
   * ```
   */
  constructor(config?: Partial<LoadingConfig>) {
    super();

    this.config = {
      ...LoadingManager.DEFAULT_CONFIG,
      ...config,
      messages: {
        ...LoadingManager.DEFAULT_CONFIG.messages,
        ...config?.messages,
      },
    };
  }

  /**
   * Show loading state for a layer.
   *
   * @param layerId - Layer identifier
   * @param container - Container element for UI overlay
   * @param message - Custom loading message
   *
   * @example
   * ```typescript
   * const container = document.getElementById('map');
   * manager.showLoading('earthquakes', container, 'Loading earthquake data...');
   * ```
   */
  showLoading(layerId: string, container: HTMLElement, message?: string): void {
    const existingSub = this.subscriptions.get(layerId);
    if (existingSub?.state.isLoading) {
      return; // Already loading
    }

    const state: LoadingState = {
      isLoading: true,
      startTime: Date.now(),
      message: message || this.config.messages.loading,
    };

    let overlay: HTMLElement | null = null;
    if (this.config.showUI) {
      overlay = this.createLoadingOverlay(
        state.message || this.config.messages.loading || "Loading..."
      );
      container.style.position = "relative";
      container.appendChild(overlay);
    }

    this.subscriptions.set(layerId, {
      state,
      container,
      overlay,
      minDisplayTimer: null,
    });

    this.emit("loading:start", { layerId, message: state.message });
  }

  /**
   * Hide loading state for a layer.
   *
   * @param layerId - Layer identifier
   * @param result - Optional result information
   *
   * @example
   * ```typescript
   * manager.hideLoading('earthquakes', { fromCache: true });
   * ```
   */
  hideLoading(layerId: string, result?: { fromCache: boolean }): void {
    const subscription = this.subscriptions.get(layerId);
    if (!subscription?.state.isLoading) {
      return;
    }

    const duration = Date.now() - (subscription.state.startTime || Date.now());
    const timeRemaining = Math.max(0, this.config.minDisplayTime - duration);

    const cleanup = () => {
      if (subscription.overlay) {
        subscription.overlay.remove();
      }
      subscription.state.isLoading = false;
      subscription.state.startTime = null;
      subscription.state.error = undefined;
      subscription.state.retryAttempt = undefined;

      this.emit("loading:complete", {
        layerId,
        duration,
        fromCache: result?.fromCache ?? false,
      });
    };

    if (timeRemaining > 0 && subscription.overlay) {
      // Wait for minimum display time
      subscription.minDisplayTimer = window.setTimeout(cleanup, timeRemaining);
    } else {
      cleanup();
    }
  }

  /**
   * Show error state for a layer.
   *
   * @param layerId - Layer identifier
   * @param container - Container element for UI overlay
   * @param error - Error that occurred
   * @param onRetry - Optional retry callback
   *
   * @example
   * ```typescript
   * manager.showError('earthquakes', container, error, () => {
   *   // Retry loading
   *   fetchData();
   * });
   * ```
   */
  showError(
    layerId: string,
    container: HTMLElement,
    error: Error,
    onRetry?: () => void
  ): void {
    const subscription = this.subscriptions.get(layerId);
    const state: LoadingState = subscription?.state || {
      isLoading: false,
      startTime: null,
    };

    state.error = error;
    state.isLoading = false;

    // Remove loading overlay if present
    if (subscription?.overlay) {
      subscription.overlay.remove();
    }

    let overlay: HTMLElement | null = null;
    if (this.config.showUI) {
      overlay = this.createErrorOverlay(
        error.message || this.config.messages.error || "An error occurred",
        onRetry
      );
      container.style.position = "relative";
      container.appendChild(overlay);
    }

    this.subscriptions.set(layerId, {
      state,
      container,
      overlay,
      minDisplayTimer: null,
    });

    this.emit("loading:error", {
      layerId,
      error,
      retrying: !!onRetry,
    });
  }

  /**
   * Show retrying state for a layer.
   *
   * @param layerId - Layer identifier
   * @param attempt - Current retry attempt number
   * @param delay - Delay before retry in milliseconds
   *
   * @example
   * ```typescript
   * manager.showRetrying('earthquakes', 2, 2000);
   * ```
   */
  showRetrying(layerId: string, attempt: number, delay: number): void {
    const subscription = this.subscriptions.get(layerId);
    if (subscription) {
      subscription.state.retryAttempt = attempt;

      if (subscription.overlay && this.config.showUI) {
        const message = `${this.config.messages.retry} (attempt ${attempt})`;
        const newOverlay = this.createLoadingOverlay(message);
        subscription.overlay.replaceWith(newOverlay);
        subscription.overlay = newOverlay;
      }
    }

    this.emit("loading:retry", { layerId, attempt, delay });
  }

  /**
   * Get loading state for a layer.
   *
   * @param layerId - Layer identifier
   * @returns Loading state or null if not found
   *
   * @example
   * ```typescript
   * const state = manager.getState('earthquakes');
   * if (state?.isLoading) {
   *   console.log('Still loading...');
   * }
   * ```
   */
  getState(layerId: string): LoadingState | null {
    const subscription = this.subscriptions.get(layerId);
    return subscription ? { ...subscription.state } : null;
  }

  /**
   * Check if a layer is currently loading.
   *
   * @param layerId - Layer identifier
   * @returns True if loading, false otherwise
   *
   * @example
   * ```typescript
   * if (manager.isLoading('earthquakes')) {
   *   console.log('Loading in progress');
   * }
   * ```
   */
  isLoading(layerId: string): boolean {
    return this.subscriptions.get(layerId)?.state.isLoading ?? false;
  }

  /**
   * Clear all loading states and UI.
   *
   * @example
   * ```typescript
   * manager.clearAll();
   * ```
   */
  clearAll(): void {
    for (const [layerId, subscription] of this.subscriptions.entries()) {
      if (subscription.minDisplayTimer) {
        clearTimeout(subscription.minDisplayTimer);
      }
      if (subscription.overlay) {
        subscription.overlay.remove();
      }
      this.subscriptions.delete(layerId);
    }
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
    this.clearAll();
    this.removeAllListeners();
  }

  /**
   * Create loading overlay element.
   */
  private createLoadingOverlay(message: string): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "mly-loading-overlay";

    const content = document.createElement("div");
    content.className = "mly-loading-content";

    const spinner = document.createElement("div");
    spinner.className = `mly-spinner mly-spinner--${this.config.spinnerStyle}`;

    const text = document.createElement("div");
    text.className = "mly-loading-text";
    text.textContent = message;

    content.appendChild(spinner);
    content.appendChild(text);
    overlay.appendChild(content);

    return overlay;
  }

  /**
   * Create error overlay element.
   */
  private createErrorOverlay(
    message: string,
    onRetry?: () => void
  ): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "mly-loading-overlay mly-loading-overlay--error";

    const content = document.createElement("div");
    content.className = "mly-error-content";

    const icon = document.createElement("div");
    icon.className = "mly-error-icon";
    icon.textContent = "⚠";

    const text = document.createElement("div");
    text.className = "mly-error-text";
    text.textContent = message;

    content.appendChild(icon);
    content.appendChild(text);

    if (onRetry) {
      const button = document.createElement("button");
      button.className = "mly-retry-button";
      button.textContent = "Retry";
      button.onclick = () => {
        overlay.remove();
        onRetry();
      };
      content.appendChild(button);
    }

    overlay.appendChild(content);

    return overlay;
  }
}
