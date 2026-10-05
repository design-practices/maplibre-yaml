# Font-faces fixture

Subsets of two Noto fonts, served same-origin so the
`style-labels-with-font-faces` twin (`examples/gallery/configs/`) and its
browser test (`e2e/gallery-u18.spec.ts`) exercise `font-faces` without the
network. The docs page loads the full fonts from jsDelivr, as upstream does.

| File | Source | Kept |
|---|---|---|
| `NotoSansGeorgian-subset.ttf` | `NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf` (notofonts.github.io) | the glyphs of თბილისი, ბათუმი |
| `NotoSansArmenian-subset.ttf` | `NotoSansArmenian/hinted/ttf/NotoSansArmenian-Regular.ttf` (notofonts.github.io) | the glyphs of Երևան, Գյումրի |

Made with fontTools:

```sh
pyftsubset NotoSansGeorgian-Regular.ttf --text="თბილისიბათუმი" --output-file=NotoSansGeorgian-subset.ttf
pyftsubset NotoSansArmenian-Regular.ttf --text="ԵրևանԳյումրի" --output-file=NotoSansArmenian-subset.ttf
```

## Licence

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/georgian,
https://github.com/notofonts/armenian). Licensed under the SIL Open Font
License 1.1 — see `OFL.txt`. These subsets are Modified Versions under the
OFL and are distributed under the same licence.
