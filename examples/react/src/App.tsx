import { useRef, useState, version as reactVersion, type ReactNode, type RefObject } from "react";
import { React19Panel } from "#react19-only";
import { CITIES_YAML, ROUTE_COLORS, routesDocument } from "./maps";
import { ConfigMap } from "./snippets/ConfigMap";
import { YamlMap } from "./snippets/YamlMap";
import { MapWithControls } from "./snippets/SlotControls";
import { LateConfigMap } from "./LateConfigMap";
import { useMapEvent } from "./useMapEvent";

const MAJOR = Number(reactVersion.split(".")[0]);

/** A titled demo card. `wide` spans both grid columns. */
function Card(props: {
  id: string;
  title: string;
  lede: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={props.id} className={props.wide ? "card wide" : "card"}>
      <h2>{props.title}</h2>
      <p className="lede">{props.lede}</p>
      {props.children}
    </section>
  );
}

/** Every ml-map:* event bubbles, so one listener on the page sees them all. */
function EventLog({ scope }: { scope: RefObject<HTMLElement | null> }) {
  const [lines, setLines] = useState<string[]>([]);
  const push = (line: string) => setLines((prev) => [line, ...prev].slice(0, 7));
  const where = (event: Event) => (event.target as HTMLElement).closest("section")?.id ?? "?";

  useMapEvent(scope, "ml-map:load", (e) => push(`${where(e)} · ml-map:load`));
  useMapEvent(scope, "ml-map:layer-click", (e) =>
    push(`${where(e)} · layer-click · ${e.detail.layerId} · ${e.detail.feature?.properties?.name}`)
  );
  useMapEvent(scope, "ml-map:parameter-change", (e) =>
    push(`${where(e)} · parameter-change · ${e.detail.key} = ${String(e.detail.value)}`)
  );
  useMapEvent(scope, "ml-map:layer-visibility", (e) =>
    push(`${where(e)} · layer-visibility · ${e.detail.layerId} ${e.detail.visible ? "on" : "off"}`)
  );
  useMapEvent(scope, "ml-map:error", (e) =>
    push(`${where(e)} · ERROR · ${e.detail.error?.message ?? e.detail.errors?.[0]?.message}`)
  );

  return (
    <ol className="log" data-testid="event-log">
      {lines.length === 0 ? <li className="muted">waiting for events…</li> : null}
      {lines.map((line, i) => (
        <li key={`${lines.length - i}-${line}`}>{line}</li>
      ))}
    </ol>
  );
}

function ConfigObjectDemo() {
  const wrapper = useRef<HTMLDivElement>(null);
  const [colorIndex, setColorIndex] = useState(0);
  const [renders, setRenders] = useState(1);
  const [loads, setLoads] = useState(0);
  useMapEvent(wrapper, "ml-map:load", () => setLoads((n) => n + 1));

  return (
    <div ref={wrapper}>
      {/* Built on every render: an equal document is a no-op for the element. */}
      <ConfigMap config={routesDocument(ROUTE_COLORS[colorIndex])} />
      <div className="row">
        <button type="button" onClick={() => setRenders((n) => n + 1)}>
          Re-render (equal document)
        </button>
        <button
          type="button"
          onClick={() => setColorIndex((i) => (i + 1) % ROUTE_COLORS.length)}
        >
          Change color
        </button>
      </div>
      <p className="readout">
        <span data-testid="config-loads">{loads}</span> × <code>ml-map:load</code> ·
        parent rendered <span data-testid="config-renders">{renders}</span> ×
      </p>
    </div>
  );
}

function MountDemo() {
  const [mounted, setMounted] = useState(true);
  const [center, setCenter] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<number | null>(null);

  const toggle = () => {
    setMounted((m) => !m);
    // Count after React commits the change.
    requestAnimationFrame(() =>
      setCanvases(document.querySelectorAll("canvas.maplibregl-canvas").length)
    );
  };

  return (
    <>
      <div className="row">
        <button type="button" onClick={toggle} data-testid="mount-toggle">
          {mounted ? "Unmount map" : "Mount map"}
        </button>
        <span className="readout">
          canvases on page: <span data-testid="canvas-count">{canvases ?? "–"}</span>
        </span>
      </div>
      {mounted ? <LateConfigMap onReady={setCenter} /> : <div className="placeholder">unmounted</div>}
      <p className="readout">
        mapReady() (asked before the config existed) → center{" "}
        <span data-testid="late-center">{center ?? "…"}</span>
      </p>
    </>
  );
}

export function App() {
  const page = useRef<HTMLDivElement>(null);

  return (
    <div ref={page} className="page">
      <header>
        <div>
          <h1>&lt;ml-map&gt; in React</h1>
          <p>
            One Vite + TypeScript app, built against React 18 and React 19 from the same
            source and driven in a browser in CI. Typed by{" "}
            <code>@maplibre-yaml/core/react</code>.
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
          id="yaml"
          title="A YAML file, with its params panel"
          lede={
            <>
              <code>src="./maps/cities.yaml"</code>. The slider and checkboxes come from the
              document's <code>parameters:</code>. A ref + <code>mapReady()</code> reaches
              the MapLibre map; click a city.
            </>
          }
        >
          <YamlMap src={CITIES_YAML} />
        </Card>

        <Card
          id="config"
          title="A config object"
          lede={
            <>
              Built in code and passed as a JSON string, which works on both majors. An
              equal document never rebuilds the map; a changed one does.
            </>
          }
        >
          <ConfigObjectDemo />
        </Card>

        <Card
          id="slots"
          title="React-rendered controls in a slot"
          lede={
            <>
              A <code>&lt;div slot="top-left"&gt;</code> child, rendered by React, sits in
              the map corner next to the built-in params panel. Its buttons drive the map.
            </>
          }
        >
          <MapWithControls src={CITIES_YAML} />
        </Card>

        <Card
          id="mount"
          title="Mount, unmount, late config"
          lede={
            <>
              The config is assigned from an effect (the React 18 way). Unmounting destroys
              the MapLibre map; remounting creates exactly one.
            </>
          }
        >
          <MountDemo />
        </Card>

        <Card
          id="react19"
          title={MAJOR >= 19 ? "React 19: object config + onml-map:* props" : "React 19 only"}
          lede={
            <>
              <code>config={"{object}"}</code> and typed{" "}
              <code>onml-map:load</code> / <code>onml-map:layer-click</code> props. The
              object is rebuilt on every render on purpose.
            </>
          }
        >
          <React19Panel />
        </Card>

        <Card id="events" title="Event log" lede="Every ml-map:* event bubbles to one listener on the page.">
          <EventLog scope={page} />
        </Card>
      </main>
    </div>
  );
}
