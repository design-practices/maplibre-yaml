---
"@maplibre-yaml/core": minor
---

Hover popups join click popups as a built-in: `hover.popup` shows a
chromeless preview while hovering a feature — deduped per feature entered,
not per mousemove — and dismisses when the pointer leaves. Coexistence is
part of the contract: with both `hover.popup` and `click.popup` on one
layer, a click pins the popup (close button included) and hover previews are
suppressed until it's dismissed. Touch devices never see hover popups (no
layer mousemove on touch); a tap opens the `click.popup`. Sources without
feature ids still work, keyed by geometry with a one-time console hint
(`generateId: true` gives exact tracking). For interaction hosts and
`attachInteractions` consumers, `InteractionDeps` gains `hidePopup` and
`showPopup` accepts `ShowPopupOptions` (`closeButton`/`closeOnClick`/`kind`)
— the pinned-vs-hover popup slot both built-in hosts now implement.
