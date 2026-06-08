# Scribe — Review loop live diff

## Users

- **Pipeline operator** — watches spec/plan evolve through ged review→refactor→re-review without leaving the board
- **Orchestrator parent agent** — confirms Gate C refactors landed in scribe before re-spawning review

## Purpose

Surface **which markdown lines changed** when a spec or plan body is patched during the ged-review-refactor-loop. Gate chips alone ("Review · Pending") do not show delta; this feature closes that gap.

## Personality

Operational, ledger-native, calm. Diff is diagnostic tooling — not celebration chrome. Fits existing devscrolls dark slate register.

## Principles

1. **Loop-scoped** — diff affordances appear during active review/refactor; de-emphasize after gates pass
2. **Etag truth** — each revision pair is anchored to scribe etags, not wall-clock guesses
3. **Client-side diff** — board fetches bodies; browser renders line changes (keeps DO light)
4. **Accessible** — contrast ≥ 4.5:1; `prefers-reduced-motion` disables animated diff reveal
5. **No git required** — operator never leaves scribe to understand a refactor

## Key flows

| Flow | Success |
| --- | --- |
| Spec 4a loop | After `patchSpec`, operator toggles **Show changes** and sees +/− lines vs prior body |
| Plan review loop | Same on `#plans/{id}` while plan `blocked` |
| List glance | Row shows **Δ +N −M** when `revisions_count > 0` and review pending |
| History | After `review_gate: passed`, last diff collapses to **History** disclosure |

## Out of scope (v1)

Full revision VCS, per-phase plan bodies, ged client changes, repo file diffs.
