---
target: public/index.html markdown spec body
total_score: 32
p0_count: 0
p1_count: 2
p2_count: 3
timestamp: 2026-06-06T22-24-34Z
slug: public-index-html
---
# Critique: public/index.html (markdown spec body)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading copy on all three panels; detail pane scrolls to top on open |
| 2 | Match System / Real World | 4 | Spec, phase, lock vocabulary matches devscrolls ops language |
| 3 | User Control and Freedom | 4 | Close spec, Escape, hash back/forward, `r` refresh |
| 4 | Consistency and Standards | 3 | Phases had a section label; spec body did not (fixed in polish) |
| 5 | Error Prevention | 4 | Read-only surface; no destructive affordances |
| 6 | Recognition Rather Than Recall | 3 | Agent markdown duplicated shell title as `# heading` (fixed: hide match) |
| 7 | Flexibility and Efficiency | 3 | Keyboard refresh and Escape; no documented shortcut hint |
| 8 | Aesthetic and Minimalist Design | 3 | Prose styles solid; inline detail was single-column stack on desktop |
| 9 | Error Recovery | 3 | Board-level error banner; detail load failure shows inline message |
| 10 | Help and Documentation | 2 | Intentionally minimal for operators; no inline glossary |
| **Total** | | **32/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment:** Not AI slop. Flat bordered rows, dark slate, no card grids or eyebrows. Markdown prose was the weak link: agent DESIGN.md paste looked unstyled and structurally confused (duplicate title, phases vs body hierarchy unclear on wide screens).

**Deterministic scan:** 1 warning on `public/index.html` line 23 (`single-font` / Sora only). **False positive** for product register: devscrolls uses one sans + mono by design.

**Browser visualization:** Skipped. Live server started on port 8400 but page requires scribe API; no authenticated production session available in this run. Source + detector only.

## Overall Impression

The board shell is mature. Agent markdown rendering was the gap: tables and tasks worked in HTML but the detail pane did not give the body equal structural weight to phases, and duplicate `# titles` from pasted specs cluttered the header zone.

## What's Working

- **Markdown renderer** handles frontmatter, tables, tasks, code fences without a heavy library.
- **Read-only ops tone** matches PRODUCT.md: scan status, drill in, no false CTAs.
- **Three-panel layout** keeps errors visible while reading a spec.

## Priority Issues

### [P1] Inline detail IA: phases and body competed vertically on desktop
- **Why:** Long DESIGN.md bodies pushed phases far down; operators scanning phase progress had to scroll past prose.
- **Fix:** Desktop two-column grid: phases left, spec body right (mirrors standalone spec detail pattern).
- **Suggested command:** `/impeccable layout public/index.html`

### [P1] Duplicate title when agents paste `# Title` matching shell
- **Why:** Shell already shows spec title; rendered h2 repeated it immediately below toolbar.
- **Fix:** Hide `.prose-title` when text matches `spec.title` (case-insensitive).
- **Suggested command:** `/impeccable polish public/assets/spec-view.js`

### [P2] Spec body lacked section label parity with Phases
- **Why:** Screen readers and visual scan relied on `aria-label` on a bare div; inconsistent with phases heading pattern.
- **Fix:** Add `Spec body` h3 + landmark section wrapper.
- **Suggested command:** `/impeccable clarify public/index.html`

### [P2] Task list state invisible to screen readers
- **Why:** Checkbox glyphs were `aria-hidden`; done/todo not announced.
- **Fix:** `aria-label="Completed|Incomplete: {text}"` on task rows.
- **Suggested command:** `/impeccable harden public/assets/markdown.js`

### [P2] Markdown links low affordance in dense prose
- **Why:** Links relied on color alone in long agent copy.
- **Fix:** Subtle underline with stronger hover.
- **Suggested command:** `/impeccable typeset public/assets/site.css`

## Persona Red Flags

**Alex (Power User):** Opening a spec with a 200-line DESIGN.md meant scrolling to see phase 3 status. Desktop column split addresses this.

**Sam (Accessibility):** Task items did not expose completion state to AT; empty body used muted gray below ideal contrast. Both addressed in polish pass.

**Riley (Stress Tester):** Pasting frontmatter + duplicate h1 + wide tables: renderer handled it, but duplicate title and unlabeled body section made the DOM look broken on inspection.

## Minor Observations

- Nested markdown lists still flatten (depth tracking incomplete).
- `single-font` detector warning should stay ignored for scribe.
- Production URL critique (34/40) predates markdown CSS; re-run after deploy.

## Questions to Consider

- Should completed specs show a collapsed phase summary above the body?
- Is `Spec body` the right label, or `Plan` / `Design` for agent vocabulary?
