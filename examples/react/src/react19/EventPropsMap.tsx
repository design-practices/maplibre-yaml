import "@maplibre-yaml/core/register";
import type { MapBlock } from "@maplibre-yaml/core";

// React 19 only: `config` takes the object itself (React 19 sets it as a
// property), and `onml-map:*` props attach listeners, typed per event.
export function EventPropsMap({
  config,
  onLoad,
  onLayerClick,
}: {
  config: MapBlock;
  onLoad: () => void;
  onLayerClick: (layerId: string) => void;
}) {
  return (
    <ml-map
      config={config}
      onml-map:load={() => onLoad()}
      onml-map:layer-click={(event) => onLayerClick(event.detail.layerId)}
      onml-map:error={(event) =>
        console.error(event.detail.error ?? event.detail.errors)
      }
      style={{ display: "block", height: "400px" }}
    />
  );
}
