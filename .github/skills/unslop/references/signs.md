# Visual audit signs for ATM operations

Use these as prompts for a screen-specific audit, not as a mandate to replace the application's design. Record only issues that are visible and meaningful for the requested screen. Pair each finding with its location and a restrained visual improvement.

## Surfaces and color

- Decorative gradients, glows, blurred blobs, or neon borders compete with operational data → simplify the decoration and use existing neutral surfaces.
- A color is used inconsistently for the same status, or color alone conveys a status → preserve the established semantic status mapping and add or retain readable text/icon cues.
- Too many competing accent colors obscure the primary action or key information → reduce non-semantic emphasis while keeping status, priority, and chart-series distinctions meaningful.
- Hard-coded colors conflict with semantic theme variables or dark mode → prefer the existing CSS variables and project tokens.
- Low contrast makes text, controls, or focus indicators difficult to see → correct contrast without weakening status meaning or keyboard visibility.

## Type and content hierarchy

- Many sizes, weights, or emphases make the page title, section labels, and data difficult to scan → clarify hierarchy using existing typography conventions.
- Dense labels, all-caps decoration, or gratuitous tracking reduce readability → use concise, readable labels without changing their meaning.
- Numbers, dates, units, or identifiers use inconsistent formatting → align presentation while preserving actual values and required local conventions.
- Tiny secondary text or clipped labels are difficult to read, especially on mobile or in Tamil → improve sizing, wrapping, and available space; do not truncate essential information.
- Greetings, exclamation marks, or generic promotional copy displace a useful operational heading → make the heading describe the current screen or task without inventing claims or facts.

## Spacing and alignment

- Sibling cards, fields, rows, or actions have inconsistent spacing or alignment → align equivalent elements with the existing spacing utilities.
- Groups are visually ambiguous or page sections crowd one another → distinguish within-group spacing from section spacing.
- Content is cramped, overflowing, or clipped at a supported viewport → fix the layout without hiding controls or information.
- Dense tables have insufficient row separation or awkward alignment → improve scanability while retaining columns, filters, and actions.

## Icons, badges, and components

- Emoji or decorative icons are used as controls, navigation, or status → prefer the existing Lucide icon convention or clear text; retain meaningful status labels.
- Icons vary arbitrarily in size, stroke, color, or alignment → normalize to the existing icon usage for that screen.
- Repeated pills, badges, shadows, or card treatments compete for attention → reserve emphasis for actual state and hierarchy.
- Charts use decorative effects or colors that make series/status meaning unclear → retain distinct, labeled series and the product's semantic colors.
- A loading, error, empty, disabled, or selected state is visually indistinguishable → clarify the state while preserving its existing behavior and accessible announcement.

## Motion and interaction

- Decorative looping or bouncy motion distracts from work or ignores reduced-motion preference → remove or tone down only nonessential motion, respecting the existing reduced-motion handling.
- Hover is the only indication that an element is interactive → provide visible focus and appropriate persistent states.
- Focus is missing, clipped, or low-contrast → retain or improve a visible keyboard focus indicator.
- Touch targets or mobile navigation are difficult to use → improve target spacing and responsive presentation without changing the navigation or workflow.
- Loading animation is shown for an element that is not loading → avoid falsely suggesting live activity.

## Operational-screen checks

- A visual simplification removes a metric, field, filter, column, button, alert, or action → do not make that change.
- A visual redesign changes a status color, priority distinction, ownership cue, or warning hierarchy → preserve the information semantics and existing mappings.
- A change would alter route, data access, authorization, or workflow → it is outside visual-polish scope; stop and seek separate authorization.
- A portal looks inconsistent because it serves a different role or device context → respect its existing layout and role instead of forcing every portal into one template.
