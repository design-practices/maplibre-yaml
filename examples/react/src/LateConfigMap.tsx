import "@maplibre-yaml/core/register";
import type { MLMap } from "@maplibre-yaml/core/register";
import { useEffect, useRef } from "react";
import { ROUTE_COLORS, routesDocument } from "./maps";

/**
 * The pattern that used to flash "No configuration provided" (ml-mpm): an
 * EMPTY <ml-map> whose config is assigned from an effect, after the element
 * connected. React 18 can only do it this way (refs and effects run after
 * insertion). Since 0.7 the element waits a task before reporting a missing
 * config, so this renders cleanly, and a mapReady() made first just waits.
 */
export function LateConfigMap({ onReady }: { onReady: (center: string) => void }) {
  const ref = useRef<MLMap>(null);

  useEffect(() => {
    // Counted for the browser suite: 2 per mount in a development build
    // (StrictMode re-runs effects), 1 in production.
    window.__lateConfigEffectRuns = (window.__lateConfigEffectRuns ?? 0) + 1;
    const el = ref.current!;
    let cancelled = false;
    // Asked for BEFORE the config exists: it must wait, not reject.
    el.mapReady().then(
      (map) => {
        if (!cancelled) onReady(map.getCenter().toArray().map((n) => n.toFixed(1)).join(", "));
      },
      () => {}
    );
    el.config = routesDocument(ROUTE_COLORS[1]);
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  return <ml-map ref={ref} id="late-config" style={{ display: "block", height: "260px" }} />;
}
