---
target: public/index.html
total_score: 35
p0_count: 0
p1_count: 0
p2_count: 1
p3_count: 2
timestamp: 2026-06-06T22-45-00Z
slug: public-index-html
---
# Critique: public/index.html (post inline drill-down)

**Score: 35/40** — Strong operational dashboard.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading states, pills, phase bars, Clear vs idle empty |
| 2 | Match System / Real World | 4 | Spec/plan/lock vocabulary; lifecycle documented |
| 3 | User Control and Freedom | 4 | Inline drill-down, Escape, hash back/forward |
| 4 | Consistency and Standards | 4 | devscrolls tokens, wordmark, flat rows |
| 5 | Error Prevention | 3 | Read-only; no accidental mutation |
| 6 | Recognition Rather Than Recall | 4 | Status pills, lock badges, selected row |
| 7 | Flexibility and Efficiency | 3 | Keyboard refresh; no jump between errors and spec |
| 8 | Aesthetic and Minimalist Design | 4 | Full-width board, no card chrome |
| 9 | Error Recovery | 3 | banner-error for fetch failures |
| 10 | Help and Documentation | 3 | Empty semantics now in PRODUCT; no in-UI lifecycle hint |
| **Total** | | **35/40** | |

## Anti-Patterns

Deterministic: 1× `single-font` false positive (mono in CSS for slugs).

## Priority Issues

**[P2] Mock data auto-merges on localhost/workers.dev**
- Can mask real empty states during critique.
- Use `?mock=1` explicitly when previewing fixtures.

**[P3] No human archive for completed plans**
- By design for v1; direct slug/hash still works.
- Done notice added in detail pane.

**[P3] Errors empty vs specs empty used same em dash**
- Resolved: errors show **Clear**, specs show **—**.

## Product decisions (this loop)

| Question | Answer |
|----------|--------|
| No errors? | Errors rail stays; shows **Clear** (success, not hidden) |
| Spec → plan? | Agent adds phases via API; stays on active board |
| Plan complete? | Agent sets `done`; drops off board; remains in edge store |
| Human access to done? | `#specs/{slug}` read-only if slug known; no archive list |

## Ship note

35/40 with documented lifecycle. Next: link errors to related spec slug when API exposes it.
