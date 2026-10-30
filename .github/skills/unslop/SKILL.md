---
name: unslop
description: "Audit and visually polish an existing ATM Management System screen without changing its behavior. Use when asked to unslop, polish, refine, or visually redesign an admin, employee, supervisor, or customer screen."
---

# Unslop the ATM Management System UI

Adapted from Damir Sokolovsky's unslop workflow. Use it to improve visual craft while keeping the existing product, design system, operational information, and behavior intact. See [attribution and license](./ATTRIBUTION.md).

## When to use

Use for a specifically requested visual audit or polish of an existing React screen in this ATM Management System. Do not treat this skill as authorization to redesign other screens or change application behavior.

## Mandatory boundaries

- Make visual improvements only unless the user separately authorizes functional changes.
- Never modify the backend, APIs, database schemas, authentication, authorization, routes, business logic, or workflows during a visual-polish task.
- Never remove existing fields, buttons, filters, actions, metrics, or operational information to simplify the UI.
- Preserve semantic status colors and accessibility.
- Preserve English and Tamil language support, including the employee portal's translations and layout.
- Preserve responsive behavior, keyboard usability, visible focus states, and reduced-motion support.
- Do not introduce unnecessary dependencies or a parallel design-token system.
- Do not use paid image-generation services or other external services without the user's explicit approval.
- Do not run snapshot or story scripts automatically. This adapted skill does not include or require those scripts.
- Audit the requested screen first. Present the audit and a concise design direction, then wait for the user's approval before editing unless the user explicitly authorized implementation.
- Keep any approved changes limited to the requested screen and necessary shared components. Avoid changing shared components when a screen-local change is sufficient.
- Do not stage or commit changes.

If the user's request mixes visual polish with functional changes, clarify the functional scope and obtain separate authorization before making any functional change. If a proposed visual change would affect behavior or hide operational information, do not make that change without approval.

## Project conventions

- Use the existing React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui `base-nova`, TanStack Query 5, React Router 7, and Lucide conventions.
- Treat `frontend/src/index.css` as the source of shared semantic color, typography, radius, and portal-specific tokens. Reuse those CSS variables and existing Tailwind utilities.
- Prefer existing shared components under `frontend/src/components/ui` and existing feature components over new primitives.
- Respect the separate Admin, Employee, Supervisor, and Customer layouts and their role-specific information architecture.
- Keep existing data fetching, loading/error/empty states, form validation, actions, and status meaning unchanged.

## Workflow

1. **Scope and inspect.** Identify the exact requested screen, its layout, and any shared components it relies on. Read the relevant screen and existing styles before suggesting changes. Do not begin a broad portal-wide redesign.
2. **Audit what users see.** Inspect the rendered screen when a local preview is already available and safe to use; otherwise inspect the relevant code. List concrete visual issues with their locations. Do not start servers, capture authenticated or production data, or invoke scripts/services without explicit authorization.
3. **Propose a direction.** In a few lines, state the screen's operational purpose, the qualities the existing product should convey, and which visual areas to refine. Derive this from the actual workflow and current brand, not a generic template. Preserve established styling that is already working.
4. **Wait for approval.** Present the audit and direction and stop for approval before editing unless the user explicitly asked you to implement the visual changes in the current request. A request to inspect or recommend is not approval to edit.
5. **Make focused visual changes.** Improve only approved visual details: spacing, alignment, hierarchy, color application, typography, icon consistency, responsive presentation, and purposeful motion. Preserve all content and interactive affordances. Reuse existing tokens and components.
6. **Verify the requested screen.** Use the smallest relevant existing validation or safe visual check. Confirm the changes preserve content, behavior, responsive layouts, keyboard access, focus visibility, reduced motion, status semantics, and both employee languages where applicable. Do not run unrelated generators or external services.
7. **Report.** Summarize the visual changes and the validation performed. Mention any proposed improvement that was intentionally not made because it would require functional approval.

## Reference guidance

- Use [signs.md](./references/signs.md) to identify visual problems without treating every style choice as a defect.
- Use [tokens.md](./references/tokens.md) to apply the project's existing design tokens consistently.
- Use [visuals.md](./references/visuals.md) for role-aware guidance on operational dashboards, data-heavy screens, mobile interfaces, and portals.
- Use [app-screens.md](./references/app-screens.md) when auditing or redesigning an existing dashboard or operational app screen, or improving responsiveness in a data-dense screen. The existing unslop principles and audit-and-approval workflow remain authoritative.
