---
target: public/index.html
total_score: 36
p0_count: 0
p1_count: 0
timestamp: 2026-06-07T00-11-20Z
slug: public-index-html
---
# Critique: public/index.html (scribe board)

Target: scribe planning dashboard after grid-rail spec row layout (post live cleanup).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading copy, status pills, Clear vs idle empty |
| 2 | Match System / Real World | 4 | Spec/lock vocabulary; draft detail, no plan scaffolding |
| 3 | User Control and Freedom | 4 | Toggle-close spec, Escape, hash routing, r refresh |
| 4 | Consistency and Standards | 4 | devscrolls tokens, flat rows, grid rail matches board density |
| 5 | Error Prevention | 3 | Read-only surface |
| 6 | Recognition Rather Than Recall | 4 | Status, lock, updated age on right rail |
| 7 | Flexibility and Efficiency | 4 | Keyboard shortcuts, error View spec links |
| 8 | Aesthetic and Minimalist Design | 4 | Grid rail separates identity from ops meta without cards |
| 9 | Error Recovery | 3 | banner-error on fetch failure |
| 10 | Help and Documentation | 2 | Done specs vanish; empty state semantics in docs only |
| **Total** | | **36/40** | **Good** |

## Anti-Patterns Verdict

**LLM:** Operational devscrolls dashboard. Grid rail is intentional density, not SaaS card grid. No phase timeline or hero metrics.

**Deterministic scan:** 1× single-font (false positive: Sora + mono via CSS for slugs).

## What's Working

1. Spec rows use a two-column grid rail: title/slug left, status + lock + age stacked right.
2. Detail-open mode compacts list to title-only; meta hidden until user closes detail.
3. Detail pane remains pure draft prose: title shell + markdown body.

## Priority Issues

None P0/P1.

**[P2] Narrow viewport spec rail** — below ~540px the two-column grid can squeeze title against right meta when the specs column is full width. Stack to single column on small screens.

**[P2] Done specs invisible on board** — by design; direct hash still works.

**[P3] No in-UI lifecycle hint** — empty `—` and **Clear** semantics live in PRODUCT.md only.

**[P3] DESIGN.md spec row** — still describes flat row, not grid rail layout.

## Persona Red Flags

**Alex (Power User):** r refresh and Escape work; no complaint on grid rail scan speed.

**Casey (Mobile):** Spec rail may feel cramped on phone-width viewports before adapt pass.

**Jordan (First-Timer):** Empty `—` with no visible hint that completed specs exist off-board.
