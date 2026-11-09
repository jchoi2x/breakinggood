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
1. PrimeReact v11 — primary UI component library (Button, InputText, Menubar, Card, Dialog, DataTable, etc. wherever they fit the captured UI).
2. Vite + React 18 — app scaffold and build tooling (@vitejs/plugin-react).
3. Tailwind CSS v4 — utility styling for layout, spacing, responsive tweaks, and custom design tokens; complement PrimeReact, do not replace it with hand-rolled div/button clones.

Hard requirements:
- Files to output: package.json, index.html, vite.config.js, src/main.jsx, src/index.css, src/App.jsx, one file per major section in src/components/, mock/db.json, mock/server.js, README.md.
- package.json: name from the capture, "type": "module", scripts: {"dev": "concurrently \\"vite\\" \\"node mock/server.js\\"", "build": "vite build", "preview": "vite preview", "mock": "node mock/server.js"}; dependencies react, react-dom, primereact ^11, primeicons; devDependencies vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, concurrently. Use caret ranges and real current major versions (vite ^6, tailwindcss ^4, react ^18).
- vite.config.js uses @vitejs/plugin-react and @tailwindcss/vite, and proxies "/api" to http://localhost:8787.
- src/main.jsx wraps the app in PrimeReactProvider and imports "primereact/resources/themes/lara-light-blue/theme.css", "primereact/resources/primereact.min.css", and "primeicons/primeicons.css" before src/index.css.
- src/index.css starts with @import "tailwindcss"; then an @theme block defining the captured palette and fonts as CSS variables (--color-brand-*, --font-sans …). Load Google Fonts in index.html when the captured font is a Google font; otherwise fall back to a close system stack.
- Use real text content from the DOM. Use the original <img> src URLs where they were captured (they're public URLs). Icons: inline SVG, keep them simple.
- mock/server.js is a dependency-free Node http server on port 8787 that serves every captured API path from mock/db.json with the captured response bodies, CORS enabled, and falls back to {"ok":true} for unknown routes. The React app must fetch its data from /api/... (not hard-coded) wherever the original site fetched data.
- Prefer PrimeReact components for buttons, forms, menus, modals, and data tables; use Tailwind (className on wrappers or passthrough where needed) for page layout and capture-specific spacing. Fully responsive. No TypeScript. No UI libraries other than PrimeReact v11. No comments longer than a line. No lorem ipsum.
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
    "## Semantic outline",
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
