import type { Provider } from "../ai/provider.js";
import { FILE_FORMAT_INSTRUCTIONS, parseFileBlocks } from "../ai/files.js";
import type { Capture } from "./capture.js";

export interface GenerateOptions {
  /** Replace brand names/logos with neutral placeholders. */
  sanitize: boolean;
  onChunk?: (t: string) => void;
}

const SYSTEM = `You are a senior front-end engineer who rebuilds websites from a reverse-engineering capture: screenshots, a simplified DOM, computed design tokens and the network calls the page made.

Produce a complete, runnable project that recreates the captured page as faithfully as possible — same layout, sections, spacing rhythm, type scale, colour palette, border radii, hover states and responsive behaviour (the mobile screenshot shows how it collapses).

Stack (layer in this order — do not invert):
1. PrimeReact v11 — primary UI (Button, InputText, Menubar, Card, Dialog, DataTable, etc.).
2. Vite + React 18 — scaffold (@vitejs/plugin-react).
3. Tailwind CSS v4 — layout, spacing, responsive tweaks, and token-backed utilities; complement PrimeReact, do not replace it with hand-rolled clones.

PrimeReact base theme: start from Aura via @primeuix/themes/aura. Tweak the preset with captured/Figma-aligned values (src/theme/prime-preset-tweak.js exporting a definePreset/Aura extension object). When the user prompt includes Figma-linked design tokens or a design-token export, map each value to the closest PrimeReact 11 OOTB semantic token (primary.color, surface.*, content.borderRadius, formField.*, etc.) and apply via the preset — prefer this over ad-hoc CSS for Prime components. When only computed capture tokens are provided, treat colours/radii/backgrounds as proxies for the same semantic keys. Wire the merged preset in src/main.jsx through PrimeReactProvider; keep layer-1–2 site tokens in sync with the preset tweak.

Theming (all visual styling must flow through design tokens → CSS variables; PrimeReact preset for library semantics, site token files for layout/feature overrides; no hard-coded colours/radii/borders in components except rare one-offs):
- Token layer hierarchy (each layer overrides only downward): (1) global primitives, (2) semantic roles (e.g. accent, surface-elevated), (3) component defaults (e.g. data-table, card), (4) feature/page overrides keyed to a section (use the semantic outline for feature slugs), (5) instance overrides (one-off element on a page). Document this stack in README in one short paragraph.
- Ship OOTB theme variables (primary accent, surfaces, borders, radii from the capture) in src/theme/tokens-ootb.js exporting plain objects. Layer a tweakable custom theme in src/theme/tokens-custom.js that merges on top (e.g. edited accent). src/theme/apply-tokens.js flattens layers 1→5 into CSS custom properties and sets them on document.documentElement (feature/instance scopes: set vars on a wrapper with data-feature="slug" or data-instance="slug").
- Namespace-scoped names: kebab-case \`{feature}-{component}-{part?}-{property}\`, e.g. alerts-data-table-cell-background-color. Every token must declare at minimum: color, background-color, border, border-radius (add display/gap/padding only when needed for visual parity).
- Components read var(--…): define component tokens in tokens-components.js; per-feature deltas in tokens-features.js (same component type may differ by feature — e.g. a table on "alerts" vs "pricing"). Instance file tokens-instances.js only when the capture shows a one-off.
- src/index.css: @import "tailwindcss"; @theme maps global/semantic tokens for Tailwind utilities; import apply-tokens side effects or call apply at startup from main.jsx. Keep component CSS minimal — prefer vars.

Hard requirements:
- Files to output: package.json, index.html, vite.config.js, src/main.jsx, src/index.css, src/theme/tokens-ootb.js, src/theme/tokens-custom.js, src/theme/tokens-components.js, src/theme/tokens-features.js, src/theme/tokens-instances.js, src/theme/prime-preset-tweak.js, src/theme/apply-tokens.js, src/App.jsx, one file per major section in src/components/, mock/db.json, mock/server.js, README.md.
- package.json: name from the capture, "type": "module", scripts: {"dev": "concurrently \\"vite\\" \\"node mock/server.js\\"", "build": "vite build", "preview": "vite preview", "mock": "node mock/server.js"}; dependencies react, react-dom, @primereact/core, @primereact/ui, @primeuix/themes, @primeicons/react; devDependencies vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, concurrently. Use caret ranges and real current major versions (vite ^6, tailwindcss ^4, react ^18).
- vite.config.js uses @vitejs/plugin-react and @tailwindcss/vite, and proxies "/api" to http://localhost:8787.
- src/main.jsx: PrimeReactProvider with Aura + prime-preset-tweak merge before App; import PrimeReact styles per current v11 Vite guide.
- Load Google Fonts in index.html when the captured font is a Google font; otherwise fall back to a close system stack.
- Use real text content from the DOM. Use the original <img> src URLs where they were captured (they're public URLs). Icons: @primeicons/react where appropriate; otherwise inline SVG, keep them simple.
- mock/server.js is a dependency-free Node http server on port 8787 that serves every captured API path from mock/db.json with the captured response bodies, CORS enabled, and falls back to {"ok":true} for unknown routes. The React app must fetch its data from /api/... (not hard-coded) wherever the original site fetched data.
- Prefer PrimeReact for buttons, forms, menus, modals, tables; Tailwind on wrappers/passthrough for layout. Fully responsive. No TypeScript. No UI libraries other than PrimeReact v11. No comments longer than a line. No lorem ipsum.
- Never invent sections that aren't in the capture. Never leave TODOs.
- Stay compact: aim for under 1500 lines in total. Put repeated content (nav items, feature cards, logos, testimonials, footer columns) in plain arrays and render with .map(). Don't paste the same JSX twice. Big pages still get every section, just written economically.

${FILE_FORMAT_INSTRUCTIONS}`;

