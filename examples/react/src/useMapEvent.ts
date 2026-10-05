import { useEffect, useRef, type RefObject } from "react";
import type { MLMapEventMap } from "@maplibre-yaml/core/register";

/**
 * Listen for an `ml-map:*` event on any element: every `<ml-map>` event
 * bubbles, so a wrapper can observe the maps inside it. Works on React 18
 * and 19 (it is a plain addEventListener in an effect with a cleanup), and
 * the handler is typed from `MLMapEventMap`.
 */
export function useMapEvent<K extends keyof MLMapEventMap>(
  target: RefObject<HTMLElement | null>,
  type: K,
  handler: (event: MLMapEventMap[K]) => void
): void {
  // Latest handler without re-subscribing on every render.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const listener = (event: Event) => latest.current(event as MLMapEventMap[K]);
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [target, type]);
}
