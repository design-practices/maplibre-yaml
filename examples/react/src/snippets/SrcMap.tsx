import "@maplibre-yaml/core/register";

// public/map.yaml is served at /map.yaml.
export function SrcMap() {
  return <ml-map src="/map.yaml" style={{ display: "block", height: "400px" }} />;
}
