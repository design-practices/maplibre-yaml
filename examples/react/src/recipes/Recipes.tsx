import { version as reactVersion } from "react";
import { ClickedPlace as ClickedPlace19 } from "#react19-only";
import { Card } from "../Card";
import { ClickedPlace } from "../snippets/ClickedPlace";
import { ClickedPlaces } from "../snippets/ClickedPlaces";
import { EarthquakeMap } from "../snippets/EarthquakeMap";
import { FlyToJapan } from "../snippets/FlyToJapan";

const MAJOR = Number(reactVersion.split(".")[0]);

/**
 * The docs' "Common tasks" recipes, each as the reader pastes it after the
 * quick start: every one loads /map.yaml (public/map.yaml here, the quick
 * start's document with local data) and reads the quake's `place`.
 */
export function Recipes() {
  return (
    <div className="page">
      <header>
        <div>
          <h1>React recipes</h1>
          <p>
            The "Common tasks" snippets from the docs, unchanged, on the quick start's map
            document. <a href="./index.html">Back to the example</a>.
          </p>
        </div>
        <div className="badges">
          <span className="badge" data-testid="react-version">
            React {reactVersion}
          </span>
          <span className="badge muted" data-testid="build-mode">
            {import.meta.env.DEV
              ? "StrictMode · development build"
              : "StrictMode · production build"}
          </span>
        </div>
      </header>

      <main className="grid">
        <Card
          id="click19"
          title={MAJOR >= 19 ? "Respond to a click: an onml-map:layer-click prop" : "React 19 only"}
          lede="React 19 attaches the listener from the prop."
        >
          <ClickedPlace19 />
        </Card>
        <Card id="click" title="Respond to a click: a ref" lede="React 18 and 19.">
          <ClickedPlace />
        </Card>
        <Card id="flyto" title="Use the MapLibre map" lede="mapReady(), then flyTo().">
          <FlyToJapan />
        </Card>
        <Card id="hook" title="A useMapEvent hook" lede="Every click adds one place.">
          <ClickedPlaces />
        </Card>
        <Card id="together" title="Putting it together" lede="Clicks, errors, zoom." wide>
          <EarthquakeMap />
        </Card>
      </main>
    </div>
  );
}
