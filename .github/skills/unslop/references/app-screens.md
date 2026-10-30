# Operational app-screen guidance

Use this reference when auditing or improving an existing dashboard, operational app screen, or data-dense responsive view. It supplements the unslop workflow; the existing design system, visual-only boundaries, and audit-and-approval gate remain authoritative.

## Audit the screen

- Identify the screen's operational purpose, the key information hierarchy, and the main user action. Check that the visual hierarchy helps users make the decisions or complete the work the screen actually supports.
- Improve readability and scanability without unnecessarily adding or removing information. Keep existing metrics, fields, actions, statuses, and their meanings.
- Review chart labels, axes, legends, contrast, and series distinctions. Review table headings, alignment, row density, and values so data is easy to compare without changing its semantics.
- Review loading, empty, zero-data, error, and disabled states as well as the populated screen.
- Evaluate phone, tablet, and desktop layouts. For mobile tables, preserve every field: use readable two-line rows or contained horizontal scrolling when appropriate. Do not hide important information or make the page itself scroll sideways.
- Check keyboard navigation, visible focus, accessible names, contrast, touch usability, and reduced-motion behavior.

## Project safeguards

These safeguards take priority over any general design preference:

- Make visual changes only. Preserve API calls, backend behavior, queries, mutations, and data semantics.
- Preserve authentication, authorization, roles, permissions, routes, job workflows, attendance, and GPS/location validation.
- Preserve employee English/Tamil support, translated content, and existing light/dark theme behavior.
- Preserve semantic status colours and meaningful chart-series distinctions. Continue using the existing Chart.js implementation; do not introduce a chart library or SVG chart system.
- Use existing `frontend/src/index.css` variables, Tailwind conventions, and shadcn/ui components. Do not create a parallel design system.
- Do not silently remove or hide fields, actions, statuses, information, or functionality. Avoid decorative UI that reduces operational clarity.
- Do not perform a complete redesign unless the user explicitly approves it. Audit first, report findings and a design direction, and obtain approval before editing unless implementation was explicitly authorized.
- Keep approved changes within the requested screen and necessary shared components. Do not make unrelated changes.
