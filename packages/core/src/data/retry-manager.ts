/**
 * @file Exponential backoff retry manager
 * @module @maplibre-yaml/core/data
 */

/**
 * Configuration options for retry behavior
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts
   * @default 10
   */
  maxRetries: number;

  /**
   * Initial delay in milliseconds before first retry
   * @default 1000
   */
  initialDelay: number;

  /**
   * Maximum delay in milliseconds between retries
   * @default 30000
   */
  maxDelay: number;

  /**
   * Backoff multiplier for exponential backoff
   * @default 2
   */
  backoffFactor: number;

  /**
   * Whether to apply random jitter to delays
   * @default true
   */
  jitter: boolean;

  /**
   * Jitter factor (percentage of delay to randomize)
   * @default 0.25
   */
  jitterFactor: number;
}

/**
 * Callbacks for retry lifecycle events
 */
export interface RetryCallbacks {
  /**
   * Called before each retry attempt
   *
   * @param attempt - Current attempt number (1-indexed)
   * @param delay - Delay in milliseconds before this retry
   * @param error - Error that triggered the retry
   */
  onRetry?: (attempt: number, delay: number, error: Error) => void;

  /**
   * Called when all retry attempts are exhausted
   *
   * @param attempts - Total number of attempts made
   * @param lastError - The final error
   */
  onExhausted?: (attempts: number, lastError: Error) => void;

  /**
   * Called when operation succeeds
   *
   * @param attempts - Number of attempts before success (1 = first try)
   */
  onSuccess?: (attempts: number) => void;

  /**
   * Predicate to determine if an error is retryable
   *
   * @param error - Error to check
   * @returns True if the error should trigger a retry
   *
   * @default All errors are retryable
   */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Error thrown when maximum retry attempts are exceeded
 */
export class MaxRetriesExceededError extends Error {
  /**
   * Create a MaxRetriesExceededError
   *
   * @param lastError - The error from the final attempt
   * @param attempts - Number of attempts made
   */
  constructor(public lastError: Error, public attempts: number) {
    super(
      `Maximum retry attempts (${attempts}) exceeded. Last error: ${lastError.message}`
    );
    this.name = "MaxRetriesExceededError";

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, MaxRetriesExceededError.prototype);
  }
}

/**
 * Retry manager with exponential backoff and jitter.
 *
 * @remarks
 * Implements exponential backoff with the formula:
 * ```
 * delay = min(initialDelay * (backoffFactor ^ (attempt - 1)), maxDelay)
 * ```
 *
 * With jitter applied as:
 * ```
 * delay = delay + (random(-1, 1) * delay * jitterFactor)
 * ```
 *
 * Jitter helps prevent thundering herd problems when multiple clients
 * retry simultaneously.
 *
 * @example
 * ```typescript
 * const retry = new RetryManager({
 *   maxRetries: 5,
 *   initialDelay: 1000,
 *   backoffFactor: 2,
 * });
 *
 * try {
 *   const result = await retry.execute(
 *     async () => {
 *       const response = await fetch('https://api.example.com/data');
 *       if (!response.ok) throw new Error('Request failed');
 *       return response.json();
 *     },
 *     {
 *       onRetry: (attempt, delay, error) => {
 *         console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`);
 *       },
 *     }
 *   );
 *   console.log('Success:', result);
 * } catch (error) {
 *   console.error('All retries failed:', error);
 * }
 * ```
 */
export class RetryManager {
  private static readonly DEFAULT_CONFIG: RetryConfig = {
    maxRetries: 10,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true,
    jitterFactor: 0.25,
  };

  private config: RetryConfig;

  /**
   * Create a new RetryManager instance
   *
   * @param config - Retry configuration options
   */
  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...RetryManager.DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with retry logic
   *
   * @typeParam T - Return type of the function
   * @param fn - Async function to execute with retries
   * @param callbacks - Optional lifecycle callbacks
   * @returns Promise that resolves with the function's result
   * @throws {MaxRetriesExceededError} When all retry attempts fail
   *
   * @example
   * ```typescript
   * const data = await retry.execute(
   *   () => fetchData(url),
   *   {
   *     isRetryable: (error) => {
   *       // Don't retry 4xx errors except 429 (rate limit)
   *       if (error.message.includes('429')) return true;
   *       if (error.message.match(/4\d\d/)) return false;
   *       return true;
   *     },
   *   }
   * );
   * ```
   */
  async execute<T>(
    fn: () => Promise<T>,
    callbacks?: RetryCallbacks
  ): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      attempt++;

      try {
        const result = await fn();
        callbacks?.onSuccess?.(attempt);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (callbacks?.isRetryable && !callbacks.isRetryable(lastError)) {
          throw lastError;
        }

        // If we've exhausted retries, throw
        if (attempt > this.config.maxRetries) {
          callbacks?.onExhausted?.(attempt, lastError);
          throw new MaxRetriesExceededError(lastError, attempt);
        }

        // Calculate delay and wait before retry
        const delay = this.calculateDelay(attempt);
        callbacks?.onRetry?.(attempt, delay, lastError);

        await this.sleep(delay);
      }
    }

    // This should never be reached due to throw above, but TypeScript needs it
    throw new MaxRetriesExceededError(
      lastError || new Error("Unknown error"),
      attempt
    );
  }

  /**
   * Calculate delay for a given attempt using exponential backoff
   *
   * @param attempt - Current attempt number (1-indexed)
   * @returns Delay in milliseconds
   *
   * @example
   * ```typescript
   * const retry = new RetryManager({ initialDelay: 1000, backoffFactor: 2 });
   * console.log(retry.calculateDelay(1)); // ~1000ms
   * console.log(retry.calculateDelay(2)); // ~2000ms
   * console.log(retry.calculateDelay(3)); // ~4000ms
   * ```
   */
  calculateDelay(attempt: number): number {
    // Calculate base delay with exponential backoff
    let delay =
      this.config.initialDelay *
      Math.pow(this.config.backoffFactor, attempt - 1);

    // Cap at max delay
    delay = Math.min(delay, this.config.maxDelay);

    // Apply jitter if enabled
    if (this.config.jitter) {
      const jitterRange = delay * this.config.jitterFactor;
      // Random value between -jitterRange and +jitterRange
      const jitterOffset = (Math.random() * 2 - 1) * jitterRange;
      delay = delay + jitterOffset;
    }

    // Ensure non-negative and round to integer
    return Math.max(0, Math.round(delay));
  }

  /**
   * Reset internal state
   *
   * @remarks
   * Currently this class is stateless, but this method is provided
   * for API consistency and future extensibility.
   */
  reset(): void {
    // Currently stateless, but provided for API consistency
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
