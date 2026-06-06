---
target: public/index.html
total_score: 29
p0_count: 0
p1_count: 0
timestamp: 2026-06-06T21-36-44Z
slug: public-index-html
---
---
target: public/index.html
total_score: 29
p0_count: 0
p1_count: 0
p2_count: 2
p3_count: 2
timestamp: 2026-06-06T21:45:00Z
slug: public-index-html
---
# Critique: public/index.html

Target: scribe planning dashboard (`public/`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading copy, `aria-busy`, status pills, phase bars |
| 2 | Match System / Real World | 3 | Spec/plan/lock vocabulary fits devscrolls audience |
| 3 | User Control and Freedom | 3 | Spec detail back link; no traps on board |
| 4 | Consistency and Standards | 3 | devscrolls tokens, Sora, matches DESIGN.md components |
| 5 | Error Prevention | 3 | Read-heavy board; low input risk |
| 6 | Recognition Rather Than Recall | 3 | Status pills and lock badges visible on cards |
| 7 | Flexibility and Efficiency | 2 | No keyboard refresh or bulk actions |
| 8 | Aesthetic and Minimalist Design | 3 | Dashboard structure appropriate; ambient glow was noisy on type (fixed this run) |
| 9 | Error Recovery | 3 | `banner-error` alert region |
| 10 | Help and Documentation | 2 | Empty-state hints help; no contextual help on cards |
| **Total** | | **29/40** | **Good — solid operational dashboard foundation** |

**Cognitive load:** 1 checklist failure (two-column board plus card meta is dense but appropriate for power users). Low-to-moderate for the task.

## Anti-Patterns Verdict

**LLM assessment:** Reads as a purposeful product dashboard, not a marketing splash clone. Spec cards, status pills, phase progress, and errors panel match PRODUCT.md. devscrolls palette continuity without SaaS metric-card grids. Not AI slop.

**Deterministic scan:** 2 `single-font` warnings on `public/index.html` and `public/spec/index.html`. False positive for product register: mono is used for slugs, locks, and error sources in CSS; Sora-only for UI labels is intentional per DESIGN.md.

**Browser visualization:** Skipped — Chrome DevTools MCP unavailable.

## Overall Impression

The board is structurally right for scribe: active specs primary, errors secondary, cards carry the operational metadata agents need. The main annoyance was ambient cyan/violet washes painted on `body`, which bled through open text areas. That is now toned down to a fixed, low-opacity layer behind content.

## What's Working

1. **Dashboard fidelity** — Spec cards expose title, slug, status, lock, and phase progress in one scan.
2. **devscrolls continuity** — Shared tokens, Sora, logo mark, dark slate base align with scrollsmatrix family.
3. **Status communication** — Pills, lock badges, and `aria-label` on spec links support recognition over recall.

## Priority Issues

**[P2] Ambient background competed with text** (addressed this run)
- **Why:** Radial gradients on `body` at 14%/12% opacity washed over headings and panel copy.
- **Fix:** Move washes to `body::before` at ~7%/5% opacity; keep ink on solid `--color-bg`.
- **Command:** `/impeccable quieter public/` if still too bright

**[P2] No power-user refresh**
- **Why:** Board reload requires full page refresh.
- **Fix:** Optional `r` keyboard refresh (like scrollsmatrix) or subtle reload control in header.
- **Command:** `/impeccable harden public/`

**[P3] Footer competes with board focus**
- **Why:** Utility links and hostname add chrome below operational content.
- **Fix:** Collapse to minimal inline utils or drop hostname if redundant behind Access.
- **Command:** `/impeccable distill public/`

**[P3] Spec detail page header lighter than board**
- **Why:** `spec/index.html` uses smaller title treatment; continuity gap when drilling in.
- **Fix:** Align header scale and spacing with board shell.
- **Command:** `/impeccable polish public/spec/`

## Persona Red Flags

**Alex (Power User):** Cannot refresh spec list without reload. Card meta is good for scanning but no keyboard jump between specs.

**Jordan (First-Timer):** Status pill colors need prior infra knowledge; empty-state hints help but API path in hint is dense.

**Sam (Accessibility):** Status pills include text labels; focus-visible present. Color carries status on pills but text backup exists.

## Minor Observations

- Logo hover glow removed this run to reduce decorative light on chrome.
- `panel-count` badge uses primary dim background; fine for dashboard emphasis.

## Questions to Consider

- Should empty states stay instructional (product register) or collapse to em dash like scrollsmatrix splash?
- Is 29/40 the ship bar, or push phase controls and lock actions onto the board cards?
