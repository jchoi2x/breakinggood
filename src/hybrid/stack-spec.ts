/** Stable id recorded in egress-manifest.json for generated hybrid projects. */
export const HYBRID_OUTPUT_STACK_ID = "vite-react-primereact-tailwind-v4";

/** Human-readable stack label (PrimeReact before Tailwind). */
export const HYBRID_OUTPUT_STACK_LABEL = "Vite + React 18 + PrimeReact + Tailwind CSS v4";

/**
 * UI layering policy: PrimeReact owns components; Tailwind is layout/spacing only.
 * Keep wording stable — tests assert this ordering and phrasing.
 */
export const HYBRID_UI_STACK_POLICY = [
  "PrimeReact-first: import UI primitives from `@primereact/ui` / `primereact` (Button, InputText, DataTable, Dialog, Menu, Panel, etc.) and wrap the app with PrimeReactProvider from `@primereact/core` + an `@primeuix/themes` preset in src/main.jsx.",
  "Tailwind second: use Tailwind CSS v4 only for spacing, layout (flex/grid), margins, padding, and custom utility classes on wrappers — not for replacing PrimeReact components.",
  "Never build buttons, inputs, selects, tables, dialogs, or menus from raw HTML or Tailwind-only patterns when a PrimeReact component exists.",
  "Do not use Tailwind UI / daisyUI-style component kits; PrimeReact is the component library.",
].join("\n");
