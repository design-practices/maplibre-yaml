// Compiled together with the React JSX declaration that
// docs/.../integrations/web-components.mdx prints (extracted verbatim into
// tmp/ml-map.d.ts by framework-types.test.ts). Exercises everything the docs
// promise of it: src, a JSON-string config, a typed MLMap ref, and the
// React 19 `onml-map:*` event props.
import { useRef } from "react";
import type { MLMap } from "@maplibre-yaml/core/register";

export function YamlMap() {
  const ref = useRef<MLMap>(null);
  void ref.current?.mapReady().then((map) => map.getZoom());
  return (
    <ml-map
      ref={ref}
      src="/map.yaml"
      config={JSON.stringify({ type: "map" })}
      onml-map:load={(event) => console.log(event.detail)}
      style={{ display: "block", height: 400 }}
    />
  );
}

// The declaration must still reject a wrong attribute type.
// @ts-expect-error src is a string
export const Wrong = () => <ml-map src={5} />;
