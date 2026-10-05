import { useState } from "react";
import { ROUTE_COLORS, routesDocument } from "../maps";
import { EventPropsMap } from "./EventPropsMap";

/**
 * React 19: the config OBJECT goes straight in, and it is deliberately not
 * memoized: every render hands the element a brand-new object. Since 0.7 the
 * element compares by value (JSON), so re-rendering with an equal document
 * leaves the map alone; changing the color rebuilds it.
 */
export function React19Panel() {
  const [renders, setRenders] = useState(1);
  const [loads, setLoads] = useState(0);
  const [colorIndex, setColorIndex] = useState(0);
  const [clicked, setClicked] = useState<string | null>(null);

  return (
    <>
      <EventPropsMap
        config={routesDocument(ROUTE_COLORS[colorIndex])}
        onLoad={() => setLoads((n) => n + 1)}
        onLayerClick={(layerId) => setClicked(layerId)}
      />
      <div className="row">
        <button type="button" onClick={() => setRenders((n) => n + 1)}>
          Re-render (equal object)
        </button>
        <button
          type="button"
          onClick={() => setColorIndex((i) => (i + 1) % ROUTE_COLORS.length)}
        >
          Change color
        </button>
      </div>
      <p className="readout" data-testid="r19-readout">
        <span data-testid="r19-loads">{loads}</span> × <code>onml-map:load</code> ·
        parent rendered <span data-testid="r19-renders">{renders}</span> × · layer
        clicked: {clicked ?? "none"}
      </p>
    </>
  );
}
