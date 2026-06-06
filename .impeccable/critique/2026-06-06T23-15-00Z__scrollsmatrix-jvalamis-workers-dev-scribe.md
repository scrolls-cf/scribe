---
target: https://scrollsmatrix.jvalamis.workers.dev/scribe/
total_score: 34
p0_count: 0
p1_count: 0
p2_count: 2
p3_count: 2
timestamp: 2026-06-06T23-15-00Z
slug: scrollsmatrix-jvalamis-workers-dev-scribe
deploy_commit: d06fa7f
---
# Critique: scrollsmatrix.jvalamis.workers.dev/scribe/

Target: live scribe board behind scrollsmatrix Access gateway.

## Inspection method

- **Browser:** Chrome DevTools MCP unavailable (no Chrome session).
- **Live fetch:** Cloudflare Access login page only (expected pre-auth).
- **Source + detector:** `public/` at deploy commit `d06fa7f`; local has uncommitted mock removal.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Loading copy, pills, Clear vs idle empty |
| 2 | Match System / Real World | 4 | Spec/plan/lock vocabulary fits devscrolls |
| 3 | User Control and Freedom | 4 | Inline drill-down, Escape, hash routing |
| 4 | Consistency and Standards | 4 | Wordmark + tokens align with scrollsmatrix family |
| 5 | Error Prevention | 3 | Read-only surface |
| 6 | Recognition Rather Than Recall | 4 | Status pills, lock badges, selected row |
| 7 | Flexibility and Efficiency | 3 | `r` refresh; no error-to-spec jump |
| 8 | Aesthetic and Minimalist Design | 4 | Full-width flat rows, no card chrome |
| 9 | Error Recovery | 3 | banner-error on fetch failure |
| 10 | Help and Documentation | 2 | Empty semantics not visible in UI; lifecycle in PRODUCT only |
| **Total** | | **34/40** | **Good** |

**Cognitive load:** Low for read-only scan task. Three-column detail mode adds density but appropriate for power users.

## Anti-Patterns Verdict

**LLM:** Purposeful operational dashboard, not SaaS template. devscrolls dark slate, wordmark, row board reads as platform-native.

**Deterministic scan:** 1× `single-font` on index.html (false positive: mono via CSS for slugs/sources).

**Browser overlay:** Skipped (Chrome unavailable; Access blocks unauthenticated fetch).

## What's Working

1. **Gateway fit** — `/scribe/` subpath with dynamic `<base>` resolves assets and API under scrollsmatrix.
2. **Read-only IA** — Active specs, inline plan detail, errors rail matches PRODUCT.
3. **Empty semantics** — `—` for idle specs, **Clear** for zero errors (once real data loads).

## Priority Issues

**[P2] Deployed build still ships mock fixtures (`d06fa7f`)**
- `mock-data.js` merges fake specs/errors on localhost/workers.dev hostnames.
- Masks true empty states on production hostname until removed and redeployed.
- **Fix:** Push mock removal, redeploy scribe/scrollsmatrix.

**[P2] Unauthenticated view is Access chrome, not scribe**
- Expected for this product; first-time visitors see GitHub login before board.
- No scribe branding on Access interstitial (Cloudflare default).

**[P3] No in-UI lifecycle hint**
- Done plans vanish from board with no archive link; only documented in PRODUCT.md.

**[P3] Errors not linked to related spec slug**
- Related highlight only when source string contains slug substring.

## Deployment note

Local working tree removes mocks (uncommitted). Live URL reflects `d06fa7f` until next push + deploy.

## Recommended next commands

- `/impeccable polish public/` after mock removal deploy
- `/impeccable harden public/` for subpath edge cases and empty API states
- `/impeccable clarify public/` if lifecycle should appear in UI copy
