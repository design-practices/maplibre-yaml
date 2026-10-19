---
"@maplibre-yaml/core": patch
---

Reading a story with the keyboard now goes one chapter at a time. While a story is on screen, PageDown and Space (PageUp and Shift+Space back) scroll to the next (or previous) chapter and centre its card. Before, a screen-high page jump skipped the first chapter and left some cards cut off at the screen edges. Before the first chapter and after the last, and whenever focus is in a field, button or link, the keys scroll the page as usual. A chapter taller than the screen is read a screen at a time, from its top going forward and from its end going back, before the keys move on. Several quick presses step one chapter each, even while the page is still scrolling from the previous press.
