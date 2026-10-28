/**
 * The FlatGeobuf, GeoParquet and COG readers, and the PMTiles failure path,
 * live in their on-demand chunks (formats/lib/, bundle headroom U5) and use
 * core through the host the main bundle hands each chunk as it loads
 * (`cloudReaders`; `cogReader` in formats/cog-protocol; `pmtilesReader` in
 * formats/pmtiles). A test that calls a chunk's module directly imports this
 * first: it hands over the same hosts.
 */
import { cloudHost } from "../../src/renderer/cloud-sources";
import { useHost } from "../../src/formats/lib/cloud-reader";
import { cogHost } from "../../src/formats/cog-protocol";
import { useHost as useCogHost } from "../../src/formats/lib/cog-reader";
import { pmtilesHost } from "../../src/formats/pmtiles";
import { useHost as usePmtilesHost } from "../../src/formats/lib/pmtiles";

useHost(cloudHost);
useCogHost(cogHost);
usePmtilesHost(pmtilesHost);
