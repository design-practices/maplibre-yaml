/**
 * The FlatGeobuf and GeoParquet readers live in their on-demand chunks
 * (formats/lib/, bundle headroom U5) and use core through the host the main
 * bundle hands each chunk as it loads (`cloudReaders`). A test that calls a
 * reader's module directly imports this first: it hands over the same host.
 */
import { cloudHost } from "../../src/renderer/cloud-sources";
import { useHost } from "../../src/formats/lib/cloud-reader";

useHost(cloudHost);
