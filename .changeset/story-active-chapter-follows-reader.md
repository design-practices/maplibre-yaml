---
"@maplibre-yaml/core": patch
---

Stories now always show the chapter you are reading. After scrolling back a little and forward again near a chapter boundary (a trackpad overshooting and correcting), the previous chapter could stay active, with the wrong camera and layers and the current card faded, until the reader scrolled into the next chapter. And on phones the map moved to the next chapter while its card was still below the screen. The active chapter is now worked out from the page's scroll position on every scroll: the chapter whose card is on screen and nearest the middle. This applies to `<ml-scrollytelling>` and the Astro `<Scrollytelling>`.
