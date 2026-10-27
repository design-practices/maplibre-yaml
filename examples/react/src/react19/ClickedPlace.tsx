import "@maplibre-yaml/core/register";
import { useState } from "react";

// React 19: an `onml-map:*` prop listens for that ml-map:* event.
export function ClickedPlace() {
  const [place, setPlace] = useState<string | null>(null);

  return (
    <>
      <ml-map
        src="/map.yaml"
        onml-map:layer-click={(event) => setPlace(event.detail.feature.properties.place)}
        style={{ display: "block", height: "400px" }}
      />
      <p>Clicked: {place ?? "nothing yet"}</p>
    </>
  );
}
