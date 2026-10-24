---
"@maplibre-yaml/core": patch
---

GeoParquet files now open on servers that refuse every suffix range request but serve ordinary ones, such as `npx http-server`. The reader used to fall back to downloading the whole file there, and a large file was then refused as "too large" with the whole file's size wrongly described as the columns the map reads; it now asks for the file's last bytes by their offsets and reads only what the map needs, as on any other host. A file whose size a host hides from the page is described by its own size, with the header the host needs to send.
