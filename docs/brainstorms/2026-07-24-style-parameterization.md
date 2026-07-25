# Style Parameterization: Data-Driven Extrusion Bases, `global-state`, and Scenarios

**Status:** design note / thinking document
**Scope:** maplibre-yaml (library) + mapparty (app)
**Driving case:** NYC underbuilt-potential demo map

---

## 0. Why this note exists

The demo case — showing built vs. unbuilt zoning potential as stacked extrusions — turns out to be a
good stress test for a question that has been open in maplibre-yaml for a while: **how much
computation belongs in the style document, and what does that imply for a GUI that has to author it?**

The specific feature (a data-driven `fill-extrusion-base`) is trivial. The interesting part is that
doing it *without* precomputing values into the tileset forces decisions about expression syntax,
binding scope, runtime-tunable parameters, and eventually named scenarios — each of which lands
partly in the library and partly in the app.

Use cases are not yet known. This document is therefore organized to **separate what's settled from
what's deferred**, and to note what would trigger each deferred decision.

---

## 1. Settled: the MapLibre substrate

Verified against the current style spec.

| Fact | Consequence |
|---|---|
| `fill-extrusion-base` is data-driven; supports feature-state and interpolate expressions | The core ask works, no shim needed |
| `fill-extrusion-base` requires `fill-extrusion-height` and must be ≤ it | Overbuilt parcels need explicit clamping |
| `fill-extrusion-opacity` is **per-layer only**, no data-driven styling | A translucent "potential" volume must be its own layer |
| Extrusions render sides + roof, no floor face | Floating volumes are hollow underneath; fine at normal pitch |
| `global-state` expression + `state` root property exist in the spec | Runtime tunables have a spec-native home, settable via `setGlobalStateProperty` |
| `state` carries defaults only — no label, range, or type metadata | Any control UI needs supplementary metadata elsewhere |

