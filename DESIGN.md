# Design system

Mode: Operate. Preserve the original macOS app’s warm, quiet sidebar/detail composition on all three desktop platforms. This migration retains the existing visual world.

## Tokens

The authoritative tokens are in `src/renderer/styles.css`: paper `#faf9f6`, sidebar `#f0efea`, surface `#ffffff`, ink `#282b25`, muted `#62665c`, rule `#dedfd6`, action accent `#a84e38`. Dark variants follow OS preference or the explicit appearance setting. Primary button text uses `--accent-ink` in each theme.

Use the native platform font stack for controls and headings; use monospace only for actual paths. Profile identity colors are terracotta, sage, blue, plum, amber and graphite. Icons are authored SVG strokes with a consistent weight; do not mix emoji into controls. The original vector mark uses two overlapping rounded rectangles and an arrow.

## Layout and states

A persistent profile rail sits beside a scrollable detail view. Desktop and Code actions are separate, each with a short explanation. Configuration paths are progressively disclosed. Native window chrome remains real. Dialogs reserve focus for editing, importing and configuration tasks.

The window has a desktop minimum width of 760px. Below 900px the sidebar narrows and action groups wrap. Buttons have visible keyboard focus, disabled and pressed states. Errors are textual and never indicated by color alone. Native dialogs and HTML dialog semantics provide focus containment. Custom spatial motion is limited to a one-pixel press and disabled for reduced-motion users.

Visual inspection of the new app is pending; source and automated checks do not constitute a screenshot review.
