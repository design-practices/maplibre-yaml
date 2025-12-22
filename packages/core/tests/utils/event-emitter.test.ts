import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "../../src/utils/event-emitter";

interface TestEvents {
  [key: string]: unknown;
  connect: void;
  message: { text: string; priority: number };
  error: { error: Error };
  data: { value: number };
}

class TestEmitter extends EventEmitter<TestEvents> {
  triggerConnect() {
    this.emit("connect", undefined);
  }

  triggerMessage(text: string, priority: number) {
    this.emit("message", { text, priority });
  }

  triggerError(error: Error) {
    this.emit("error", { error });
  }

  triggerData(value: number) {
    this.emit("data", { value });
  }
}

describe("EventEmitter", () => {
  let emitter: TestEmitter;

  beforeEach(() => {
    emitter = new TestEmitter();
  });

  describe("on()", () => {
    it("registers and calls event handler", () => {
      const handler = vi.fn();
      emitter.on("connect", handler);
      emitter.triggerConnect();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it("registers handler with typed payload", () => {
      const handler = vi.fn();
      emitter.on("message", handler);
      emitter.triggerMessage("test", 1);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ text: "test", priority: 1 });
    });

    it("calls multiple handlers in order", () => {
      const calls: string[] = [];
      emitter.on("connect", () => calls.push("first"));
      emitter.on("connect", () => calls.push("second"));
      emitter.on("connect", () => calls.push("third"));

      emitter.triggerConnect();

      expect(calls).toEqual(["first", "second", "third"]);
    });

    it("returns unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = emitter.on("connect", handler);

      emitter.triggerConnect();
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      emitter.triggerConnect();
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it("handles multiple different events", () => {
      const connectHandler = vi.fn();
      const messageHandler = vi.fn();
      const errorHandler = vi.fn();

      emitter.on("connect", connectHandler);
      emitter.on("message", messageHandler);
      emitter.on("error", errorHandler);

      emitter.triggerConnect();
      emitter.triggerMessage("test", 1);
      emitter.triggerError(new Error("test"));

      expect(connectHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("once()", () => {
    it("calls handler only once", () => {
      const handler = vi.fn();
      emitter.once("connect", handler);

      emitter.triggerConnect();
      emitter.triggerConnect();
      emitter.triggerConnect();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("receives event data", () => {
      const handler = vi.fn();
      emitter.once("message", handler);

      emitter.triggerMessage("hello", 5);

      expect(handler).toHaveBeenCalledWith({ text: "hello", priority: 5 });
    });

    it("removes handler after invocation", () => {
      const handler = vi.fn();
      emitter.once("data", handler);

      expect(emitter.listenerCount("data")).toBe(1);
      emitter.triggerData(42);
      expect(emitter.listenerCount("data")).toBe(0);
    });
  });

  describe("off()", () => {
    it("removes specific handler", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on("connect", handler1);
      emitter.on("connect", handler2);

      emitter.off("connect", handler1);
      emitter.triggerConnect();

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("does nothing if handler not registered", () => {
      const handler = vi.fn();
      emitter.off("connect", handler); // Should not throw
      emitter.triggerConnect();
      expect(handler).not.toHaveBeenCalled();
    });

    it("cleans up event when last handler removed", () => {
      const handler = vi.fn();
      emitter.on("connect", handler);
      expect(emitter.hasListeners("connect")).toBe(true);

      emitter.off("connect", handler);
      expect(emitter.hasListeners("connect")).toBe(false);
    });
  });

  describe("removeAllListeners()", () => {
    it("removes all handlers for specific event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on("connect", handler1);
      emitter.on("connect", handler2);
      emitter.removeAllListeners("connect");

      emitter.triggerConnect();

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it("removes all handlers for all events", () => {
      const connectHandler = vi.fn();
      const messageHandler = vi.fn();

      emitter.on("connect", connectHandler);
      emitter.on("message", messageHandler);
      emitter.removeAllListeners();

      emitter.triggerConnect();
      emitter.triggerMessage("test", 1);

      expect(connectHandler).not.toHaveBeenCalled();
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it("does not affect other events when removing specific event", () => {
      const connectHandler = vi.fn();
      const messageHandler = vi.fn();

      emitter.on("connect", connectHandler);
      emitter.on("message", messageHandler);
      emitter.removeAllListeners("connect");

      emitter.triggerConnect();
      emitter.triggerMessage("test", 1);

      expect(connectHandler).not.toHaveBeenCalled();
      expect(messageHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("listenerCount()", () => {
    it("returns 0 for event with no handlers", () => {
      expect(emitter.listenerCount("connect")).toBe(0);
    });

    it("returns correct count for event with handlers", () => {
      emitter.on("connect", () => {});
      expect(emitter.listenerCount("connect")).toBe(1);

      emitter.on("connect", () => {});
      expect(emitter.listenerCount("connect")).toBe(2);

      emitter.on("connect", () => {});
      expect(emitter.listenerCount("connect")).toBe(3);
    });

    it("updates count after removing handlers", () => {
      const handler1 = () => {};
      const handler2 = () => {};

      emitter.on("connect", handler1);
      emitter.on("connect", handler2);
      expect(emitter.listenerCount("connect")).toBe(2);

      emitter.off("connect", handler1);
      expect(emitter.listenerCount("connect")).toBe(1);

      emitter.off("connect", handler2);
      expect(emitter.listenerCount("connect")).toBe(0);
    });
  });

  describe("eventNames()", () => {
    it("returns empty array when no handlers registered", () => {
      expect(emitter.eventNames()).toEqual([]);
    });

    it("returns array of event names with handlers", () => {
      emitter.on("connect", () => {});
      emitter.on("message", () => {});
      emitter.on("error", () => {});

      const names = emitter.eventNames();
      expect(names).toHaveLength(3);
      expect(names).toContain("connect");
      expect(names).toContain("message");
      expect(names).toContain("error");
    });

    it("does not include events after handlers removed", () => {
      const handler = () => {};
      emitter.on("connect", handler);
      expect(emitter.eventNames()).toContain("connect");

      emitter.off("connect", handler);
      expect(emitter.eventNames()).not.toContain("connect");
    });
  });

  describe("hasListeners()", () => {
    it("returns false for event with no handlers", () => {
      expect(emitter.hasListeners("connect")).toBe(false);
    });

    it("returns true for event with handlers", () => {
      emitter.on("connect", () => {});
      expect(emitter.hasListeners("connect")).toBe(true);
    });

    it("returns false after all handlers removed", () => {
      const handler = () => {};
      emitter.on("connect", handler);
      expect(emitter.hasListeners("connect")).toBe(true);

      emitter.off("connect", handler);
      expect(emitter.hasListeners("connect")).toBe(false);
    });
  });

  describe("emit()", () => {
    it("does nothing if no handlers registered", () => {
      // Should not throw
      emitter.triggerConnect();
      emitter.triggerMessage("test", 1);
    });

    it("passes correct data to handlers", () => {
      const handler = vi.fn();
      emitter.on("message", handler);

      emitter.triggerMessage("hello", 10);

      expect(handler).toHaveBeenCalledWith({
        text: "hello",
        priority: 10,
      });
    });

    it("calls handlers synchronously", () => {
      const calls: string[] = [];

      emitter.on("connect", () => calls.push("handler"));

      calls.push("before");
      emitter.triggerConnect();
      calls.push("after");

      expect(calls).toEqual(["before", "handler", "after"]);
    });
  });

  describe("edge cases", () => {
    it("handles same handler registered multiple times", () => {
      const handler = vi.fn();

      emitter.on("connect", handler);
      emitter.on("connect", handler);

      emitter.triggerConnect();

      // Set only stores unique handlers
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("handles handler that throws error", () => {
      const throwingHandler = () => {
        throw new Error("Handler error");
      };
      const normalHandler = vi.fn();

      emitter.on("connect", throwingHandler);
      emitter.on("connect", normalHandler);

      expect(() => emitter.triggerConnect()).toThrow("Handler error");
      // Note: Second handler won't be called due to throw
    });

    it("handles handler removing itself during invocation", () => {
      let handler: any;
      handler = vi.fn(() => {
        emitter.off("connect", handler);
      });

      emitter.on("connect", handler);
      expect(emitter.listenerCount("connect")).toBe(1);

      emitter.triggerConnect();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(emitter.listenerCount("connect")).toBe(0);

      emitter.triggerConnect();
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it("handles handler adding another handler during invocation", () => {
      const secondHandler = vi.fn();
      const firstHandler = vi.fn(() => {
        emitter.on("connect", secondHandler);
      });

      emitter.on("connect", firstHandler);
      emitter.triggerConnect();

      expect(firstHandler).toHaveBeenCalledTimes(1);
      expect(secondHandler).toHaveBeenCalledTimes(1); // Called in same emit

      emitter.triggerConnect();
      expect(firstHandler).toHaveBeenCalledTimes(2);
      expect(secondHandler).toHaveBeenCalledTimes(2); // Called again
    });
  });
});
