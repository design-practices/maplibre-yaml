/**
 * @file Tests for PollingManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PollingManager } from "../../src/data/polling-manager";

describe("PollingManager", () => {
  let polling: PollingManager;

  beforeEach(() => {
    polling = new PollingManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    polling.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("start()", () => {
    it("starts polling at specified interval", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
      });

      expect(onTick).not.toHaveBeenCalled();

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(3);
    });

    it("executes immediately when immediate is true", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
        immediate: true,
      });

      // Wait a tick for immediate execution
      await Promise.resolve();
      expect(onTick).toHaveBeenCalledTimes(1);

      // Then continue at interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(2);
    });

    it("throws when starting duplicate subscription", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      expect(() => {
        polling.start("test", { interval: 1000, onTick });
      }).toThrow('Polling subscription with id "test" already exists');
    });

    it("tracks tick count", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      await vi.advanceTimersByTimeAsync(3000);

      const state = polling.getState("test");
      expect(state?.tickCount).toBe(3);
    });

    it("tracks error count", async () => {
      const error = new Error("Test error");
      const onTick = vi.fn().mockRejectedValue(error);
      const onError = vi.fn();

      polling.start("test", {
        interval: 1000,
        onTick,
        onError,
      });

      await vi.advanceTimersByTimeAsync(2000);

      const state = polling.getState("test");
      expect(state?.errorCount).toBe(2);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(error);
    });

    it("continues polling after errors", async () => {
      const onTick = vi
        .fn()
        .mockRejectedValueOnce(new Error("First error"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Third error"))
        .mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
      });

      await vi.advanceTimersByTimeAsync(4000);

      const state = polling.getState("test");
      expect(state?.tickCount).toBe(2); // 2 successful
      expect(state?.errorCount).toBe(2); // 2 errors
      expect(onTick).toHaveBeenCalledTimes(4);
    });

    it("does not overlap execution", async () => {
      let executing = false;
      const onTick = vi.fn().mockImplementation(async () => {
        expect(executing).toBe(false);
        executing = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        executing = false;
      });

      polling.start("test", { interval: 100, onTick });

      // Fast-forward multiple intervals
      await vi.advanceTimersByTimeAsync(1000);

      // Even though we advanced 10 intervals (1000ms / 100ms),
      // ticks should not overlap
      expect(onTick.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("stop()", () => {
    it("stops polling", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(2);

      polling.stop("test");

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(2); // No additional calls
    });

    it("removes subscription", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });
      expect(polling.has("test")).toBe(true);

      polling.stop("test");
      expect(polling.has("test")).toBe(false);
    });

    it("handles stopping non-existent subscription", () => {
      expect(() => polling.stop("nonexistent")).not.toThrow();
    });
  });

  describe("stopAll()", () => {
    it("stops all subscriptions", async () => {
      const onTick1 = vi.fn().mockResolvedValue(undefined);
      const onTick2 = vi.fn().mockResolvedValue(undefined);

      polling.start("test1", { interval: 1000, onTick: onTick1 });
      polling.start("test2", { interval: 1000, onTick: onTick2 });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick1).toHaveBeenCalledTimes(1);
      expect(onTick2).toHaveBeenCalledTimes(1);

      polling.stopAll();

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick1).toHaveBeenCalledTimes(1);
      expect(onTick2).toHaveBeenCalledTimes(1);
      expect(polling.getActiveIds()).toHaveLength(0);
    });
  });

  describe("pause() and resume()", () => {
    it("pauses polling", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      polling.pause("test");
      const state1 = polling.getState("test");
      expect(state1?.isPaused).toBe(true);

      await vi.advanceTimersByTimeAsync(3000);
      expect(onTick).toHaveBeenCalledTimes(1); // No additional calls
    });

    it("resumes polling", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      polling.pause("test");
      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(1);

      polling.resume("test");
      const state = polling.getState("test");
      expect(state?.isPaused).toBe(false);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(2);
    });

    it("handles pausing already paused subscription", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });
      polling.pause("test");

      expect(() => polling.pause("test")).not.toThrow();
      const state = polling.getState("test");
      expect(state?.isPaused).toBe(true);
    });

    it("handles resuming non-paused subscription", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      expect(() => polling.resume("test")).not.toThrow();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);
    });

    it("handles pausing/resuming non-existent subscription", () => {
      expect(() => polling.pause("nonexistent")).not.toThrow();
      expect(() => polling.resume("nonexistent")).not.toThrow();
    });
  });

  describe("pauseAll() and resumeAll()", () => {
    it("pauses all subscriptions", async () => {
      const onTick1 = vi.fn().mockResolvedValue(undefined);
      const onTick2 = vi.fn().mockResolvedValue(undefined);

      polling.start("test1", { interval: 1000, onTick: onTick1 });
      polling.start("test2", { interval: 1000, onTick: onTick2 });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick1).toHaveBeenCalledTimes(1);
      expect(onTick2).toHaveBeenCalledTimes(1);

      polling.pauseAll();

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick1).toHaveBeenCalledTimes(1);
      expect(onTick2).toHaveBeenCalledTimes(1);
    });

    it("resumes all subscriptions", async () => {
      const onTick1 = vi.fn().mockResolvedValue(undefined);
      const onTick2 = vi.fn().mockResolvedValue(undefined);

      polling.start("test1", { interval: 1000, onTick: onTick1 });
      polling.start("test2", { interval: 1000, onTick: onTick2 });

      polling.pauseAll();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick1).not.toHaveBeenCalled();
      expect(onTick2).not.toHaveBeenCalled();

      polling.resumeAll();

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick1).toHaveBeenCalledTimes(1);
      expect(onTick2).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggerNow()", () => {
    it("triggers immediate execution", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 10000, onTick });

      expect(onTick).not.toHaveBeenCalled();

      await polling.triggerNow("test");
      expect(onTick).toHaveBeenCalledTimes(1);

      // Verify tick count increased
      const state = polling.getState("test");
      expect(state?.tickCount).toBe(1);
    });

    it("throws for non-existent subscription", async () => {
      await expect(polling.triggerNow("nonexistent")).rejects.toThrow(
        'Polling subscription "nonexistent" not found'
      );
    });

    it("works with paused subscription", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });
      polling.pause("test");

      await polling.triggerNow("test");
      expect(onTick).toHaveBeenCalledTimes(1);

      // Should remain paused after trigger
      const state = polling.getState("test");
      expect(state?.isPaused).toBe(true);
    });
  });

  describe("getState()", () => {
    it("returns current state", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      let state = polling.getState("test");
      expect(state).toMatchObject({
        isActive: true,
        isPaused: false,
        tickCount: 0,
        errorCount: 0,
      });

      await vi.advanceTimersByTimeAsync(2000);

      state = polling.getState("test");
      expect(state?.tickCount).toBe(2);
      expect(state?.lastTick).toBeGreaterThan(0);
    });

    it("returns null for non-existent subscription", () => {
      const state = polling.getState("nonexistent");
      expect(state).toBeNull();
    });

    it("returns copy of state", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);
      polling.start("test", { interval: 1000, onTick });

      const state1 = polling.getState("test");
      const state2 = polling.getState("test");

      expect(state1).not.toBe(state2); // Different objects
      expect(state1).toEqual(state2); // Same values
    });
  });

  describe("getActiveIds()", () => {
    it("returns all active subscription IDs", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      expect(polling.getActiveIds()).toHaveLength(0);

      polling.start("test1", { interval: 1000, onTick });
      polling.start("test2", { interval: 1000, onTick });

      const ids = polling.getActiveIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("test1");
      expect(ids).toContain("test2");
    });

    it("excludes stopped subscriptions", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test1", { interval: 1000, onTick });
      polling.start("test2", { interval: 1000, onTick });

      polling.stop("test1");

      const ids = polling.getActiveIds();
      expect(ids).toHaveLength(1);
      expect(ids).toContain("test2");
      expect(ids).not.toContain("test1");
    });
  });

  describe("has()", () => {
    it("returns true for existing subscription", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      expect(polling.has("test")).toBe(true);
      expect(polling.has("nonexistent")).toBe(false);
    });
  });

  describe("setInterval()", () => {
    it("updates polling interval", async () => {
      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", { interval: 1000, onTick });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      polling.setInterval("test", 2000);

      // Should now tick every 2 seconds
      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(3);
    });

    it("throws for non-existent subscription", () => {
      expect(() => polling.setInterval("nonexistent", 2000)).toThrow(
        'Polling subscription "nonexistent" not found'
      );
    });

    it("throws for invalid interval", () => {
      const onTick = vi.fn().mockResolvedValue(undefined);
      polling.start("test", { interval: 1000, onTick });

      expect(() => polling.setInterval("test", 500)).toThrow(
        "Interval must be at least 1000ms"
      );
    });
  });

  describe("destroy()", () => {
    it("stops all polling and cleans up", async () => {
      const onTick1 = vi.fn().mockResolvedValue(undefined);
      const onTick2 = vi.fn().mockResolvedValue(undefined);

      polling.start("test1", { interval: 1000, onTick: onTick1 });
      polling.start("test2", { interval: 1000, onTick: onTick2 });

      polling.destroy();

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick1).not.toHaveBeenCalled();
      expect(onTick2).not.toHaveBeenCalled();
      expect(polling.getActiveIds()).toHaveLength(0);
    });
  });

  describe("pauseWhenHidden", () => {
    it("pauses when document becomes hidden", async () => {
      // Mock document.hidden
      Object.defineProperty(document, "hidden", {
        writable: true,
        value: false,
      });

      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
        pauseWhenHidden: true,
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      // Simulate tab becoming hidden
      Object.defineProperty(document, "hidden", { value: true });
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.advanceTimersByTimeAsync(2000);
      expect(onTick).toHaveBeenCalledTimes(1); // No additional calls

      const state = polling.getState("test");
      expect(state?.isPaused).toBe(true);
    });

    it("resumes when document becomes visible", async () => {
      Object.defineProperty(document, "hidden", {
        writable: true,
        value: true,
      });

      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
        pauseWhenHidden: true,
      });

      // Start paused because document is hidden
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).not.toHaveBeenCalled();

      // Simulate tab becoming visible
      Object.defineProperty(document, "hidden", { value: false });
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);
    });

    it("does not pause when pauseWhenHidden is false", async () => {
      Object.defineProperty(document, "hidden", {
        writable: true,
        value: false,
      });

      const onTick = vi.fn().mockResolvedValue(undefined);

      polling.start("test", {
        interval: 1000,
        onTick,
        pauseWhenHidden: false,
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(1);

      // Simulate tab becoming hidden
      Object.defineProperty(document, "hidden", { value: true });
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.advanceTimersByTimeAsync(1000);
      expect(onTick).toHaveBeenCalledTimes(2); // Still ticking

      const state = polling.getState("test");
      expect(state?.isPaused).toBe(false);
    });
  });
});
