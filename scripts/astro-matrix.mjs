#!/usr/bin/env node
/**
 * Build and browser-test the Astro example site on every supported Astro major.
 *
 * @remarks
 * `@maplibre-yaml/astro` advertises a peer range of Astro majors; this is
 * what makes that range true. For each major it does what a user does:
 *
 *   1. `pnpm pack` core and astro (the exact tarballs npm would publish),
 *      each AT THE VERSION THE PENDING CHANGESETS WILL RELEASE (below),
 *   2. copy `examples/astro/site` into a fresh directory OUTSIDE the
 *      workspace and `npm install` it against `astro@^N` and the tarballs --
 *      no `--legacy-peer-deps`, so a peer range that excludes N fails here,
 *   3. `astro check`, `astro build`,
 *   4. `astro preview` + the full Playwright suite (examples/astro/site/e2e),
 *   5. `astro dev` + the `@dev` smoke tests -- dev mode had its own break
 *      (maplibre-gl not pre-bundled for npm installs) that builds never show.
 *
 * Outside the workspace on purpose: pnpm's workspace links hide packaging
 * mistakes (a file missing from `files`, a dependency only the monorepo
 * hoists) that an npm install of the tarball exposes.
 *
 * ## Packed at the release versions
 *
 * astro's peer range on core is under test too, and it may require a core
 * that only the next release ships (astro 0.6 needs core >= 0.8 for
 * `<ml-scrollytelling>`). Packed at the workspace versions (core still 0.7.0
 * until the version PR), the strict npm install would refuse that pairing
 * although it is exactly what will be published. So before packing, the
 * script runs `changeset version` in a throwaway, git-less copy of the
 * workspace manifests (not `changeset status`, which needs the base branch
 * in git) and packs each package at the version it releases: it
 * rewrites `version` in the package.json being packed and restores the
 * original bytes in a `finally` (and on SIGINT/SIGTERM), so a run, failed or
 * not, never leaves the tree dirty. With no pending changesets it packs at
 * the current versions. Peers stay strict: still no `--legacy-peer-deps`,
 * and a range that excludes the core being released, or an Astro major,
 * still fails the install step.
 *
 * Usage:
 *   node scripts/astro-matrix.mjs                     # majors 4 5 6 7, all steps
 *   node scripts/astro-matrix.mjs --majors 6,7
 *   node scripts/astro-matrix.mjs --steps check,build,preview
 *
 * Env: ASTRO_MATRIX_DIR (work dir; default $TMPDIR/maplibre-yaml-astro-matrix),
 * ASTRO_MATRIX_PORT (preview port, dev uses +1; default 4330).
 * Requires `pnpm build` first (core's dist is packed).
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(REPO, "examples/astro/site");
const SUPPORTED = ["4", "5", "6", "7"];
const ALL_STEPS = ["check", "build", "preview", "dev"];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1].split(",").filter(Boolean);
};
const majors = flag("majors", SUPPORTED);
const steps = flag("steps", ALL_STEPS);
const WORK = process.env.ASTRO_MATRIX_DIR ?? join(tmpdir(), "maplibre-yaml-astro-matrix");
const PORT = Number(process.env.ASTRO_MATRIX_PORT ?? 4330);

for (const m of majors) {
  if (!SUPPORTED.includes(m)) throw new Error(`unsupported Astro major ${m} (supported: ${SUPPORTED})`);
}
for (const s of steps) {
  if (!ALL_STEPS.includes(s)) throw new Error(`unknown step ${s} (steps: ${ALL_STEPS})`);
}

const ENV = {
  ...process.env,
  ASTRO_TELEMETRY_DISABLED: "1",
  CI: process.env.CI ?? "1",
  // Astro 7 detaches `astro dev` / `astro preview` into a background daemon
  // when it detects a coding agent driving it; that daemon outlives this
  // script. These are the variables its re-launched child sets to stay in
  // the foreground -- setting them keeps every server a child we can stop.
  ASTRO_DEV_BACKGROUND: "0",
  ASTRO_PREVIEW_BACKGROUND: "0",
};

/** Run a command to completion, streaming output; resolve its exit code. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}${opts.cwd ? `   (in ${opts.cwd})` : ""}`);
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", env: ENV, ...opts });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

/** Start a long-running server in its own process group; return a stopper. */
function startServer(cmd, cmdArgs, cwd, logPrefix) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}   (in ${cwd}, background)`);
  const child = spawn(cmd, cmdArgs, { cwd, env: ENV, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      log.push(text);
      process.stdout.write(text.replace(/^/gm, `${logPrefix} `));
    });
  }
  const exited = new Promise((resolve) => child.on("exit", resolve));
  return {
    log,
    async stop() {
      const signal = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          /* already gone */
        }
      };
      signal("SIGTERM");
      const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000));
      if ((await Promise.race([exited, timeout])) === "timeout") signal("SIGKILL");
    },
  };
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * The versions the pending changesets will release, by package name; `{}`
 * when there are none (pack at the current versions, as before).
 *
 * @remarks
 * Runs `changeset version` in a throwaway copy of the workspace's manifests
 * (root package.json, pnpm-workspace.yaml, every workspace package.json, and
 * `.changeset/`), then reads the versions it wrote. Not `changeset status`:
 * that always diffs against the base branch through git, and CI's shallow
 * checkout has no `main` to diff against. The copy is not a git repository
 * and the real tree is never touched.
 */
function pendingVersions() {
  const preview = join(WORK, "changeset-preview");
  rmSync(preview, { recursive: true, force: true });
  mkdirSync(join(preview, ".changeset"), { recursive: true });
  const changesets = readdirSync(join(REPO, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md");
  if (changesets.length === 0) return {};

  for (const f of ["package.json", "pnpm-workspace.yaml"]) cpSync(join(REPO, f), join(preview, f));
  for (const f of changesets) cpSync(join(REPO, ".changeset", f), join(preview, ".changeset", f));
  // No changelog generator: it is resolved from .changeset/, which the copy
  // has no node_modules for, and only versions are wanted here.
  const config = JSON.parse(readFileSync(join(REPO, ".changeset/config.json"), "utf8"));
  writeFileSync(join(preview, ".changeset/config.json"), JSON.stringify({ ...config, changelog: false }, null, 2));

  // Workspace package directories: pnpm-workspace.yaml's `dir` and `dir/*` entries.
  const patterns = [...readFileSync(join(REPO, "pnpm-workspace.yaml"), "utf8").matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map(
    (m) => m[1]
  );
  const dirs = patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    if (!existsSync(join(REPO, parent))) return [];
    return readdirSync(join(REPO, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${parent}/${d.name}`);
  });
  const manifests = dirs.filter((d) => existsSync(join(REPO, d, "package.json")));
  for (const d of manifests) {
    mkdirSync(join(preview, d), { recursive: true });
    cpSync(join(REPO, d, "package.json"), join(preview, d, "package.json"));
  }

  const res = spawnSync(process.execPath, [join(REPO, "node_modules/@changesets/cli/bin.js"), "version"], {
    cwd: preview,
    env: ENV,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`changeset version (preview) failed:\n${res.stdout}\n${res.stderr}`);

  const versions = {};
  for (const d of manifests) {
    const before = JSON.parse(readFileSync(join(REPO, d, "package.json"), "utf8"));
    const after = JSON.parse(readFileSync(join(preview, d, "package.json"), "utf8"));
    if (after.version !== before.version) versions[after.name] = after.version;
  }
  return versions;
}

/** Rewrite `version` in a package.json; returns a function restoring the original bytes. */
function setVersion(pkgJson, version) {
  const original = readFileSync(pkgJson, "utf8");
  const pkg = JSON.parse(original);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    writeFileSync(pkgJson, original);
  };
  if (!version || pkg.version === version) return restore;
  console.log(`  packing ${pkg.name} at ${version} (workspace: ${pkg.version})`);
  writeFileSync(pkgJson, original.replace(`"version": "${pkg.version}"`, `"version": "${version}"`));
  if (JSON.parse(readFileSync(pkgJson, "utf8")).version !== version) {
    restore();
    throw new Error(`could not set the version of ${pkgJson}`);
  }
  return restore;
}

