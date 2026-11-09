import type { InteractionControl, InteractionMap } from "./types.js";

export type SelectorQuality = "testid" | "aria" | "role" | "text" | "unknown";

export interface PlannedAction {
  index: number;
  kind: "click" | "submit" | "change";
  selector: string;
  quality: SelectorQuality;
  label?: string;
  text?: string;
  file: string;
  line: number;
  handlerRef: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface PlanWorkflowOptions {
  maxInteractions?: number;
  denyLabels?: RegExp;
}

const DEFAULT_DENY =
  /\b(delete|remove|submit payment|logout|log out|sign out)\b/i;

function qualityScore(c: InteractionControl): { quality: SelectorQuality; score: number; selector: string } {
  if (c.selectorHint?.includes("data-testid")) {
    return { quality: "testid", score: 400, selector: c.selectorHint };
  }
  if (c.selectorHint?.includes("aria-label") || c.label) {
    const sel = c.selectorHint ?? `[aria-label="${c.label}"]`;
    return { quality: "aria", score: 300, selector: sel };
  }
  if (c.text) {
    return { quality: "text", score: 200, selector: `text=${JSON.stringify(c.text)}` };
  }
  if (c.label) {
    return { quality: "role", score: 150, selector: `role=button[name=${JSON.stringify(c.label)}]` };
  }
  return { quality: "unknown", score: 0, selector: c.selectorHint ?? `handler:${c.handlerRef}` };
}

function inferKind(c: InteractionControl): PlannedAction["kind"] {
  if (c.handlerRef.includes("onSubmit") || c.label === "submit") return "submit";
  if (c.handlerRef.includes("onChange")) return "change";
  return "click";
}

/** Rank InteractionMap controls into an execution queue with safety filters. */
export function planWorkflow(map: InteractionMap, opts: PlanWorkflowOptions = {}): PlannedAction[] {
  const max = opts.maxInteractions ?? 40;
  const deny = opts.denyLabels ?? DEFAULT_DENY;
  const ranked = [...map.controls]
    .map((c) => {
      const { quality, score, selector } = qualityScore(c);
      return { c, quality, score, selector };
    })
    .sort((a, b) => b.score - a.score || a.c.line - b.c.line);

  const planned: PlannedAction[] = [];
  for (const row of ranked) {
    if (planned.filter((p) => !p.skipped).length >= max) break;
    const combinedLabel = [row.c.label, row.c.text, row.c.handlerRef].filter(Boolean).join(" ");
    const denied = deny.test(combinedLabel);
    planned.push({
      index: planned.length,
      kind: inferKind(row.c),
      selector: row.selector,
      quality: row.quality,
      label: row.c.label,
      text: row.c.text,
      file: row.c.file,
      line: row.c.line,
      handlerRef: row.c.handlerRef,
      ...(denied ? { skipped: true, skipReason: "denylist" } : {}),
    });
  }
  return planned;
}
