# Design System: Scribe (devscrolls)

## Overview

Operational planning dashboard on the devscrolls dark slate base. Two-column layout on wide viewports: active specs (primary) and errors board (secondary). Spec detail expands inline or on a dedicated route. No marketing chrome.

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

- **App shell:** header (scribe + devscrolls mark), two-column main, footer utilities
- **Spec card:** title, slug, status pill, phase progress bar, lock badge (agent id or "open")
- **Phase list:** ordered steps with per-phase status (pending / active / done)
- **Errors panel:** scrollable list of unresolved errors with source, message, age
- **Spec detail:** markdown body, phase controls, lock acquire/release, status transitions
- **Empty states:** em dash for zero specs or zero errors

## Status language

| State | Label | Use |
|-------|-------|-----|
| `ready` | Ready | Spec saved, not started |
| `in_progress` | In progress | Active work |
| `blocked` | Blocked | Waiting on dependency or error |
| `done` | Done | Hidden from board |

Locks: **Held by {agent}** or **Open**.

## Terminology

**Spec**, **plan**, **phase**, **errors board**. CSS prefixes: `scribe-`, `spec-`, `error-`. No **fleet**.
