import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RetryManager,
  MaxRetriesExceededError,
} from "../../src/data/retry-manager";

describe("RetryManager", () => {
  let retry: RetryManager;

  beforeEach(() => {
    retry = new RetryManager({
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 1000,
      backoffFactor: 2,
      jitter: false, // Disable jitter for predictable tests
    });
  });

  describe("execute()", () => {
    it("returns result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const result = await retry.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on failure and eventually succeeds", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"))
        .mockResolvedValue("success");

      const result = await retry.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws MaxRetriesExceededError when all attempts fail", async () => {
      const error = new Error("Always fails");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retry.execute(fn)).rejects.toThrow(MaxRetriesExceededError);

      // maxRetries: 3 means 4 total attempts (initial + 3 retries)
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it("includes lastError in MaxRetriesExceededError", async () => {
      const lastError = new Error("Final failure");
      const fn = vi.fn().mockRejectedValue(lastError);

      try {
        await retry.execute(fn);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxRetriesExceededError);
        if (error instanceof MaxRetriesExceededError) {
          expect(error.lastError).toBe(lastError);
          expect(error.attempts).toBe(4);
        }
      }
    });

    it("calls onRetry callback before each retry", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"))
        .mockResolvedValue("success");

      const onRetry = vi.fn();

      await retry.execute(fn, { onRetry });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Number),
        expect.any(Error)
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Number),
        expect.any(Error)
      );
    });

    it("calls onSuccess callback on success", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail"))
        .mockResolvedValue("success");

      const onSuccess = vi.fn();

      await retry.execute(fn, { onSuccess });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(2); // Success on 2nd attempt
    });

    it("calls onExhausted callback when retries exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("Always fails"));
      const onExhausted = vi.fn();

      await expect(retry.execute(fn, { onExhausted })).rejects.toThrow(
        MaxRetriesExceededError
      );

      expect(onExhausted).toHaveBeenCalledTimes(1);
      expect(onExhausted).toHaveBeenCalledWith(4, expect.any(Error));
    });

    it("does not retry non-retryable errors", async () => {
      const error = new Error("Non-retryable");
      const fn = vi.fn().mockRejectedValue(error);

      const isRetryable = vi.fn().mockReturnValue(false);

      await expect(retry.execute(fn, { isRetryable })).rejects.toThrow(error);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(isRetryable).toHaveBeenCalledWith(error);
    });

    it("retries only retryable errors", async () => {
      const retryableError = new Error("Network error");
      const nonRetryableError = new Error("Bad request");

      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(nonRetryableError);

      const isRetryable = vi.fn((error: Error) => {
        return error.message.includes("Network");
      });

      await expect(retry.execute(fn, { isRetryable })).rejects.toThrow(
        nonRetryableError
      );

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("waits before retrying", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail"))
        .mockResolvedValue("success");

      const start = Date.now();
      await retry.execute(fn);
      const duration = Date.now() - start;

      // Should wait at least initialDelay (100ms)
      expect(duration).toBeGreaterThanOrEqual(100);
    });
  });

  describe("calculateDelay()", () => {
    it("calculates exponential backoff correctly", () => {
      const retry = new RetryManager({
        initialDelay: 1000,
        backoffFactor: 2,
        jitter: false,
      });

      expect(retry.calculateDelay(1)).toBe(1000); // 1000 * 2^0
      expect(retry.calculateDelay(2)).toBe(2000); // 1000 * 2^1
      expect(retry.calculateDelay(3)).toBe(4000); // 1000 * 2^2
      expect(retry.calculateDelay(4)).toBe(8000); // 1000 * 2^3
    });

    it("respects maxDelay cap", () => {
      const retry = new RetryManager({
        initialDelay: 1000,
        backoffFactor: 2,
        maxDelay: 5000,
        jitter: false,
      });

      expect(retry.calculateDelay(1)).toBe(1000);
      expect(retry.calculateDelay(2)).toBe(2000);
      expect(retry.calculateDelay(3)).toBe(4000);
      expect(retry.calculateDelay(4)).toBe(5000); // Capped
      expect(retry.calculateDelay(5)).toBe(5000); // Capped
    });

    it("applies jitter within expected range", () => {
      const retry = new RetryManager({
        initialDelay: 1000,
        backoffFactor: 2,
        jitter: true,
        jitterFactor: 0.25,
      });

      // Run multiple times to check jitter variance
      const delays: number[] = [];
      for (let i = 0; i < 20; i++) {
        delays.push(retry.calculateDelay(1));
      }

      // Base delay is 1000, jitter factor is 0.25
      // So range should be 750-1250
      const min = Math.min(...delays);
      const max = Math.max(...delays);

      expect(min).toBeGreaterThanOrEqual(750);
      expect(max).toBeLessThanOrEqual(1250);

      // Check that we got some variance (not all the same)
      const unique = new Set(delays);
      expect(unique.size).toBeGreaterThan(1);
    });

    it("returns integer values", () => {
      const retry = new RetryManager({
        initialDelay: 333,
        backoffFactor: 1.5,
        jitter: true,
      });

      for (let i = 1; i <= 5; i++) {
        const delay = retry.calculateDelay(i);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });

    it("returns non-negative values", () => {
      const retry = new RetryManager({
        initialDelay: 10,
        backoffFactor: 1,
        jitter: true,
        jitterFactor: 1.5, // Large jitter that could go negative
      });

      for (let i = 1; i <= 10; i++) {
        const delay = retry.calculateDelay(i);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("configuration", () => {
    it("uses default config when none provided", () => {
      const defaultRetry = new RetryManager();
      // Should not throw
      expect(defaultRetry.calculateDelay(1)).toBeGreaterThan(0);
    });

    it("merges partial config with defaults", () => {
      const customRetry = new RetryManager({
        maxRetries: 5,
        // Other values should use defaults
      });

      const delay = customRetry.calculateDelay(1);
      expect(delay).toBeGreaterThan(0);
    });

    it("respects custom maxRetries", async () => {
      const customRetry = new RetryManager({
        maxRetries: 2,
        initialDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error("Fail"));

      await expect(customRetry.execute(fn)).rejects.toThrow(
        MaxRetriesExceededError
      );

      // maxRetries: 2 means 3 total attempts
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("reset()", () => {
    it("can be called without error", () => {
      expect(() => retry.reset()).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles functions that throw non-Error values", async () => {
      const fn = vi.fn().mockRejectedValue("string error");

      await expect(retry.execute(fn)).rejects.toThrow(MaxRetriesExceededError);
    });

    it("handles zero maxRetries", async () => {
      const zeroRetry = new RetryManager({
        maxRetries: 0,
        initialDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error("Fail"));

      await expect(zeroRetry.execute(fn)).rejects.toThrow(
        MaxRetriesExceededError
      );

      // Only initial attempt, no retries
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("handles immediate success after failures", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockResolvedValue("success");

      const result = await retry.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("preserves original error message in MaxRetriesExceededError", async () => {
      const originalError = new Error("Original message");
      const fn = vi.fn().mockRejectedValue(originalError);

      try {
        await retry.execute(fn);
        expect.fail("Should have thrown");
      } catch (error) {
        if (error instanceof MaxRetriesExceededError) {
          expect(error.message).toContain("Original message");
          expect(error.lastError.message).toBe("Original message");
        }
      }
    });
  });

  describe("MaxRetriesExceededError", () => {
    it("is an instance of Error", () => {
      const error = new MaxRetriesExceededError(new Error("Test"), 5);
      expect(error).toBeInstanceOf(Error);
    });

    it("has correct name", () => {
      const error = new MaxRetriesExceededError(new Error("Test"), 5);
      expect(error.name).toBe("MaxRetriesExceededError");
    });

    it("stores lastError and attempts", () => {
      const lastError = new Error("Last error");
      const error = new MaxRetriesExceededError(lastError, 10);

      expect(error.lastError).toBe(lastError);
      expect(error.attempts).toBe(10);
    });

    it("has descriptive message", () => {
      const lastError = new Error("Connection failed");
      const error = new MaxRetriesExceededError(lastError, 5);

      expect(error.message).toContain("5");
      expect(error.message).toContain("Connection failed");
    });
  });
});
