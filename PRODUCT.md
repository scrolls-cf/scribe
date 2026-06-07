# Product

## Register

product

## Users

devscrolls developers and composer agents operating behind Cloudflare Access on the scrollsmatrix gateway. They check what design specs are in flight, which agent holds a lock, and org-wide errors that still need attention.

## Product Purpose

Scribe is the edge store for design specs and the matrix service registry. The crafted surface is a planning dashboard: active specs show status and agent locks so only one agent works a spec at a time. An errors board surfaces unaddressed failures across the org repo. Completed specs drop off the board. Success means a visitor sees accurate in-flight work, cannot double-pick a locked spec, and can read each spec as the agent wrote it.

## Brand Personality

Focused, operational, trustworthy. devscrolls family: minimal chrome, status you can scan, no marketing prose.

## Anti-references

- SaaS dashboard templates (sidebar, metric cards, identical feature grids)
- Notion or docs clones with heavy chrome
- Marketing landing pages with hero sections and eyebrows
- Completed or stale work cluttering the active board

## Design Principles

1. **Active work only** — the board shows specs that still need attention; done specs disappear.
2. **One agent per spec** — locks are visible and enforceable; status reflects who holds the work.
3. **Spec is the draft** — the markdown body is the source of truth; detail shows title, meta, and prose as written. Spec rows on the board show status and locks only — no progress. Step and phase progress belong to implementations only.
4. **Errors are first-class** — unresolved org errors sit beside specs, not buried in logs.
5. **devscrolls continuity** — same palette and type as scrollsmatrix; Scribe reads as part of the platform.

## Spec lifecycle

| Stage | API status | On the board? | Where it lives |
|-------|------------|---------------|----------------|
| Spec saved | `ready` | Yes | Active specs list |
| Agent holds lock | `ready` (lock set) | Yes | Lock badge shows holder; status stays Ready |
| Blocked | `blocked` | Yes | Active specs list |
| Complete | `done` | **No** | Scribe edge store only |

A **spec** is a rough draft (markdown body plus API metadata). It stays on the board until an agent sets status to `done`. Humans never archive or resolve from the UI; they read active work and drill into detail. A direct link (`#specs/{slug}`) still loads a completed record for read-only review.

## Board semantics

| Concept | API term | Human label | On the board |
|---------|----------|-------------|--------------|
| Feature draft | `spec` | Spec | Title, slug, lock, status, age — **no progress** |
| Execution plan | `plan` | Implementation | Nested under parent spec; progress bar and active step only here |

**Flow:** an agent claims a spec (lock) → uploads an implementation (`plan`) → agents update step/phase progress on that implementation. Locks on specs prevent double-pick; implementation locks are rare and shown only when set.

**Active work count:** **1 spec = 1 active work** in the heading badge. Nested implementations do not increase the count. Detached groups (spec completed, implementation still in flight) count as one unit per completed spec slug.

**Layout:** persistent work tree (left) lists specs and nested implementations; detail pane (center) is always visible with an empty state when nothing is selected; errors rail (right) appears only when unresolved failures exist.

**Detached implementations:** when a parent spec is complete and off the board, its in-flight implementations appear under a muted **Spec completed · {slug}** group.

**Terminology:** dashboard section **Active work**; child rows labeled **Implementation** in the tree. API fields `plan` and `phase` remain agent vocabulary — not used in human headings.

## Empty board semantics

| Panel | Empty display | Meaning |
|-------|---------------|---------|
| Active work | `—` | Nothing in flight (no queued work, or all work completed) |
| Errors board | Hidden | No unresolved org failures; the rail appears only when errors exist |

Empty states are not CTAs. Agents create specs, update status, resolve errors, and mark completion through the API.

## Accessibility & Inclusion

Standard best practices: semantic landmarks, visible focus, status not conveyed by color alone, `prefers-reduced-motion` respected. Body text meets WCAG 2.1 AA contrast on devscrolls dark surfaces.

## Deployed surface (canonical)

| Item | Value |
|------|--------|
| Board URL | `https://scrollsmatrix.jvalamis.workers.dev/scribe/` |
| Routing | scrollsmatrix `SCRIBE` service binding — scribe has `workers_dev: false` |
| Auth | Cloudflare Access (`devscrolls.cloudflareaccess.com`) |

**Agents:** `npm run scribe:snapshot` from agents repo (uses `cloudflared access login` or `CF_ACCESS_*` in `.env`). Impeccable critique targets this URL, not local-only assets.

**Wrangler gateway (production bindings, no Access UI):** `cd worktrees/scrollsmatrix && npx wrangler dev --port 8790` → `http://127.0.0.1:8790/scribe/` hits the same deployed scribe worker via service binding.

## Terminology

Use **spec**, **implementation**, **lock**, **errors board**, **active work**. Brand name **devscrolls** (lowercase) when referring to the platform. Service name **scribe** (lowercase) for this Worker. **Phase** and **plan** are agent API terms only; the dashboard says **implementation** for child work rows.
