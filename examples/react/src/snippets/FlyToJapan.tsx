import "@maplibre-yaml/core/register";
import type { MLMap } from "@maplibre-yaml/core/register";
import { useRef } from "react";

export function FlyToJapan() {
  const ref = useRef<MLMap>(null);

  // mapReady() resolves with the MapLibre map once the document has loaded.
  const flyToJapan = async () => {
    const map = await ref.current!.mapReady();
    map.flyTo({ center: [138, 37], zoom: 4.5 });
  };

  return (
    <>
      <button type="button" onClick={flyToJapan}>
        Fly to Japan
      </button>
      <ml-map ref={ref} src="/map.yaml" style={{ display: "block", height: "400px" }} />
    </>
  );
}
