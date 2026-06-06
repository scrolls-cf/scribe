---
target: inline spec detail phase rail
total_score: 37
p0_count: 0
p1_count: 0
p2_count: 0
timestamp: 2026-06-06T22-50-03Z
slug: public-index-html
---
# Critique: inline spec detail (phase rail refactor)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Sticky header keeps context while scrolling long specs |
| 2 | Match System / Real World | 4 | Ops vocabulary; markdown is primary content |
| 3 | User Control and Freedom | 4 | Re-click spec to close; Escape; hash nav |
| 4 | Consistency and Standards | 4 | Flat devscrolls rows; no pill/card chrome in rail |
| 5 | Error Prevention | 4 | Read-only |
| 6 | Recognition Rather Than Recall | 4 | Active phase via dot pulse + weight |
| 7 | Flexibility and Efficiency | 4 | Wider detail column; horizontal phase scroll |
| 8 | Aesthetic and Minimalist Design | 4 | Content-first; header compact |
| 9 | Error Recovery | 3 | Board banner |
| 10 | Help and Documentation | 3 | Toggle-close discoverability implicit |
| **Total** | | **37/40** | **Excellent** |

## Anti-Patterns

Not slop. Phase strip is functional, not decorative pills. Single-font warning is false positive.

## Fixes applied

- Sticky detail header with title + meta row
- Borderless horizontal phase strip (dot + label)
- Prose capped at 72ch for readability
- Wider center column when detail open
- Re-click selected spec to close detail
