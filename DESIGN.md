# Design System: Scribe (devscrolls)

## Overview

Operational planning dashboard on the devscrolls dark slate base. Full-width board: active specs (primary), inline spec detail (opens on select), errors rail (secondary). No marketing chrome.

## Layout

- **Default:** specs column + errors rail (edge to edge).
- **Detail open:** compact spec list | inline spec detail | errors rail.
- **Routing:** hash `#specs/{slug}` for drill-down without navigation; `/specs/{slug}` redirects to board hash.

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

- **App shell:** header (scribe wordmark + devscrolls), full-width board grid
- **Spec row:** title, slug, status pill, lock badge (agent id or Open), updated age
- **Inline spec detail:** sticky title row (status meta inline), readable markdown below
- **Errors panel:** scrollable list of unresolved errors with source, message, age
- **Empty states:** `—` for zero active specs; **Clear** for zero unresolved errors

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

**Spec**, **lock**, **errors board**. CSS prefixes: `scribe-`, `spec-`, `error-`. No **fleet**.
