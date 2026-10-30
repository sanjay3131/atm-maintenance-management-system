# Using the ATM application's design tokens

The existing design system is authoritative. This guide describes how to apply it; it does not define a replacement palette, spacing scale, component library, or portal theme.

## Sources of truth

- Shared semantic CSS variables, Geist typography, radius, dark-mode values, chart/sidebar roles, and employee portal overrides are defined in `frontend/src/index.css`.
- Reusable shadcn/ui `base-nova` components and project UI conventions live under `frontend/src/components/ui`.
- Tailwind CSS 4 utilities are used directly in the frontend. Follow the patterns already present in the target screen and neighboring screens.
- Portal layouts may have their own established surface and interaction conventions. Inspect the relevant Admin, Employee, Supervisor, or Customer layout before changing shell styling.

## Application rules

- Prefer semantic utilities such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `text-destructive` where they match the existing screen. Use the corresponding project-defined CSS variables when a utility is not suitable.
- Reuse existing classes, component variants, and local semantic status mappings. Do not introduce arbitrary hex colors, duplicate CSS variables, or a new token file for a one-screen polish.
- Status, priority, error, warning, completion, and chart-series colors carry information. Preserve their established meanings and ensure they remain legible in light/dark mode.
- Keep the Geist font and existing typography hierarchy. Do not add a font dependency or replace typography globally as part of a screen-level adjustment.
- Use the existing spacing, responsive, radius, and shadow utilities found in the target screen. Consistency between related controls and sections matters more than imposing a new numeric scale.
- Use existing Lucide icons and shared button, card, badge, dialog, and select components where appropriate. Avoid one-off replacements that create inconsistent interaction or accessibility behavior.
- Keep visible focus treatment, sufficient contrast, semantic HTML, and reduced-motion behavior. A color adjustment must not remove meaning conveyed by a status or control.
- Respect the employee portal's existing blue/teal-oriented theme and English/Tamil support. Verify longer Tamil labels do not overflow after typography or spacing changes.

## When a token seems missing

First check whether an existing semantic variable or component variant already expresses the needed role. If no suitable token exists, keep the change local and consistent with the nearest established pattern; explain the gap in the report. Do not silently add or globally redefine tokens during a visual-polish task.

