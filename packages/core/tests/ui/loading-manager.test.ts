import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LoadingManager } from "../../src/ui/loading-manager";
import type { LoadingConfig } from "../../src/ui/loading-manager";

describe("LoadingManager", () => {
  let manager: LoadingManager;
  let container: HTMLElement;

  beforeEach(() => {
    manager = new LoadingManager();
    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = "";
  });

  describe("constructor", () => {
    it("creates a new LoadingManager with default config", () => {
      expect(manager).toBeInstanceOf(LoadingManager);
    });

    it("accepts custom configuration", () => {
      const config: LoadingConfig = {
        showUI: true,
        spinnerStyle: "dots",
        minDisplayTime: 500,
      };
      const customManager = new LoadingManager(config);
      expect(customManager).toBeInstanceOf(LoadingManager);
      customManager.destroy();
    });

    it("merges custom messages with defaults", () => {
      const customManager = new LoadingManager({
        messages: {
          loading: "Custom loading...",
        },
      });
      expect(customManager).toBeInstanceOf(LoadingManager);
      customManager.destroy();
    });
  });

  describe("showLoading", () => {
    it("sets loading state", () => {
      manager.showLoading("test-layer", container);

      const state = manager.getState("test-layer");
      expect(state?.isLoading).toBe(true);
      expect(state?.startTime).toBeGreaterThan(0);
    });

    it("emits loading:start event", () => {
      const onStart = vi.fn();
      manager.on("loading:start", onStart);

      manager.showLoading("test-layer", container, "Loading data...");

      expect(onStart).toHaveBeenCalledWith({
        layerId: "test-layer",
        message: "Loading data...",
      });
    });

    it("uses custom message", () => {
      const onStart = vi.fn();
      manager.on("loading:start", onStart);

      manager.showLoading("test-layer", container, "Custom message");

      const state = manager.getState("test-layer");
      expect(state?.message).toBe("Custom message");
    });

    it("does not show UI when showUI is false", () => {
      manager.showLoading("test-layer", container);

      const overlay = container.querySelector(".mly-loading-overlay");
      expect(overlay).toBeNull();
    });

    it("shows UI overlay when showUI is true", () => {
      const uiManager = new LoadingManager({ showUI: true });
      uiManager.showLoading("test-layer", container);

      const overlay = container.querySelector(".mly-loading-overlay");
      expect(overlay).not.toBeNull();

      uiManager.destroy();
    });

    it("ignores duplicate loading for same layer", () => {
      const onStart = vi.fn();
      manager.on("loading:start", onStart);

      manager.showLoading("test-layer", container);
      manager.showLoading("test-layer", container);

      expect(onStart).toHaveBeenCalledTimes(1);
    });
  });

  describe("hideLoading", () => {
    beforeEach(() => {
      manager.showLoading("test-layer", container);
    });

    it("clears loading state", async () => {
      manager.hideLoading("test-layer");

      // Wait for any timers
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = manager.getState("test-layer");
      expect(state?.isLoading).toBe(false);
      expect(state?.startTime).toBeNull();
    });

    it("emits loading:complete event", async () => {
      const onComplete = vi.fn();
      manager.on("loading:complete", onComplete);

      manager.hideLoading("test-layer", { fromCache: true });

      // Wait for any timers
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onComplete).toHaveBeenCalledWith({
        layerId: "test-layer",
        duration: expect.any(Number),
        fromCache: true,
      });
    });

    it("respects minimum display time", async () => {
      vi.useFakeTimers();
      const fastManager = new LoadingManager({
        showUI: true,
        minDisplayTime: 500,
      });

      fastManager.showLoading("test-layer", container);

      const onComplete = vi.fn();
      fastManager.on("loading:complete", onComplete);

      // Hide immediately
      fastManager.hideLoading("test-layer");

      // Should not complete yet
      expect(onComplete).not.toHaveBeenCalled();

      // Fast forward past min display time
      vi.advanceTimersByTime(500);

      expect(onComplete).toHaveBeenCalled();

      vi.useRealTimers();
      fastManager.destroy();
    });

    it("removes UI overlay", async () => {
      const uiManager = new LoadingManager({
        showUI: true,
        minDisplayTime: 0,
      });
      uiManager.showLoading("test-layer", container);

      expect(container.querySelector(".mly-loading-overlay")).not.toBeNull();

      uiManager.hideLoading("test-layer");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(container.querySelector(".mly-loading-overlay")).toBeNull();

      uiManager.destroy();
    });

    it("handles hiding non-existent loading", () => {
      expect(() => manager.hideLoading("non-existent")).not.toThrow();
    });
  });

  describe("showError", () => {
    it("sets error state", () => {
      const error = new Error("Test error");
      manager.showError("test-layer", container, error);

      const state = manager.getState("test-layer");
      expect(state?.error).toBe(error);
      expect(state?.isLoading).toBe(false);
    });

    it("emits loading:error event", () => {
      const onError = vi.fn();
      manager.on("loading:error", onError);

      const error = new Error("Test error");
      manager.showError("test-layer", container, error);

      expect(onError).toHaveBeenCalledWith({
        layerId: "test-layer",
        error,
        retrying: false,
      });
    });

    it("emits retrying flag when onRetry provided", () => {
      const onError = vi.fn();
      manager.on("loading:error", onError);

      const error = new Error("Test error");
      const onRetry = vi.fn();
      manager.showError("test-layer", container, error, onRetry);

      expect(onError).toHaveBeenCalledWith({
        layerId: "test-layer",
        error,
        retrying: true,
      });
    });

    it("shows error UI when showUI is true", () => {
      const uiManager = new LoadingManager({ showUI: true });
      const error = new Error("Test error");

      uiManager.showError("test-layer", container, error);

      const overlay = container.querySelector(".mly-loading-overlay--error");
      expect(overlay).not.toBeNull();

      uiManager.destroy();
    });

    it("shows retry button when onRetry provided", () => {
      const uiManager = new LoadingManager({ showUI: true });
      const error = new Error("Test error");
      const onRetry = vi.fn();

      uiManager.showError("test-layer", container, error, onRetry);

      const button = container.querySelector(".mly-retry-button");
      expect(button).not.toBeNull();

      uiManager.destroy();
    });

    it("calls onRetry when retry button clicked", () => {
      const uiManager = new LoadingManager({ showUI: true });
      const error = new Error("Test error");
      const onRetry = vi.fn();

      uiManager.showError("test-layer", container, error, onRetry);

      const button = container.querySelector(
        ".mly-retry-button"
      ) as HTMLButtonElement;
      button?.click();

      expect(onRetry).toHaveBeenCalled();

      uiManager.destroy();
    });
  });

  describe("showRetrying", () => {
    it("sets retry attempt in state", () => {
      manager.showLoading("test-layer", container);
      manager.showRetrying("test-layer", 2, 1000);

      const state = manager.getState("test-layer");
      expect(state?.retryAttempt).toBe(2);
    });

    it("emits loading:retry event", () => {
      const onRetry = vi.fn();
      manager.on("loading:retry", onRetry);

      manager.showRetrying("test-layer", 3, 2000);

      expect(onRetry).toHaveBeenCalledWith({
        layerId: "test-layer",
        attempt: 3,
        delay: 2000,
      });
    });

    it("updates overlay message when showUI is true", () => {
      const uiManager = new LoadingManager({ showUI: true });
      uiManager.showLoading("test-layer", container);

      const initialOverlay = container.querySelector(".mly-loading-overlay");
      expect(initialOverlay).not.toBeNull();

      uiManager.showRetrying("test-layer", 2, 1000);

      const text = container.querySelector(".mly-loading-text");
      expect(text?.textContent).toContain("attempt 2");

      uiManager.destroy();
    });
  });

  describe("getState", () => {
    it("returns state for active loading", () => {
      manager.showLoading("test-layer", container);

      const state = manager.getState("test-layer");
      expect(state).not.toBeNull();
      expect(state?.isLoading).toBe(true);
    });

    it("returns null for non-existent layer", () => {
      const state = manager.getState("non-existent");
      expect(state).toBeNull();
    });

    it("returns copy of state", () => {
      manager.showLoading("test-layer", container);

      const state1 = manager.getState("test-layer");
      const state2 = manager.getState("test-layer");

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("isLoading", () => {
    it("returns true when loading", () => {
      manager.showLoading("test-layer", container);
      expect(manager.isLoading("test-layer")).toBe(true);
    });

    it("returns false when not loading", async () => {
      manager.showLoading("test-layer", container);
      manager.hideLoading("test-layer");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.isLoading("test-layer")).toBe(false);
    });

    it("returns false for non-existent layer", () => {
      expect(manager.isLoading("non-existent")).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("clears all loading states", () => {
      manager.showLoading("layer-1", container);
      manager.showLoading("layer-2", container);

      manager.clearAll();

      expect(manager.getState("layer-1")).toBeNull();
      expect(manager.getState("layer-2")).toBeNull();
    });

    it("removes all UI overlays", () => {
      const uiManager = new LoadingManager({ showUI: true });
      const container1 = document.createElement("div");
      const container2 = document.createElement("div");
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      uiManager.showLoading("layer-1", container1);
      uiManager.showLoading("layer-2", container2);

      expect(container1.querySelector(".mly-loading-overlay")).not.toBeNull();
      expect(container2.querySelector(".mly-loading-overlay")).not.toBeNull();

      uiManager.clearAll();

      expect(container1.querySelector(".mly-loading-overlay")).toBeNull();
      expect(container2.querySelector(".mly-loading-overlay")).toBeNull();

      uiManager.destroy();
    });

    it("clears pending timers", () => {
      vi.useFakeTimers();
      const timerManager = new LoadingManager({ minDisplayTime: 1000 });

      timerManager.showLoading("test-layer", container);
      timerManager.hideLoading("test-layer");

      timerManager.clearAll();

      // Fast forward - should not cause any errors
      vi.advanceTimersByTime(1000);

      vi.useRealTimers();
      timerManager.destroy();
    });
  });

  describe("destroy", () => {
    it("clears all resources", () => {
      manager.showLoading("test-layer", container);
      manager.destroy();

      expect(manager.getState("test-layer")).toBeNull();
    });

    it("removes all event listeners", () => {
      const onStart = vi.fn();
      manager.on("loading:start", onStart);

      manager.destroy();
      manager.showLoading("test-layer", container);

      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe("UI rendering", () => {
    it("creates circle spinner by default", () => {
      const uiManager = new LoadingManager({ showUI: true });
      uiManager.showLoading("test-layer", container);

      const spinner = container.querySelector(".mly-spinner--circle");
      expect(spinner).not.toBeNull();

      uiManager.destroy();
    });

    it("creates dots spinner when configured", () => {
      const uiManager = new LoadingManager({
        showUI: true,
        spinnerStyle: "dots",
      });
      uiManager.showLoading("test-layer", container);

      const spinner = container.querySelector(".mly-spinner--dots");
      expect(spinner).not.toBeNull();

      uiManager.destroy();
    });

    it("displays loading message", () => {
      const uiManager = new LoadingManager({ showUI: true });
      uiManager.showLoading("test-layer", container, "Test message");

      const text = container.querySelector(".mly-loading-text");
      expect(text?.textContent).toBe("Test message");

      uiManager.destroy();
    });

    it("displays error message", () => {
      const uiManager = new LoadingManager({ showUI: true });
      const error = new Error("Test error message");

      uiManager.showError("test-layer", container, error);

      const text = container.querySelector(".mly-error-text");
      expect(text?.textContent).toBe("Test error message");

      uiManager.destroy();
    });

    it("sets container position to relative", () => {
      const uiManager = new LoadingManager({ showUI: true });
      uiManager.showLoading("test-layer", container);

      expect(container.style.position).toBe("relative");

      uiManager.destroy();
    });
  });

  describe("concurrent operations", () => {
    it("handles multiple layers simultaneously", () => {
      const container1 = document.createElement("div");
      const container2 = document.createElement("div");
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      manager.showLoading("layer-1", container1);
      manager.showLoading("layer-2", container2);

      expect(manager.isLoading("layer-1")).toBe(true);
      expect(manager.isLoading("layer-2")).toBe(true);
    });

    it("hides one layer without affecting others", async () => {
      const container1 = document.createElement("div");
      const container2 = document.createElement("div");
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      manager.showLoading("layer-1", container1);
      manager.showLoading("layer-2", container2);

      manager.hideLoading("layer-1");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.isLoading("layer-1")).toBe(false);
      expect(manager.isLoading("layer-2")).toBe(true);
    });
  });
});
