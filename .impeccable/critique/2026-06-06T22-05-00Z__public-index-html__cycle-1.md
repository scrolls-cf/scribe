---
target: public/index.html
total_score: 31
p0_count: 0
p1_count: 0
p2_count: 1
p3_count: 1
timestamp: 2026-06-06T22-05-00Z
slug: public-index-html
cycle: 1
---
# Critique cycle 1 — after shape + polish

**Score: 31/40**

## Changes applied

- Removed footer from board and spec detail
- Stripped Mark resolved, lock acquire/release, Mark phase done
- Empty states collapsed to em dash
- Added `r` keyboard refresh on board
- Read-only spec toolbar (status, updated, lock badge)

## Heuristic delta

| Heuristic | Was | Now | Note |
|-----------|-----|-----|------|
| User control | 3 | 3 | Navigation-only; refresh via keyboard |
| Minimalist design | 3 | 4 | Footer and action chrome removed |
| Flexibility | 2 | 3 | Keyboard refresh added |

## Remaining

- [P2] Spec detail title scale still slightly below board wordmark weight
- [P3] Error panel lacks spec deep-link when source maps to slug
