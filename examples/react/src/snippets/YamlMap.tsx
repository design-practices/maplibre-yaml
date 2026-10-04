import "@maplibre-yaml/core/register";
import type { MLMap, MLMapEventMap } from "@maplibre-yaml/core/register";
import { useEffect, useRef, useState } from "react";

export function YamlMap({ src }: { src: string }) {
  const ref = useRef<MLMap>(null);
  const [clicked, setClicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const onClick = (event: MLMapEventMap["ml-map:layer-click"]) =>
      setClicked(String(event.detail.feature?.properties?.name));
    const onError = (event: MLMapEventMap["ml-map:error"]) =>
      console.error(event.detail.error ?? event.detail.errors);
    el.addEventListener("ml-map:layer-click", onClick);
    el.addEventListener("ml-map:error", onError);

    // mapReady() resolves with the MapLibre map once the document loaded.
    let cancelled = false;
    el.mapReady().then(
      (map) => {
        if (cancelled) return;
        setZoom(map.getZoom());
        map.on("zoomend", () => setZoom(map.getZoom()));
      },
      () => {} // a failed document also fires ml-map:error
    );

    return () => {
      cancelled = true;
      el.removeEventListener("ml-map:layer-click", onClick);
      el.removeEventListener("ml-map:error", onError);
    };
  }, []);

  return (
    <>
      <ml-map ref={ref} src={src} style={{ display: "block", height: "400px" }} />
      <p>
        Zoom {zoom?.toFixed(1) ?? "…"} · clicked: {clicked ?? "nothing yet"}
      </p>
    </>
  );
}
