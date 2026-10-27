import { useEffect, useRef, type RefObject } from "react";
import type { MLMapEventMap } from "@maplibre-yaml/core/register";

// Listen for an ml-map:* event on the element in `ref` (or on an element
// around maps: the events bubble). Works on React 18 and 19.
export function useMapEvent<K extends keyof MLMapEventMap>(
  ref: RefObject<HTMLElement | null>,
  type: K,
  handler: (event: MLMapEventMap[K]) => void
) {
  // Call the newest handler without re-subscribing on every render.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (event: Event) => latest.current(event as MLMapEventMap[K]);
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [ref, type]);
}
