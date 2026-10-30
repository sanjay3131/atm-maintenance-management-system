# Visual guidance for ATM operations screens

Apply visual polish to the actual workflow, content density, role, and device context. These are operational portals, not marketing pages. Keep the existing information architecture and functionality.

## Dashboards: Admin and Super Admin

- Make operational priorities, exceptions, and trend information easy to scan using the dashboard's existing metrics, chart semantics, and alert hierarchy.
- Retain every existing metric, status breakdown, activity item, link, and action. Improve alignment, grouping, and responsive card layout rather than removing data to create whitespace.
- Preserve semantic status and severity colors. Ensure charts have understandable labels and legends and do not rely on color alone.
- Admin and Super Admin currently share the admin route group and layout; do not infer or introduce separate access behavior as a visual change.

## ATM and job management

- Optimize tables and forms for repeated real-world scanning: clear headings, aligned values, readable statuses, consistent row rhythm, and sensible grouping.
- Preserve all columns, search and filter controls, pagination, form fields, validation feedback, and create/assign/edit actions.
- Make dense views responsive without silently hiding operational information. If a table needs horizontal scrolling or a compact presentation, retain access to every value and control.
- Keep identifiers, assignment details, due dates, priorities, and lifecycle statuses distinguishable. Do not alter data, labels with business meaning, or lifecycle order for visual simplicity.

## Employee mobile and field work

- Treat mobile usability and touch access as first-class. Keep actions reachable, content readable, and important status and job details visible at small widths.
- Preserve the existing employee navigation, field-work panels, location tasks, attendance, and AMC workflows.
- Support both English and Tamil. Allow for longer localized text and avoid fixed widths or truncation that hides instructions or actions.
- Preserve the employee portal's established theme, keyboard support, visible focus, and reduced-motion behavior.

## Supervisor portal

- Distinguish supervisor monitoring and team responsibilities from employee self-service and admin controls using the existing labels and layout.
- Keep employee, job, AMC, and attendance monitoring information and their current status meanings intact.
- Improve scanability and responsive grouping without changing assignments, available actions, or role boundaries.

## Customer portal

- Keep customer-facing ATM, service-history, AMC, report, and notification navigation familiar and accessible.
- Make account-relevant information clear without exposing or inventing operational details.
- Retain the current navigation at narrow widths and keep every customer action and record accessible.

## Forms, tables, and shared UI

- Preserve clear labels, required-field indications, validation and error messages, disabled and loading states, and confirmation context.
- Keep actions visually distinct by importance, but do not remove or silently reorder workflow actions.
- Reuse the project's shared controls and patterns so focus, keyboard, and interaction behavior stay consistent.
- Maintain readable contrast in light and dark themes. Status and priority remain understandable with text or accessible labels, not just color.

## Motion and visuals

- Keep motion purposeful, brief, and consistent with the existing interface. Honor `prefers-reduced-motion` and existing portal behavior.
- Operational dashboards and data-entry screens generally benefit more from clear real data, well-composed charts, and useful hierarchy than decorative imagery.
- Do not add generated or externally sourced imagery unless it supports a real screen purpose and the user explicitly approves the service, prompt, and any cost.
- Never run snapshot or story capture/video scripts automatically. Do not add scripts, screenshots, videos, or image assets as part of this adapted skill.

