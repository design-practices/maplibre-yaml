// Loads tests/fixtures/ssr/entry.js through Vite's SSR module loader
// (`ssrLoadModule`), in a plain Node process with no DOM globals. Vite is
// reached through vitest (core has no direct vite dependency). Exits 1 and
// prints the error when the module graph throws on the server.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const pkgRoot = process.cwd();
const fromVitest = createRequire(createRequire(join(pkgRoot, "package.json")).resolve("vitest/package.json"));
const vitePkgPath = fromVitest.resolve("vite/package.json");
const dot = JSON.parse(readFileSync(vitePkgPath, "utf8")).exports["."];
const esm = typeof dot.import === "string" ? dot.import : dot.import.default;
const vite = await import(pathToFileURL(join(dirname(vitePkgPath), esm)).href);

const server = await vite.createServer({
  root: pkgRoot,
  configFile: false,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  // Run core's dist through Vite's SSR transform, as SvelteKit does for a
  // linked/workspace package, rather than handing it straight to Node.
  ssr: { noExternal: ["@maplibre-yaml/core"] },
});
try {
  const mod = await server.ssrLoadModule("/tests/fixtures/ssr/entry.js");
  process.stdout.write(JSON.stringify({ exports: Object.keys(mod).sort(), MLMap: typeof mod.MLMap }));
} catch (error) {
  process.stderr.write(String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await server.close();
}
