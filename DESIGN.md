# Design System

## Overall Style

Collie uses a clear product UI: white by default, white page surfaces, white panels, Deep Navy text and shell areas, Collie Blue trust accents, Water Blue supporting highlights, and Outback Orange for energy, attention, calls to action, and phishing/email cues. The admin app does not use beige surfaces.

## Colour

- Deep Navy: `#0D1B2A`, primary text, logo outline, dark UI.
- Collie White: `#FCFDFF`, white panels and high-contrast neutral.
- Outback Orange: `#F26A21`, hook, lure, phishing or email accent, used sparingly.
- Sandstone: `#F4C27A`, brand asset colour only. Do not use it as an admin app surface.
- Collie Blue: `#1E3A8A`, trust, confidence, links, accents.
- Water Blue: `#38BDF8`, fresh supporting highlights.
- Eucalyptus Green: `#2E7D32`, balance, safety, success states, progress.
- Light Cloud: `#F2F6FA`, clean backgrounds and surfaces.
- Slate: `#64748B`, muted text, dividers, secondary UI.

Prefer OKLCH tokens in CSS, with these hex values as brand anchors. Reserve red for critical alerts only.

## Typography

Use Geist Sans or Inter for product UI, with Geist Mono for technical IDs, tokens, and code-like values. Keep product headings compact and purposeful. Do not use display fonts in labels, buttons, data tables, or dense admin views.

## Components

Use shadcn/ui conventions and familiar product patterns: side navigation, top bar, breadcrumbs, tabs, data tables, forms, segmented controls, and skeleton loading states. Cards are for repeated items, modals, and framed tools, not entire page sections. Avoid nested cards.

## Layout

Authenticated app screens use a stable sidebar plus a top utility bar on desktop, collapsing to mobile navigation on smaller screens. Tables should prioritise scanning and bulk action. Forms should use clear grouping, short help text, and kind validation messages.

## Copy

Use Australian spelling. Avoid em dashes, corporate filler, "leverage", "robust", "you failed", "caught", and gotcha language. Error states and training moments should be direct, calm, and useful.

## Motion

Use subtle 150-250 ms transitions for state changes, disclosure, and loading only. Respect reduced motion. Do not animate layout properties or add decorative motion.
