---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

Add a deprecation warning channel, and deprecate the interaction `action` fields (schema-truthfulness U8).

`click.action`, `mouseenter.action`, and `mouseleave.action` are accepted by the schema but have never been dispatched at runtime. Rather than remove them and break existing documents, they now emit a deprecation warning naming the event to listen for instead, and are scheduled for removal in v2. The config still parses.

**core:** `ValidationWarning` gains `kind: "deprecation"`. The hardcoded legacy-refresh check is replaced by a deprecation table — `field` plus an `applies` predicate — so deprecating a field is a data change rather than another special case in the walk; the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` warnings fold into it unchanged and now carry the new kind. The rules are scoped to `interactive.{click,mouseenter,mouseleave}.action`, so scrollytelling chapter actions, which share the field name, are untouched.

**cli:** deprecations are exempt from strict promotion. `mlym validate` promotes warnings to errors under CI, and without this exemption 0.4.0 would hard-fail the build of every existing user of `click.action` on the release that deprecates it — defeating the point of a warning window. A new `--strict-deprecations` flag opts back in. The exemption is narrow: unknown-key and expression warnings still promote under CI exactly as before. The kind survives into both JSON output and the SARIF property bag, so deprecations are distinguishable in code-scanning results rather than only in message text.
