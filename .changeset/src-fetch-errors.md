---
"@maplibre-yaml/core": patch
---

When `<ml-map src="…">` can't load its YAML, the error card now says what to do. On a page opened straight from disk (`file://`) it says the page must be served by a local web server and suggests `npx serve .` or VS Code's Live Server, instead of "Failed to fetch". The same applies when maplibre-gl 6 can't start its worker on a `file://` page, where the old card's `setWorkerUrl()` advice was wrong. A 404 or other HTTP error shows the full URL the browser requested, so a path that resolved against the wrong folder is visible. A wrong path that a dev server or host answers with its HTML index page (status 200) is reported as "src= points at an HTML page, not a YAML file — the path is probably wrong", not as a YAML syntax error about `<!doctype html>`. Error cards now show the YAML line number of each validation error and keep a syntax error's code excerpt readable. They also use `role="alert"`.
