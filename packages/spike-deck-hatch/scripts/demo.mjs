#!/usr/bin/env node
/**
 * One-command evaluation demo for the crosshatch routes (U12 spike).
 *
 *   pnpm --filter @maplibre-yaml/spike-deck-hatch demo      (DEMO_PORT=4174)
 *
 * Builds core + the spike bundle, starts the repo's static server, emits the
 * document's ejected style (so the "ejected" link works), and prints the URLs.
 * Ctrl-C stops the server.
 */
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const PORT = Number(process.env.DEMO_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

console.log("• building @maplibre-yaml/core …");
run("pnpm", ["--filter", "@maplibre-yaml/core", "build"]);
console.log("• bundling the spike …");
run("pnpm", ["--filter", "@maplibre-yaml/spike-deck-hatch", "bundle"]);

console.log(`• starting the server on ${ORIGIN} …`);
const server = spawn("node", ["e2e/server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, VERIFY_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve) => server.stdout.once("data", resolve));

console.log("• emitting the ejected style (fixture tiles) …");
try {
  execFileSync(
    "node",
    ["--import", "tsx", "../spike-deck-hatch/scripts/emit-crosshatch.ts", join(ROOT, "e2e/generated/spike-crosshatch"), ORIGIN],
    { cwd: join(ROOT, "packages/cli"), stdio: ["ignore", "ignore", "inherit"] }
  );
} catch {
  console.warn("  (emit failed — the 'ejected' link will 404; the routes still work)");
}

const page = `${ORIGIN}/packages/spike-deck-hatch/page/crosshatch.html`;
console.log(`
Crosshatch demo — open in a browser on this machine (Chrome/Edge/Firefox):

  static   ${page}?route=static     the document alone = the fallback
  deck     ${page}?route=deck       route 1: deck.gl geometry + Tangram shader
  post     ${page}?route=post       route 3: screen-space post-process
  ejected  ${ORIGIN}/e2e/generated/spike-crosshatch/index.html
                                     the document ejected to plain maplibre-gl

HUD (bottom-left): switch routes, live fps, "orbit" = continuous rotation
(the stress case). Live OpenFreeMap tiles by default; add &tiles=fixture for
the offline lower-Manhattan fixture. Camera: &z= &b= &p= &lng= &lat=.
Server running — Ctrl-C to stop.`);
process.on("SIGINT", () => { server.kill(); process.exit(0); });
