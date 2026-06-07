# Design System: Scribe (devscrolls)

## Overview

Operational planning dashboard on the devscrolls dark slate base. **Ledger register** visual language: fine grid atmosphere, mono wordmark, elevated work-group cards, dot-status pills, reader pane with inset surface. Master/detail board unchanged in behavior. No marketing chrome.

## Layout

- **Default:** full-width work tree until a row is selected.
- **Detail open (desktop/tablet ≥769px):** compact work tree | detail content fills remaining width (prose is not capped at 72ch in the reader).
- **Narrow (≤768px):** work tree on top, detail below; when detail is open the tree caps at ~38vh and scrolls so implementations stay reachable above the reader.
- **Routing:** hash `#specs/{slug}` or `#plans/{id}` for drill-down without navigation; `/specs/{slug}` redirects to board hash.

## Colors

Inherit devscrolls tokens from scrollsmatrix (`devscrolls-tokens.css`).

| Role | Token | Value |
|------|-------|-------|
| Background | `--color-bg` | `oklch(0.238 0.019 262)` |
| Surface | `--color-surface` | `oklch(0.28 0.02 264)` |
| Surface raised | `--color-surface-raised` | `oklch(0.321 0.025 266)` |
| Ink | `--color-ink` | `oklch(0.885 0.017 251)` |
| Ink secondary | `--color-ink-secondary` | `oklch(0.72 0.022 250)` |
| Primary (cyan) | `--color-primary` | `oklch(0.823 0.075 209)` |
| Accent (violet) | `--color-accent` | `oklch(0.699 0.144 290)` |
| Muted | `--color-muted` | `oklch(0.58 0.025 255)` |
| Border | `--color-border` | `oklch(0.34 0.022 264)` |
| Success | `--color-success` | `oklch(0.72 0.14 155)` |
| Warning | `--color-warning` | `oklch(0.82 0.15 85)` |
| Error | `--color-error` | `oklch(0.65 0.18 25)` |

Strategy: restrained product UI on committed dark slate; cyan for links and primary actions, violet for emphasis, semantic colors for status only.

## Typography

Font: **Sora** (400, 600). Mono for slugs, agent ids, and error sources.

Scale: page title `clamp(1.5rem, 3vw, 2rem)`, spec titles `1.125rem`, body `1rem`, meta `0.875rem`.

## Components

- **App shell:** sticky blurred header, mono `scribe` mark + `devscrolls` platform pill, keyboard hint strip
- **Atmosphere:** 24px grid mask (not radial glow), surface elevation via `--shadow-raised`
- **Work tree:** spec groups as rounded cards (`work-group`); rows with rounded hit targets. Two row types — `work-row--spec` and `work-row--impl`. Implementations nest with indentation only. Detached groups use **Spec completed · {slug}** in mono. Detail open compacts tree rail.
- **Status:** pill + dot (`status-pill::before`); lock badges as mono capsules
- **Spec row:** title, slug, status pill; lock badge only when held (age in screen-reader label)
- **Implementation row:** indented, title, inline progress bar, status pill
- **Detail pane:** empty state when idle; breadcrumb (`spec › implementation`) when viewing an implementation; sticky title row, readable markdown below
- **Empty states:** `—` plus muted hint for zero active work

## Status language

| State | Label | Use |
|-------|-------|-----|
| `ready` | Ready | Spec saved, not started |
| `in_progress` | In progress | Active work |
| `blocked` | Blocked | Waiting on dependency or error |
| `done` | Done | Hidden from board; retrievable by slug or `?all=true` |

Locks: **Held by {agent}** or **Open**.

### Spec body (markdown)

Agent spec bodies are markdown (often pasted from DESIGN.md). The renderer strips YAML frontmatter, demotes `#` headings (title lives in the shell), supports tables, blockquotes, task lists, and fenced code. `TARGET` / `GOAL` / `SUCCESS` / `CONSTRAINTS` / `CONTEXT` lines render as labeled spec rows. Duplicate shell titles are hidden in the detail pane.

## Terminology

**Spec**, **implementation**, **lock**, **active work**. CSS prefixes: `scribe-`, `work-`, `spec-`. No **fleet**.
