import { MLMap } from "./components/index.js";

// Auto-register when this module is imported
if (typeof window !== "undefined" && !customElements.get("ml-map")) {
  customElements.define("ml-map", MLMap);
}

export { MLMap };