export async function generateProject(provider: Provider, cap: Capture, name: string, opts: GenerateOptions): Promise<Map<string, string>> {
  const prompt = buildPrompt(cap, name, opts.sanitize);
  const images = provider.supportsImages
    ? [...cap.screenshotsDesktop, ...cap.screenshotsMobile].map((b64) => ({ mediaType: "image/jpeg" as const, base64: b64 }))
    : [];

  const text = await provider.complete({ system: SYSTEM, prompt, images, maxTokens: 128000, onChunk: opts.onChunk });
  const files = parseFileBlocks(text);
  if (!files.has("package.json") || !files.has("src/App.jsx")) {
    throw new Error(`The model returned ${files.size} file(s) but not a complete project. Try again or use a different --provider/--model.`);
  }
  return files;
}

function buildPrompt(cap: Capture, name: string, sanitize: boolean): string {
  const apis = cap.requests
    .filter((r) => r.body)
    .map((r) => `${r.method} ${r.path} → ${r.status} ${r.contentType}\n${r.body}`)
    .join("\n\n");
  const otherReqs = cap.requests
    .filter((r) => !r.body)
    .map((r) => `${r.method} ${r.path} → ${r.status}`)
    .join("\n");

  return [
    `Project name: ${name}`,
    `Source URL: ${cap.url}`,
    `Title: ${cap.title}`,
    `Description: ${cap.description}`,
    `Language: ${cap.lang}`,
    `Likely original stack: ${cap.fingerprints.join(", ") || "unknown"}`,
    `Page height at 1440px: ${cap.pageHeight}px`,
    sanitize
      ? "SANITIZE: replace the brand name with a neutral name, replace logos with a simple wordmark, keep layout and copy structure."
      : "",
    "",
    "## Design tokens (computed, most-used first)",
    `fonts: ${cap.tokens.fonts.join(" | ")}`,
    `text colours: ${cap.tokens.colors.join(" | ")}`,
    `backgrounds (by area): ${cap.tokens.backgrounds.join(" | ")}`,
    `border radii: ${cap.tokens.radii.join(" | ")}`,
    `font sizes: ${cap.tokens.fontSizes.join(" | ")}`,
    `content max-width: ${cap.tokens.maxWidth ?? "none"}`,
    `dark mode: ${cap.tokens.darkMode}`,
    "",
    "## Theme mapping (PrimeReact Aura preset)",
    cap.figmaTokens?.length
      ? [
          "Figma-linked design tokens (map each to the nearest PrimeReact 11 OOTB semantic token for prime-preset-tweak.js):",
          ...cap.figmaTokens.map((t) => `${t.name}${t.primeSemantic ? ` → ${t.primeSemantic}` : ""}: ${t.value}`),
        ].join("\n")
      : "No Figma token export in this capture — use the computed design tokens above as proxies for primary, surface, border, and border-radius semantics when building prime-preset-tweak.js and tokens-ootb.js.",
    "",
    "## Semantic outline (use each top-level item as a feature slug in tokens-features.js, kebab-cased)",
    cap.outline.join("\n"),
    "",
    "## Links (text → href)",
    cap.links.map((l) => `${l.text} → ${l.href}`).join("\n"),
    "",
    "## Images (alt, src, natural size)",
    cap.images.map((i) => `${i.alt || "(no alt)"} | ${i.src} | ${i.w}x${i.h}`).join("\n"),
    "",
    "## Captured API calls with JSON bodies (serve these from mock/db.json)",
    apis || "(the page made no JSON API calls — mock/server.js can be minimal)",
    otherReqs ? "\n## Other XHR/fetch requests\n" + otherReqs : "",
    "",
    "## Simplified DOM (classes stripped, scripts removed)",
    cap.html,
    "",
    `Attached images: ${cap.screenshotsDesktop.length} desktop (1440px wide) slice(s) top→bottom, then ${cap.screenshotsMobile.length} mobile (390px) slice(s) top→bottom. Match them.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}
