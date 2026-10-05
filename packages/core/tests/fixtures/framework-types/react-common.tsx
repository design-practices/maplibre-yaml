// Compiled against BOTH @types/react 19 (tsconfig.json) and 18
// (tsconfig.react18.json), together with the typings reference the
// "TypeScript with React" docs section prints (extracted verbatim into
// tmp/docs-react.d.ts by framework-types.test.ts). Everything here must hold
// on both majors: src, a JSON-string config, a typed MLMap ref, slot
// children and an inline YAML script.
import { useRef } from "react";
import type { MLMap } from "@maplibre-yaml/core/register";

export function YamlMap() {
  const ref = useRef<MLMap>(null);
  void ref.current?.mapReady().then((map) => map.getZoom());
  ref.current?.addEventListener("ml-map:layer-click", (event) => {
    const id: string = event.detail.layerId;
    void id;
  });
  return (
    <ml-map
      ref={ref}
      src="/map.yaml"
      config={JSON.stringify({ type: "map" })}
      style={{ display: "block", height: 400 }}
      className="map"
    >
      <script type="text/yaml">{"type: map\nid: inline"}</script>
      <div slot="top-right">
        <button type="button">Zoom</button>
      </div>
    </ml-map>
  );
}

// The typings must still reject a wrong attribute type.
// @ts-expect-error src is a string
export const Wrong = () => <ml-map src={5} />;
