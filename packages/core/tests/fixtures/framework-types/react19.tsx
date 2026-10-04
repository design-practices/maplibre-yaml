// React 19 only (@types/react 19): `config` takes the document object, and
// `onml-map:*` props are typed per event with the right CustomEvent detail.
import type { MapBlock } from "@maplibre-yaml/core";

const doc: MapBlock = {
  type: "map",
  id: "m",
  config: { center: [0, 0], zoom: 2, mapStyle: "/style.json" },
  layers: [],
};

export const ObjectConfig = () => (
  <ml-map
    config={doc}
    onml-map:load={(event) => console.log(event.type)}
    onml-map:layer-click={(event) => {
      const layer: string = event.detail.layerId;
      console.log(layer, event.detail.lngLat.lng);
    }}
    onml-map:error={(event) =>
      console.error(event.detail.error ?? event.detail.errors)
    }
    onml-map:parameter-change={(event) => console.log(event.detail.key)}
  />
);

export const WrongDetail = () => (
  <ml-map
    // @ts-expect-error layer-added carries layerId, not featureCount
    onml-map:layer-added={(event) => event.detail.featureCount.toFixed()}
  />
);

