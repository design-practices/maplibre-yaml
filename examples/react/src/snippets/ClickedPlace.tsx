import "@maplibre-yaml/core/register";
import type { MLMap, MLMapEventMap } from "@maplibre-yaml/core/register";
import { useEffect, useRef, useState } from "react";

// React 18 and 19: listen on the element through a ref.
export function ClickedPlace() {
  const ref = useRef<MLMap>(null);
  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const onClick = (event: MLMapEventMap["ml-map:layer-click"]) =>
      setPlace(event.detail.feature.properties.place);
    el.addEventListener("ml-map:layer-click", onClick);
    return () => el.removeEventListener("ml-map:layer-click", onClick);
  }, []);

  return (
    <>
      <ml-map ref={ref} src="/map.yaml" style={{ display: "block", height: "400px" }} />
      <p>Clicked: {place ?? "nothing yet"}</p>
    </>
  );
}
