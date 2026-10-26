import { describe, it, expect } from "vitest";
import { consoleText } from "../../src/utils/console-text";
import { appendMessage } from "../../src/components/map-notice";

describe("consoleText (ml-cnv.35)", () => {
  it("quotes a name, but leaves a command holding quotes copyable as shown", () => {
    const cmd = `uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('a.parquet', 'b.parquet')"`;
    expect(consoleText("set `maxFeatures` under `load:`, or run `" + cmd + "`.")).toBe(
      `set "maxFeatures" under "load:", or run ${cmd}.`
    );
  });
});

describe("the notice's docs links (ml-cnv.35)", () => {
  it("are links to this site's pages; other URLs stay text", () => {
    const p = document.createElement("p");
    appendMessage(document, p, "`x.parquet` failed (https://data.example.org/x.parquet). More: https://docs.maplibre-yaml.org/guides/geoparquet/#large-files and https://docs.maplibre-yaml.org/guides/pmtiles/#from-a-large-file");
    const links = [...p.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://docs.maplibre-yaml.org/guides/geoparquet/#large-files",
      "https://docs.maplibre-yaml.org/guides/pmtiles/#from-a-large-file",
    ]);
    expect(links[0]!.target).toBe("_blank");
    expect(links[0]!.rel).toBe("noopener");
    expect(p.textContent).toContain("https://data.example.org/x.parquet");
  });
});