async function pack() {
  if (!existsSync(join(REPO, "packages/core/dist/index.js"))) {
    throw new Error("packages/core/dist is missing; run `pnpm build` first");
  }
  const dir = join(WORK, "packs");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const versions = pendingVersions();
  const restores = [];
  const restoreAll = () => {
    for (const restore of restores.splice(0)) restore();
  };
  // A Ctrl-C mid-pack must not leave a rewritten package.json behind either.
  const onSignal = (signal) => {
    restoreAll();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    // Both versions before either pack: `pnpm pack` turns astro's
    // `workspace:*` dev dependency on core into core's current version, so
    // core must already read as the release version when astro packs.
    for (const pkg of ["core", "astro"]) {
      const pkgJson = join(REPO, "packages", pkg, "package.json");
      const name = JSON.parse(readFileSync(pkgJson, "utf8")).name;
      restores.push(setVersion(pkgJson, versions[name]));
    }
    if (process.env.ASTRO_MATRIX_FAIL_PACK === "1") {
      throw new Error("ASTRO_MATRIX_FAIL_PACK=1: forced failure (tests the package.json restore)");
    }
    for (const pkg of ["core", "astro"]) {
      const code = await run("pnpm", ["pack", "--pack-destination", dir], { cwd: join(REPO, "packages", pkg) });
      if (code !== 0) throw new Error(`pnpm pack failed for ${pkg}`);
    }
  } finally {
    restoreAll();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  const tarball = (name) => {
    const file = readdirSync(dir).find((f) => f.startsWith(`maplibre-yaml-${name}-`) && f.endsWith(".tgz"));
    if (!file) throw new Error(`no tarball for ${name} in ${dir}`);
    return join(dir, file);
  };
  return { core: tarball("core"), astro: tarball("astro") };
}

/** A fresh copy of the site wired to astro@^major and the packed tarballs. */
function scaffold(major, packs) {
  const dir = join(WORK, `astro-${major}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(SITE, dir, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist|\.astro|e2e|results)([\\/]|$)/.test(src.slice(SITE.length)),
  });
  const sitePkg = JSON.parse(readFileSync(join(SITE, "package.json"), "utf8"));
  const pkg = {
    name: `astro-matrix-${major}`,
    private: true,
    type: "module",
    dependencies: {
      astro: `^${major}`,
      "@maplibre-yaml/astro": `file:${packs.astro}`,
      "@maplibre-yaml/core": `file:${packs.core}`,
      "maplibre-gl": sitePkg.dependencies["maplibre-gl"],
    },
    devDependencies: sitePkg.devDependencies,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return dir;
}

async function playwright(url, mode, major) {
  return run(
    "npx",
    ["playwright", "test", "-c", "examples/astro/site/e2e/playwright.config.ts"],
    {
      cwd: REPO,
      env: {
        ...ENV,
        ASTRO_SITE_URL: url,
        ASTRO_SITE_MODE: mode,
        ASTRO_SITE_RESULTS: join(WORK, `results-astro-${major}-${mode}`),
      },
    }
  );
}

async function serveAndTest(dir, major, mode, port) {
  const url = `http://127.0.0.1:${port}`;
  // Something already answering here would be tested instead of this build.
  if (await waitForHttp(`${url}/`, 1000)) {
    console.error(`port ${port} is already serving; set ASTRO_MATRIX_PORT to a free port`);
    return 1;
  }
  const server = startServer(
    join(dir, "node_modules/.bin/astro"),
    [mode, "--port", String(port), "--host", "127.0.0.1"],
    dir,
    `[astro ${major} ${mode}]`
  );
  try {
    if (!(await waitForHttp(`${url}/`))) {
      console.error(`astro ${mode} did not come up on ${url}`);
      return 1;
    }
    return await playwright(url, mode, major);
  } finally {
    await server.stop();
  }
}

const results = [];
const record = (major, step, code, note = "") => {
  results.push({ major, step, ok: code === 0, note });
  return code === 0;
};

mkdirSync(WORK, { recursive: true });
const packs = await pack();

for (const major of majors) {
  console.log(`\n========== Astro ${major} ==========`);
  const dir = scaffold(major, packs);
  if (!record(major, "install", await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir }))) continue;

  const installed = JSON.parse(readFileSync(join(dir, "node_modules/astro/package.json"), "utf8")).version;
  if (!record(major, "version", installed.split(".")[0] === major ? 0 : 1, `astro ${installed}`)) continue;

  const astro = join(dir, "node_modules/.bin/astro");
  if (steps.includes("check") && !record(major, "check", await run(astro, ["check"], { cwd: dir }))) continue;
  if (steps.includes("build") || steps.includes("preview")) {
    if (!record(major, "build", await run(astro, ["build"], { cwd: dir }))) continue;
  }
  if (steps.includes("preview")) record(major, "preview+e2e", await serveAndTest(dir, major, "preview", PORT));
  if (steps.includes("dev")) record(major, "dev+smoke", await serveAndTest(dir, major, "dev", PORT + 1));
}

console.log("\n========== Astro matrix ==========");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  astro ${r.major}  ${r.step.padEnd(12)} ${r.note}`);
}
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} step(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} steps passed.`);
