import "@maplibre-yaml/core/register";
import type { MapBlock } from "@maplibre-yaml/core";

export function ConfigMap({ config }: { config: MapBlock }) {
  // A JSON string works on React 18 (set as the attribute) and React 19
  // (set as the property). An equal string never re-renders the map.
  return (
    <ml-map
      config={JSON.stringify(config)}
      style={{ display: "block", width: "100%", height: "400px" }}
    />
  );
}
