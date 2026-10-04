import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre-yaml/core/register";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { recordMapEvents } from "./instrumentation";

recordMapEvents();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
