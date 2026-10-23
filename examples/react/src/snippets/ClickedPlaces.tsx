import "@maplibre-yaml/core/register";
import type { MLMap } from "@maplibre-yaml/core/register";
import { useRef, useState } from "react";
import { useMapEvent } from "./useMapEvent";

export function ClickedPlaces() {
  const ref = useRef<MLMap>(null);
  const [places, setPlaces] = useState<string[]>([]);

  useMapEvent(ref, "ml-map:layer-click", (event) =>
    setPlaces((list) => [...list, event.detail.feature.properties.place])
  );

  return (
    <>
      <ml-map ref={ref} src="/map.yaml" style={{ display: "block", height: "400px" }} />
      <ol>
        {places.map((place, i) => (
          <li key={i}>{place}</li>
        ))}
      </ol>
    </>
  );
}