**Notes on the current runtime:** GL JS v6 is ESM-only and requires WebGL2. Fill extrusions are
unsupported under globe projection (irrelevant for a NYC map, relevant for the library's docs).

**Unverified, worth testing early:** whether changing a `global-state` value re-runs paint
transitions on a *data-driven* property, or snaps. Data-driven properties have historically not
transitioned smoothly. If a scenario change morphs the massing smoothly, that is the moment that
sells the whole feature; if it snaps, the demo needs a different beat.

---

## 2. The demo case, concretely

Extruding **lots** (not building footprints) is the right call, and not only for convenience: if you
extrude the lot polygon, floors ≈ FAR, so both the built mass and the zoning envelope live in
FAR-space and stack honestly. Footprint-based extrusion would require
`remaining_FAR × LotArea / footprint_area`, which balloons on small-footprint lots and stacks a
lot-derived quantity onto a footprint-derived base.

```yaml
state:
  floor_height: 3.5
  far_basis: residential

let:
  built: "={BuiltFAR} * @floor_height"
  cap: |
    =match(@far_basis,
      "residential", {ResidFAR},
      "commercial",  {CommFAR},
      "facility",    {FacilFAR}, 0) * @floor_height

layers:
  - id: built-mass
    paint:
      fill-extrusion-height: "=built"
      fill-extrusion-opacity: 1

  - id: unbuilt-potential
    paint:
      fill-extrusion-base:   "=min(built, cap)"
      fill-extrusion-height: "=max(built, cap)"
      fill-extrusion-opacity: 0.45
      fill-extrusion-color:  "=built > cap ? '#c0392b' : '#2e86c1'"
```

The `min`/`max` pair does double duty: it satisfies the base ≤ height constraint *and* renders
overbuilt (non-complying) parcels as a distinct cap above the envelope rather than breaking. NYC has
a lot of these; treating them as a feature rather than an error case is the honest move.

`match` on a state key is preferred over a dynamic property lookup — safer, validatable at compile
time, and more readable.

### 2.1 The performance envelope — and why it inverts the UI recommendation

Citywide MapPLUTO is on the order of 860k lots. Both extrusion layers draw from it.

Data-driven paint properties are evaluated per-feature and packed into vertex attribute buffers at
bucket build time, **not** per-frame. A `global-state` change therefore invalidates the paint arrays
for every loaded feature across both layers and forces a re-upload. At citywide extent this is
plausibly a stall rather than a transition.

**Consequence: discrete presets are cheaper than a continuous slider.** The scenario picker is the
better affordance for performance reasons as well as semantic ones (§4.4) — which is convenient,
because the continuous floor-height slider is the seductive demo control and probably the one that
feels worst.

If a continuous control is wanted anyway:

- Commit on release, not on drag.
- Put a zoom floor (~z14) on the extrusion layers so only visible tiles pay the re-evaluation cost.
- Consider coarse discrete steps, which degrade toward the preset case.

There is no global vertical-exaggeration escape hatch for extrusions (unlike terrain), so a scale
factor cannot avoid re-evaluation.

**Test this at citywide extent, not on a test neighborhood — the answer differs.**

---

## 3. Library implications (maplibre-yaml)

### 3.1 Proposed scope boundary for the expression DSL

This resolves the long-standing "general expression DSL scope" question:

> **The DSL is surface syntax over MapLibre expressions, never new semantics.** Every construct has a
> total, local desugaring to a MapLibre expression node.

In scope: infix arithmetic and comparison, ternary → `case`, `match`, `min`/`max`, interpolation,
property references, state references, `let` bindings.

Out of scope: user-defined functions, recursion, loops, anything requiring the compiler to *evaluate*
rather than *transform*.

This keeps erasability free rather than something to re-argue per feature — the compiler stays a
parser plus tree transform, never an interpreter.

### 3.2 Bake vs. express — the decision rule

> Express it only if it depends on something that changes at runtime.

A fixed formula over static columns should be a column in the PMTiles. A floor-height slider, a
FAR-basis toggle, or a bonus-scenario switch cannot be baked. For the demo the whole point is to
*not* bake, so this exercises the expression path deliberately — but the rule should be documented so
users don't reach for expressions where a data pipeline is correct and faster.

### 3.3 `let` scoping

`let`/`var` is already expression-scoped in MapLibre, so document-level bindings are pure sugar —
inline at the use site, or wrap each property value in its own `let`. Layer-level bindings shadowing
document-level ones is ordinary lexical scoping and compiles trivially.

**Recommendation:** support both scopes; shadowing is free and semantically unsurprising.

### 3.4 Layer-level `state` via name mangling

`global-state` reads from one flat root object, so there is no native layer scope. It can be
synthesized:

```yaml
layers:
  - id: unbuilt-potential
    state:
      floor_height: 4.0   # → ["global-state", "unbuilt-potential.floor_height"]
```

with the root `state` declaring the namespaced key and its default. Fully erasable; the name is just
compiler-generated.

**The catch is not semantic, it is UI:** a mangled key produces a *second control*. Shadowing
silently turns one slider into two. See §4.3.

### 3.5 A third erasability category, and where the library/app line falls

The existing split is compile-time sugar (`style:`) vs. runtime deviation (`runtime:`). Control
ranges, labels, exposure flags, and legend copy fit neither. Call this **inert authoring metadata** —
strip it and the map renders identically, it just loses its control panel and legend.

The `x-mapparty-*` convention already provides the mechanism, so the open question is not *where does
inert metadata live* but **which side of the library/app line the parameter schema falls on.**

Recommended seam:

- **Library owns the schema.** A `state` key's type, range, step, label, and default are a property of
  the parameter itself. Keeping them in the library means validation lives in one place, and it makes
  maplibre-yaml independently useful — any consumer gets auto-generated controls, not just mapparty.
  That is a real differentiator for the OSS side.
- **App owns the presentation.** Where a control appears, legend integration, picker styling, and
  preset grouping are `x-mapparty-*`.

Test for the seam: *would a second consumer of maplibre-yaml want this?* Range and label, yes.
"Render this in the legend panel below the swatches," no.

This distinction deserves an ADR alongside ADR-001.

### 3.6 Preset ownership — resolved

Presets are `x-mapparty-presets`, **but the library validates them.**

A preset is a named vector of assignments to `state` keys. The library declares and owns those keys,
so it is the only thing positioned to catch a preset referencing a key that does not exist, or a
value outside the declared range. The app owns the object; the library owns referential integrity.

Two consequences worth noting:

- A third party rendering the compiled style with vanilla MapLibre gets the declared defaults and no
  scenario switcher. That is correct graceful degradation and consistent with the erasability
  philosophy — the map is never *broken* by ignoring the extension.
- `x-mapparty-presets` becomes part of the published export contract (§4.5) and therefore needs
  versioning from the start.

### 3.7 Remaining library questions

- Does `@` for state and `{}` for feature properties hold up, or does it need a single sigil with
  namespacing?
- Should compile-time validation of property references against a declared source be part of the
  library (needs a tilejson/field inventory input) or the app? Leaning library, for the same reason
  as §3.6 — but it requires the library to accept a field inventory as compile input, which is new
  surface area.

---

## 4. App implications (mapparty)

### 4.1 The style document is already the control schema

If `state` declares the tunables, the app can generate the slider and radio group by reading it — no
per-map UI configuration. Ranges and labels come from the inert metadata of §3.5. This is close to
free and is the single highest-leverage consequence of the whole design.

### 4.2 Formula authoring surface

Recommend the **spreadsheet formula-bar model** over a structured node builder. The user base
(planners, agency staff) is Excel-fluent and will exceed a dropdown builder's ceiling within about two
operators. The `=` prefix already implies it.

To make it good:

- Field autocomplete from the tilejson `vector_layers[].fields` inventory PMTiles already carries.
- Compile-time validation that referenced properties exist in the declared source, so a typo'd
  `{BuitFAR}` is a squiggle rather than a silently invisible layer.

### 4.3 Binding and promotion

In a GUI the author never types the scope, so something must decide where a binding lands.

**Recommended model (Figma-like):** formulas create *layer-local* bindings by default; promoting to a
document binding is an explicit gesture. Once promoted, show "used in N layers" and warn on edit.
Shadowing then becomes deliberate rather than an accident of naming — which matters when the authors
are planners rather than people who read linter output.

This also resolves the §3.4 double-slider problem: a second control appears only when someone
explicitly asked for a second binding.

### 4.4 Scenarios / presets

A preset is `{id, label, values: {key: value}}` — a flat vector of values against declared state keys.

```yaml
presets:
  - id: baseline
    label: "As-of-right today"
    state: { floor_height: 3.5, far_basis: residential }
  - id: coy
    label: "With UAP bonus"
    state: { floor_height: 3.0, far_basis: residential, bonus: 1.2 }
```

**Presets set values; they must not carry paint patches.** If a scenario should change a color ramp,
declare the ramp as an expression over a state key and let the preset set that key. Reasons:

- One precedence chain instead of defining how a patch and a value interact on the same property.
- State-driven variation compiles to a valid style that renders correctly with defaults and needs no
  runtime shim; document patching needs a patch engine — a deviation, landing exactly on the
  published static bundle where it is least wanted.
- Patches over a concurrently-edited document create dangling references on layer rename. Values
  against declared keys validate cleanly, and stale keys are a droppable warning.

**Cost:** you cannot record a preset from arbitrary edits; variation must be anticipated. Absorb this
with tooling — "vary by scenario" lifts a literal into a state key and rewrites the property as an
expression over it. Mechanical, reversible.

**Hold one line hard:** a preset varies *parameters*, not *structure*. Adding or removing layers is a
different map, not a scenario. This is what keeps the picker from degenerating into a style switcher.

### 4.5 Storage and the publishing boundary

The DO is already the style store — collaborative editing operates on the style document, so "team
base settings" is just a field in a document already being synced. It inherits conflict semantics,
presence, and permissions for free. It is not a new sync scope.

The axis is therefore **not** local-vs-synced. It is **ephemeral vs. authored** — and everything
authored should serialize into the published artifact:

- Presets are authored in the DO but do not need to be *read* from it.
- A published map on `{team}.map-party.io` stays a static bundle: PMTiles plus a style doc carrying
  its own presets. Scenario switching works with no collaboration server, no auth, full edge caching.
- **Strategic consequence:** interactive scenario controls can ship on the free public tier without
  touching the closed-source sync engine. If base settings became a runtime overlay fetched at view
  time, the sync engine would land on the critical path of the free tier and the open-source boundary
  would start leaking.

### 4.6 Viewer-side controls

Extending the legend/info-panel model to controls mostly works, but breaks in three places:

1. **Info panels are read-only and transient; controls are state.** If a viewer moves a slider and
   shares the link, the recipient should see what they saw → URL serialization is required. This is
   also the deep-link story ("here's the 4m assumption" as a shareable URL).
2. **Not every state key should be public.** Some exist only to keep layers aligned. Exposure needs an
   explicit opt-in flag, defaulting to false.
3. **Bounds are a provenance question.** An unbounded slider on a published civic map lets a resident
   drag to 6m and screenshot something the author never claimed. Author-declared min/max plus a
   visible "modified from published view" state is the difference between a scenario tool and a
   misinformation vector. For a civic product this is a differentiator, not a nicety.

The legend thus becomes the map's public interface generally: what the colors mean *and* what you are
permitted to change.

### 4.7 Permissions asymmetry

Writing a preset is a team-scoped, authenticated act. Moving a slider is anonymous and unprivileged.
That asymmetry is the thing worth encoding explicitly — not a storage distinction.

---

## 5. State resolution

Single precedence chain:

```
declared default  →  active preset  →  URL diff
```

The URL carries a preset ref plus a diff, not a full state dump. Shorter, and it degrades: if a
preset has been deleted, fall back to default rather than rehydrating something broken.

Two rehydration rules, distinguishable in the same URL:

- **"I am viewing `coy`"** → re-resolve against the current preset definition. Team edits propagate.
- **"I explicitly set floor_height=4"** → the override wins over any subsequent change.

---

## 6. Demo build order

Sequenced so each step proves something and the risky bits surface early.

0. **Spike the state-change cost first.** Citywide lots, two extrusion layers, one
   `setGlobalStateProperty` call, measure. This gates the entire control design (§2.1) and is cheap
   to answer with a throwaway. Do not build the UI before knowing this.
1. **Bake nothing.** Lot polygons + raw MapPLUTO fields into PMTiles. Confirms the expression path is
   actually carrying the computation.
2. **Static two-layer extrusion** with hardcoded floor height. Proves the min/max clamp and that
   overbuilt parcels read correctly. Check `base` and `height` transitions separately — they may not
   behave alike, and a snap on one but not the other looks like a bug.
3. **Lift to `state`**, driven manually. Control type follows from step 0: picker if expensive,
   slider if not.
4. **Auto-generate the control from `state` + schema.** Proves §4.1, the highest-leverage claim.
5. **Add two presets and a picker.** Proves the values-not-patches model end to end.
6. **Publish to a static bundle** and confirm presets and controls work with no collaboration server
   in the loop. Proves §4.5.

Steps 1–4 are the library demo. Steps 5–6 are the app demo. If time is short, 1–4 still tells a
complete story.

### 6.1 What "impressive" requires, given the acquisition goal

The stated purpose is a public, high-visibility map that converts viewers into users. That adds
constraints the architecture above does not cover:

- **Cold-start impact.** It has to land before anyone touches a control, on mobile, at whatever
  extent the initial camera sets. The static frame does most of the work; interaction is the second
  beat.
- **The conversion mechanic is the source.** Since the app consumes the library directly, the map's
  entire definition *is* a readable YAML document. A "view style" affordance — the map beside the
  ~40 lines that produced it — is a stronger pitch than any feature list, and it costs almost
  nothing. This is the single highest-leverage acquisition idea in this document.
- **Shareable state is a growth loop, not a nicety.** The URL serialization in §5 is what makes a
  scenario screenshot traceable back to the map.
- **Mobile is the default surface** for anything that spreads. Extrusion-heavy citywide rendering on
  a mid-range phone is a real constraint and should be checked at step 0, not at launch.

---

## 7. Decision log

**Settled:**

- Expression DSL boundary — §3.1
- Bake vs. express rule — §3.2
- Library owns parameter schema, app owns presentation — §3.5
- Presets are `x-mapparty-presets`, validated by the library — §3.6
- Presets carry values, never patches — §4.4
- Presets serialize into the published artifact; DO is editing substrate, not runtime dependency — §4.5

**Gated on the step-0 spike:**

- Continuous slider vs. discrete picker — §2.1. Everything about the control UI waits on this number.
- Whether `base` and `height` transition alike under state change

**Decide during the build:**

- Whether the library or the app owns property-reference validation — §3.7
- Whether the scenario picker is a first-class map control or a legend row
- Sigil convention for state vs. feature properties — §3.7

**Defer (with triggers):**

| Question | Trigger |
|---|---|
| Are presets map-scoped or team-scoped? | A user wants portfolio-wide consistency. Team presets reference state keys that may not exist in every style — needs a validation story first |
| One scenario axis or several (collections + modes)? | A genuine 2×2 appears, e.g. scenario × appearance. Knowing the shape means a second axis is additive rather than a migration |
| Can viewers save a scenario back to a team? | Local-only is a style feature; saved is a data model. Cheaper to leave room now than retrofit |

Note that with no live project pulling on this, nothing external will force the deferred items. That
is an argument for holding them deferred rather than resolving them speculatively.

---

## 8. Caveats on the demo content itself

These stop being intellectual honesty and become reputational once the map is public and aimed at
traffic. A widely-shared NYC zoning map with soft FAR assumptions will be read as a capacity claim
and audited accordingly by an audience well equipped to do so. State the assumptions in the map, not
in a footnote:

- MapPLUTO's `ResidFAR` does not reflect inclusionary/UAP bonuses, Quality Housing options, or
  post-City-of-Yes changes. "Max FAR" is a modeling assumption, not a data fact.
- Underbuilt FAR ≠ developable capacity. Landmarks, co-op/condo ownership, lot geometry, and recent
  construction all matter. A demo should either filter obviously and say so, or label itself as
  illustrative.
- Floors ≈ FAR only holds for full lot coverage. It is a legible abstraction, not a massing proposal.

Being explicit about this is itself a good showcase of the provenance affordances in §4.6.