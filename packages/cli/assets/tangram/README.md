# Tangram crosshatch source textures

Vendored verbatim, unmodified, from Mapzen's Tangram projects (MIT):

| File | Source |
|---|---|
| `hatch_0.png`, `hatch_2.png`, `normal-0031.jpg` | [tangrams/tangram-sandbox](https://github.com/tangrams/tangram-sandbox) `styles/imgs/` (crosshatch style by @patriciogv, 2015) |

`mlym bake crosshatch --out <dir>` (`src/lib/bake.ts`) derives the crosshatch
preset's ink-on-paper textures from these:

| Output | From |
|---|---|
| `earth.png` | `hatch_0.png`, ink-on-paper |
| `landuse.png` | `hatch_2.png`, ink-on-paper |
| `water.png` | `normal-0031.jpg`, lit on #343434 under Tangram's fixed lights |
| `building-fallback.png` | `hatch_0.png`, ink-on-paper (declared at pixelRatio 4) |

Tangram's crosshatch style itself is tangram-sandbox `styles/crosshatch.yaml`.
The tonal-hatch atlas (tangrams/blocks `filter/imgs/hatch.png`) belongs to the
runtime effect, not the static preset, so it is not vendored here.

## License (tangram-sandbox `LICENSE`, verbatim)

The MIT License (MIT)

Copyright (c) 2013-2019 Mapzen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
