---
target: public/index.html
total_score: 37
p0_count: 0
p1_count: 0
timestamp: 2026-06-07T00-11-28Z
slug: public-index-html
---
# Critique: public/index.html (scribe board)

Target: scribe board after polish pass (mobile spec rail, DESIGN.md, sr-only empty hints).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading copy, status pills, Clear vs idle empty |
| 2 | Match System / Real World | 4 | Spec/lock vocabulary; draft detail |
| 3 | User Control and Freedom | 4 | Toggle-close, Escape, hash routing, r refresh |
| 4 | Consistency and Standards | 4 | Grid rail documented in DESIGN.md |
| 5 | Error Prevention | 3 | Read-only surface |
| 6 | Recognition Rather Than Recall | 4 | Right-rail meta scans quickly |
| 7 | Flexibility and Efficiency | 4 | Keyboard shortcuts, error spec links |
| 8 | Aesthetic and Minimalist Design | 4 | Grid rail density without card chrome |
| 9 | Error Recovery | 3 | banner-error on fetch failure |
| 10 | Help and Documentation | 3 | sr-only empty hints; sighted users still minimal |
| **Total** | | **37/40** | **Excellent** |

## Anti-Patterns Verdict

**LLM:** Operational dashboard, not AI SaaS template. Grid rail is purposeful information architecture.

**Deterministic scan:** 1× single-font (false positive: mono slugs/locks via CSS).

## What's Working

1. Spec grid rail stacks cleanly below 540px without crushing titles.
2. Detail-open compact list keeps focus on draft prose.
3. Screen readers get lifecycle context on empty states.

## Priority Issues

None P0/P1.

**[P2] Done specs invisible on board** — by design; optional archived link later.

**[P3] Sighted empty-state lifecycle** — `—` and **Clear** still terse; sr-only helps AT only.

## Polish applied this run

- Mobile breakpoint stacks spec row meta under title row.
- DESIGN.md documents grid rail layout.
- Expanded sr-only copy on spec and error empty states.
