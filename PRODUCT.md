# Product

## Register

product

## Users

devscrolls developers and composer agents operating behind Cloudflare Access on the scrollsmatrix gateway. They check what design specs are in flight, which agent holds a lock, phase progress, and org-wide errors that still need attention.

## Product Purpose

Scribe is the edge store for design specs and the matrix service registry. The crafted surface is a planning dashboard: active specs become phased plans with status and agent locks so only one agent works a spec at a time. An errors board surfaces unaddressed failures across the org repo. Completed specs drop off the board. Success means a visitor sees accurate in-flight work, cannot double-pick a locked spec, and can update plan status as phases complete.

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
3. **Phases are the unit of progress** — each spec is a plan with phases; the UI updates status as phases move.
4. **Errors are first-class** — unresolved org errors sit beside specs, not buried in logs.
5. **devscrolls continuity** — same palette and type as scrollsmatrix; Scribe reads as part of the platform.

## Spec lifecycle

| Stage | API status | On the board? | Where it lives |
|-------|------------|---------------|----------------|
| Spec saved | `ready` | Yes | Active specs list |
| Plan in flight | `in_progress` or `blocked` | Yes | Active specs list; inline detail shows phases + markdown body |
| Complete | `done` | **No** | Scribe edge store only; agents use `GET .../specs/{slug}` or `GET .../specs?all=true` |

A **spec** becomes a **plan** when an agent assigns phases (via API). It stays on the board until an agent marks the final phase done and sets status to `done`. Humans never archive or resolve from the UI; they read active work and drill into detail. A direct link (`#specs/{slug}`) still loads a completed record for read-only review.

## Empty board semantics

| Panel | Empty display | Meaning |
|-------|---------------|---------|
| Active specs | `—` | Nothing in flight (no queued work, or all work completed) |
| Errors board | `Clear` | No unresolved org failures; panel stays visible as a structural anchor |

Empty states are not CTAs. Agents create specs, advance phases, resolve errors, and mark completion through the API.

## Accessibility & Inclusion

Standard best practices: semantic landmarks, visible focus, status not conveyed by color alone, `prefers-reduced-motion` respected. Body text meets WCAG 2.1 AA contrast on devscrolls dark surfaces.

## Terminology

Use **spec**, **plan**, **phase**, **lock**, **errors board**. Brand name **devscrolls** (lowercase) when referring to the platform. Service name **scribe** (lowercase) for this Worker.
