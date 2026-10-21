/**
 * @file The COG reader's first block, served from the preflight's read (0.9)
 * @module @maplibre-yaml/core/formats/lib/cog-first-block
 *
 * @description
 * Before the COG plugin reads a file, core reads its first 64 KB once (the
 * preflight, formats/cog.ts) to check what the plugin can't. geotiff.js, under
 * the plugin, then asks for exactly the same range — its first 64 KB block —
 * so every COG was read twice. The plugin builds its geotiff.js source
 * internally and fetches through the global `fetch`, so the only seam is that
 * call: {@link shareFirstBlock} hands over the preflight's bytes, and a thin
 * wrapper around `fetch`, installed once when the COG reader loads, answers
 * the one matching request for that file from them. Every other request goes
 * to `fetch` untouched, and a held block is served once and then dropped.
 *
 * A leaf module of the `cog` chunk: it imports nothing from core.
 */

interface HeldBlock {
  bytes: Uint8Array;
  /** The preflight reply's `Content-Range`, when the page could read it. */
  contentRange: string | null;
}

const held = new Map<string, HeldBlock>();
let installed = false;

/** The `Range` header of a request, whatever form its headers take. */
function rangeOf(init: RequestInit | undefined): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("range");
  if (Array.isArray(headers)) return headers.find(([k]) => k.toLowerCase() === "range")?.[1] ?? null;
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "range");
  return entry ? String(entry[1]) : null;
}

function install(): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (held.size > 0 && typeof input === "string" && (init?.method ?? "GET").toUpperCase() === "GET") {
      const block = held.get(input);
      const m = block ? /^bytes=0-(\d+)$/.exec(rangeOf(init) ?? "") : null;
      // Only the range the preflight read, from its start, and only once.
      if (block && m && Number(m[1]) + 1 <= block.bytes.length) {
        held.delete(input);
        const end = Number(m[1]);
        const total = /\/(\d+)\s*$/.exec(block.contentRange ?? "")?.[1];
        return Promise.resolve(
          new Response(block.bytes.slice(0, end + 1), {
            status: 206,
            headers: {
              "content-length": String(end + 1),
              ...(total ? { "content-range": `bytes 0-${end}/${total}` } : {}),
            },
          })
        );
      }
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}

/**
 * Hold a file's first bytes, read by the preflight, for the reader's own
 * first request of them.
 *
 * @param url - The file URL exactly as the reader will request it.
 */
export function shareFirstBlock(url: string, block: HeldBlock): void {
  install();
  held.set(url, block);
}

/** Drop a held block the reader didn't ask for (it had the file already). */
export function dropFirstBlock(url: string): void {
  held.delete(url);
}
