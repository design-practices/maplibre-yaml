import "@maplibre-yaml/core/register";
import type { MLMap } from "@maplibre-yaml/core/register";
import { useEffect, useRef, useState } from "react";
import { useMapEvent } from "./useMapEvent";

export function EarthquakeMap() {
  const ref = useRef<MLMap>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useMapEvent(ref, "ml-map:layer-click", (event) =>
    setPlace(event.detail.feature.properties.place)
  );
  // A document that can't be fetched, parsed or validated reports `errors`
  // (and the map shows them); anything else reports one `error`.
  useMapEvent(ref, "ml-map:error", ({ detail }) =>
    setProblem(detail.error ? detail.error.message : detail.errors.map((e) => e.message).join("; "))
  );

  useEffect(() => {
    let live = true;
    let stop = () => {};
    ref.current!.mapReady().then(
      (map) => {
        if (!live) return;
        const onZoom = () => setZoom(map.getZoom());
        onZoom();
        map.on("zoomend", onZoom);
        stop = () => map.off("zoomend", onZoom);
      },
      () => {} // the document failed: ml-map:error has the details
    );
    return () => {
      live = false;
      stop();
    };
  }, []);

  return (
    <>
      <ml-map ref={ref} src="/map.yaml" style={{ display: "block", height: "400px" }} />
      <p>
        Zoom {zoom?.toFixed(1) ?? "…"} · clicked: {place ?? "nothing yet"}
      </p>
      {problem && <p>Map problem: {problem}</p>}
    </>
  );
}
