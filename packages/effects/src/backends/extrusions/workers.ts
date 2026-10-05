/**
 * @file A small, shared, ref-counted pool of mesh workers
 * @module @maplibre-yaml/effects/backends/extrusions
 *
 * @description
 * Every extrusions attachment on a page shares one pool (two module
 * workers); the last detach terminates it. Builds are fire-and-forget
 * promises — the render loop only ever reads finished results — so a
 * terminated pool resolves its pending builds as "nothing" rather than
 * leaving them dangling.
 */

import type { BuildInput, MeshData } from "./mesh-build";

export interface BuildResult {
  mesh: MeshData | null;
  ms: number;
}

/** Thrown into pending builds when the worker script itself failed to load. */
export class WorkerUnavailableError extends Error {}

type Waiter = { resolve: (r: BuildResult) => void; reject: (e: Error) => void };

export class MeshWorkerPool {
  private readonly workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private readonly waiting = new Map<number, Waiter>();
  /** Set once a worker failed to start (bad URL, CSP, no module workers). */
  failure: Error | null = null;

  constructor(url: string | URL | undefined, size = 2) {
    for (let i = 0; i < size; i++) {
      // The literal `new Worker(new URL(..., import.meta.url))` form is what
      // bundlers (Vite, webpack 5) recognise and emit the worker for.
      const w =
        url === undefined
          ? new Worker(new URL("./extrusions-worker.js", import.meta.url), { type: "module" })
          : new Worker(url, { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; mesh?: MeshData | null; ms?: number; error?: string }>) => {
        const p = this.waiting.get(e.data.id);
        this.waiting.delete(e.data.id);
        if (!p) return;
        if (e.data.error !== undefined) p.reject(new Error(e.data.error));
        else p.resolve({ mesh: e.data.mesh ?? null, ms: e.data.ms ?? 0 });
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        this.failure = new WorkerUnavailableError(
          `the mesh worker failed to load (${e.message || "script error"}) from ${String(url ?? "extrusions-worker.js beside the effects bundle")}`
        );
        for (const p of this.waiting.values()) p.reject(this.failure);
        this.waiting.clear();
      };
      this.workers.push(w);
    }
  }

  build(input: BuildInput): Promise<BuildResult> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.seq;
    const w = this.workers[this.next++ % this.workers.length]!;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      const transfer = input.raw instanceof ArrayBuffer ? [input.raw] : [];
      w.postMessage({ id, ...input }, transfer);
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.waiting.values()) p.resolve({ mesh: null, ms: 0 });
    this.waiting.clear();
  }
}

let shared: { pool: MeshWorkerPool; url: string; refs: number } | null = null;

/** Acquire the shared pool (created on first use). */
export function acquirePool(url: string | URL | undefined): MeshWorkerPool {
  const key = String(url ?? "default");
  if (shared && shared.url === key && !shared.pool.failure) {
    shared.refs++;
    return shared.pool;
  }
  const pool = new MeshWorkerPool(url);
  if (!shared || shared.refs === 0) shared = { pool, url: key, refs: 1 };
  return pool;
}

/** Release a pool; the last release terminates it. */
export function releasePool(pool: MeshWorkerPool): void {
  if (shared && shared.pool === pool) {
    shared.refs--;
    if (shared.refs <= 0) {
      pool.terminate();
      shared = null;
    }
    return;
  }
  pool.terminate();
}
