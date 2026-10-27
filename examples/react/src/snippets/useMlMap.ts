import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapBlock } from "@maplibre-yaml/core";
import type { MLMap, MLMapEventMap, UpdateResult } from "@maplibre-yaml/core/register";

// The map, the document it shows and its `state:` values as React state,
// plus `setState` and `update` bound to the element in `ref`. Works on
// React 18 and 19; StrictMode's extra mount leaves one set of listeners.
export function useMlMap(ref: RefObject<MLMap | null>) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [doc, setDoc] = useState<MapBlock | null>(null);
  const [state, setStateValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ml-map:load fires on the first render and after a basemap rebuild (a
    // new map object); ml-map:update-applied after an in-place update (the
    // same map, a new document).
    const sync = () => {
      setMap(el.getMap());
      setDoc(el.getDocument());
      setStateValues(el.getState());
    };
    const onState = (event: MLMapEventMap["ml-map:state-change"]) =>
      setStateValues(event.detail.values);
    el.addEventListener("ml-map:load", sync);
    el.addEventListener("ml-map:update-applied", sync);
    el.addEventListener("ml-map:state-change", onState);
    if (el.isLoaded()) sync(); // the map loaded before this effect ran
    return () => {
      el.removeEventListener("ml-map:load", sync);
      el.removeEventListener("ml-map:update-applied", sync);
      el.removeEventListener("ml-map:state-change", onState);
    };
  }, [ref]);

  // Declared `state:` keys only: an undeclared key throws.
  const setState = useCallback(
    (values: Record<string, unknown>) => ref.current?.setState(values),
    [ref]
  );
  // Resolves with the outcome: applied, rejected (map untouched), fallback
  // (a basemap change rebuilt the map) or superseded by a later update.
  const update = useCallback(
    (next: MapBlock): Promise<UpdateResult> =>
      ref.current?.update(next) ?? Promise.resolve({ outcome: "rejected" }),
    [ref]
  );

  return { map, document: doc, state, setState, update };
}
