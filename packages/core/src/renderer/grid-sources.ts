/**
 * @file Grid sources at render time: the thin shell over the `grid` chunk (grid source, U3)
 * @module @maplibre-yaml/core/renderer/grid-sources
 *
 * @description
 * A `type: grid` source never reaches MapLibre. `LayerManager` hands it to
 * this manager instead, which keeps one entry per source id — the spec, the
 * field once decoded, the failure if the load failed, and the waiters on
 * `gridReady` — and delegates the work to the chunk through the seam: fetch,
 * cache and decode are `loadGrid` (formats/lib/grid.ts), so a page without a
 * grid pays nothing for them. What stays here is what has to be answered
 * synchronously (`getGrid`) or outlive a single load (generations, waiters).
 *
 * Lifecycle (R14, R16, R17): a field page code holds is never changed — a
 * `range:` or `units:` change hands out a new one (`refitGrid`, no fetch);
 * a URL or decode-key change fetches, and the current field answers until
 * the new one is in; every new field is announced through `onLoaded`; a
 * failure keeps the previous field and goes through `onError` (the
 * per-source notice). A result for a load the source has since moved on
 * from — re-targeted, removed, destroyed — is dropped: generations.
 *
 * No maplibre-gl here: the layer manager imports this module and loads
 * without it.
 */

import type { GridSource } from "../schemas/source.schema";
import type { GridField, GridLoadHost } from "./grid-host";
import { getDecoder, type Decoders } from "../formats/decoders";
import { formatError } from "../formats/errors";
import { fetchWhole } from "../formats/http";
import { safeUrl } from "../utils/html";
import { absoluteUrl, WHOLE_FILE_MAX_BYTES } from "./cloud-sources";

/** What the grid chunk uses from core (see renderer/grid-host). @internal */
export const gridHost: GridLoadHost = {
  formatError,
  getDecoder,
  fetchWhole,
  absoluteUrl,
  safeUrl,
  limits: { bytes: WHOLE_FILE_MAX_BYTES },
};

/**
 * The keys whose change means another fetch and decode. `range` and `units`
 * are not among them: they refit the field in place.
 */
const FETCH_KEYS = ["url", "encoding", "bounds", "grid", "nodata", "bands"] as const;

function sameFetchKeys(a: GridSource, b: GridSource): boolean {
  return FETCH_KEYS.every((key) => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null));
}

/** What the manager tells its owner (the layer manager, which routes both to the renderer). */
export interface GridSourceCallbacks {
  /** A field was decoded or refit for `sourceId`: `get` answers with it from now on. */
  onLoaded(sourceId: string): void;
  /** A load failed; the previous field, if any, stays. */
  onError(sourceId: string, error: Error): void;
}

interface Waiters {
  promise: Promise<GridField>;
  resolve(field: GridField): void;
  reject(error: Error): void;
}

interface Entry {
  spec: GridSource;
  /** Bumped per load, removal or destroy: a result from an earlier one is dropped. */
  generation: number;
  field?: GridField | undefined;
  failure?: Error | undefined;
  /** The load in flight, and whoever waits on it. */
  pending?: Waiters | undefined;
}

function waiters(): Waiters {
  let resolve!: (field: GridField) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<GridField>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may be waiting: a failure is still reported through the callback.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** The grid sources of one map, by source id. */
export class GridSourceManager {
  private readonly entries = new Map<string, Entry>();
  private destroyed = false;
  /** The chunk once it has loaded: what refits a field without a round trip through the seam. */
  private chunk: Decoders["grid"] | undefined;

  constructor(
    private readonly callbacks: GridSourceCallbacks,
    private readonly host: GridLoadHost = gridHost
  ) {}

  has(sourceId: string): boolean {
    return this.entries.has(sourceId);
  }

  /** The field, once decoded; undefined before, after a failed first load, or for an unknown id. */
  get(sourceId: string): GridField | undefined {
    return this.entries.get(sourceId)?.field;
  }

  /**
   * Bring `sourceId` in line with `spec`: a new source, a changed file or
   * decode key, or a failed last load fetches ({@link set}); a `range:` or
   * `units:` change refits the field in place; nothing else does nothing.
   */
  update(sourceId: string, spec: GridSource): void {
    const entry = this.entries.get(sourceId);
    if (!entry || entry.failure || !sameFetchKeys(entry.spec, spec)) {
      this.set(sourceId, spec);
      return;
    }
    entry.spec = spec;
    // A load in flight conforms to the latest spec when it lands.
    if (entry.pending || !entry.field || !this.chunk) return;
    const next = this.chunk.refitGrid(entry.field, spec);
    if (next === entry.field) return;
    entry.field = next;
    this.callbacks.onLoaded(sourceId);
  }

  /**
   * Fetch and decode `spec` for `sourceId`, a new generation. The field in
   * place (if any) answers until the new one is in; waiters on `ready`
   * settle with the outcome.
   */
  set(sourceId: string, spec: GridSource): void {
    let entry = this.entries.get(sourceId);
    if (!entry) this.entries.set(sourceId, (entry = { spec, generation: 0 }));
    const current = entry;
    current.spec = spec;
    const generation = ++current.generation;
    const pending = (current.pending ??= waiters());
    const live = () => !this.destroyed && this.entries.get(sourceId) === current && current.generation === generation;
    getDecoder("grid")
      .then((chunk) => {
        this.chunk = chunk;
        return chunk.loadGrid(spec, this.host).then((field) => chunk.refitGrid(field, current.spec));
      })
      .then(
        (field) => {
          if (!live()) return;
          current.pending = undefined;
          current.failure = undefined;
          current.field = field;
          pending.resolve(field);
          this.callbacks.onLoaded(sourceId);
        },
        (error: unknown) => {
          if (!live()) return;
          const failure = error instanceof Error ? error : new Error(String(error));
          current.pending = undefined;
          current.failure = failure;
          pending.reject(failure);
          this.callbacks.onError(sourceId, failure);
        }
      );
  }

  /**
   * The field once it is in (R14). Rejects naming the id when no grid source
   * has it; with the source's failure when its load failed (a later load
   * gives new callers a fresh promise); and when the source is removed or
   * the manager destroyed while the load is in flight.
   */
  ready(sourceId: string): Promise<GridField> {
    const entry = this.entries.get(sourceId);
    if (this.destroyed || !entry) {
      return Promise.reject(
        new Error(
          this.destroyed
            ? `Grid source "${sourceId}": the map was destroyed, so there is no field to wait for.`
            : `Grid source "${sourceId}": the document declares no grid source with this id.`
        )
      );
    }
    if (entry.pending) return entry.pending.promise;
    if (entry.failure) return Promise.reject(entry.failure);
    return Promise.resolve(entry.field!);
  }

  /** Drop `sourceId`: its field, and any load in flight (its result is discarded; waiters are told). */
  remove(sourceId: string, why = "was removed from the document"): void {
    const entry = this.entries.get(sourceId);
    if (!entry) return;
    this.entries.delete(sourceId);
    entry.generation++;
    entry.pending?.reject(new Error(`Grid source "${sourceId}" ${why}, so its field is gone.`));
    entry.pending = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    for (const sourceId of [...this.entries.keys()]) this.remove(sourceId, "belongs to a map that was destroyed");
  }
}
