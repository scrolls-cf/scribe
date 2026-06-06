---
target: public/index.html post markdown deploy
total_score: 36
p0_count: 0
p1_count: 0
p2_count: 0
timestamp: 2026-06-06T22-43-11Z
slug: public-index-html
---
# Critique: public/index.html (post markdown deploy)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading on all panels; related errors highlight when spec open |
| 2 | Match System / Real World | 4 | Spec/plan/lock/errors vocabulary |
| 3 | User Control and Freedom | 4 | Escape closes detail; focus returns to spec row |
| 4 | Consistency and Standards | 4 | Phases and Spec body sections match; devscrolls tokens |
| 5 | Error Prevention | 4 | Read-only board |
| 6 | Recognition Rather Than Recall | 4 | View spec on errors; duplicate markdown titles suppressed |
| 7 | Flexibility and Efficiency | 4 | r refresh, Escape, error-to-spec jump |
| 8 | Aesthetic and Minimalist Design | 4 | Flat rows, prose for agent markdown |
| 9 | Error Recovery | 3 | Board banner; detail load errors inline |
| 10 | Help and Documentation | 3 | aria-keyshortcuts on board; no visible shortcut legend |
| **Total** | | **36/40** | **Excellent** |

## Anti-Patterns Verdict

**LLM assessment:** Not AI slop. Operational dashboard with intentional restraint.

**Deterministic scan:** 1× `single-font` on Sora (false positive for product register).

**Browser:** Source review only; production behind Access.

## Overall Impression

Board is ship-ready. Remaining gap is cross-panel workflow polish, now largely closed with error linking and live related highlighting.

## What's Working

- Agent markdown rendering with tables, tasks, nested lists, external links.
- Three-panel layout with inline drill-down and hash routing.
- Empty semantics: **—** vs **Clear**.

## Priority Issues (fixed this pass)

### [P1] Related errors did not highlight until full refresh
- **Fix:** Re-render errors when opening/closing spec detail.

### [P1] Errors with spec slugs in source were not actionable
- **Fix:** Parse slug from source; **View spec** button opens inline detail.

### [P2] Closing spec left keyboard focus lost
- **Fix:** Return focus to the spec row button that opened detail.

### [P2] Nested markdown lists flattened
- **Fix:** Stack-based list renderer for nested ul/ol.

### [P2] External markdown links opened in same tab
- **Fix:** `target="_blank"` for http(s) links.

## Persona Red Flags

**Alex:** Can jump from lock-contention error to spec in one click.

**Sam:** Focus returns on close; task states and keyshortcuts exposed to AT.

## Minor Observations

- No human archive list for completed specs (by design).
- Visible keyboard shortcut hint still optional.
