import "@maplibre-yaml/core/register";
import type { MLMap } from "@maplibre-yaml/core/register";
import { useRef } from "react";

export function MapWithControls({ src }: { src: string }) {
  const ref = useRef<MLMap>(null);
  const zoomBy = (delta: number) => {
    const map = ref.current?.getMap();
    map?.easeTo({ zoom: map.getZoom() + delta, duration: 300 });
  };

  // Children with slot="top-left" (and the other corners, or "legend") are
  // placed in the map's corner, stacked with the built-in chrome. Render
  // slot children unconditionally: the element moves them into the map, so
  // React may update their contents but must not add or remove them.
  return (
    <ml-map ref={ref} src={src} style={{ display: "block", height: "400px" }}>
      <div slot="top-left" className="map-buttons">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
          −
        </button>
      </div>
    </ml-map>
  );
}
