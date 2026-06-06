---
target: public/index.html
total_score: 36
p0_count: 0
p1_count: 0
timestamp: 2026-06-06T23-46-15Z
slug: public-index-html
---
# Critique: public/index.html (scribe board)

Target: scribe planning dashboard after spec-as-draft product update.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading copy, status pills, Clear vs idle empty |
| 2 | Match System / Real World | 4 | Spec/lock vocabulary; plan language removed from UI |
| 3 | User Control and Freedom | 4 | Toggle-close spec, Escape, hash routing, r refresh |
| 4 | Consistency and Standards | 4 | devscrolls tokens, wordmark, flat row board |
| 5 | Error Prevention | 3 | Read-only surface |
| 6 | Recognition Rather Than Recall | 4 | Status, lock, updated age on rows |
| 7 | Flexibility and Efficiency | 4 | Keyboard shortcuts, error View spec links |
| 8 | Aesthetic and Minimalist Design | 4 | Phase rails removed; board rows are title + meta only |
| 9 | Error Recovery | 3 | banner-error on fetch failure |
| 10 | Help and Documentation | 2 | Done specs vanish; lifecycle in PRODUCT only |
| **Total** | | **36/40** | **Good** |

## Anti-Patterns Verdict

**LLM:** Operational devscrolls dashboard. No SaaS card grid, no phase timeline scaffolding in detail or rows.

**Deterministic scan:** 1× single-font (false positive: Sora + mono via CSS for slugs).

## What's Working

1. Detail pane is pure draft prose: title shell + markdown body.
2. Board rows scan fast: status pill, lock, updated age only.
3. Error rail links to related spec when slug is parseable.

## Priority Issues

None P0/P1 after this pass.

**[P2] Done specs invisible on board** — by design; direct hash still works. Optional future: archived list link.

**[P3] No in-UI lifecycle hint** — empty `—` and **Clear** semantics live in PRODUCT.md only.

## Changes applied this run

- Removed phase progress bar and N/M phases from board rows.
- Removed phase rail CSS and dead phase-list styles.
- Updated loading copy (spec draft, not plan/phases).
- Aligned PRODUCT.md and DESIGN.md with spec-as-draft model.
