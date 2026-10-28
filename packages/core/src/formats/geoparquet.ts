/**
 * @file GeoParquet, the main bundle's half: how much of a file its first read asks for (0.9, ml-cnv.4; bundle headroom U5)
 * @module @maplibre-yaml/core/formats/geoparquet
 *
 * @description
 * Reading a GeoParquet file — the adapter, the size guards and the data
 * provider — is the `geoparquet` on-demand chunk (formats/lib/geoparquet.ts,
 * `chunks/geoparquet.js`), with the library it calls. What stays in the main
 * bundle is the footer request a read starts with (`formats/http`
 * `fetchTail`, started by renderer/cloud-sources while the chunk downloads,
 * so the two overlap), and its length, here: both halves read it, so this
 * module imports nothing.
 */

/** The first read: the file's last 512 KiB — the footer, and all of a small file. */
export const TAIL_BYTES = 512 * 1024;
