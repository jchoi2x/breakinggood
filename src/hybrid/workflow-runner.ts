import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import {
  captureFromPage,
  captureViewportJpeg,
  type Capture,
  type CapturedRequest,
  dedupeRequests,
  extractInPage,
} from "../site/capture.js";
import { openBrowserSession, type OpenBrowserSessionOptions } from "./browser-session.js";
import { toWorkflowNetworkRequest } from "./network-policy.js";
import type { WorkflowStep, WorkflowStepStatus, WorkflowTrace } from "./types.js";
import type { PlannedAction } from "./workflow-planner.js";

export interface RunWorkflowCaptureOptions extends OpenBrowserSessionOptions {
  captureUrl: string;
  actions: PlannedAction[];
  workflowDepth?: number;
  yes?: boolean;
  screenshotsDir?: string;
  settleMs?: number;
  /** When set, reuse this page instead of opening a new session (caller manages release). */
  page?: Page;
}

export interface WorkflowCaptureResult {
  trace: WorkflowTrace;
  baseline: Capture;
}

export function locatorFor(page: Page, selector: string) {
  if (selector.startsWith("text=")) {
    const raw = selector.slice("text=".length);
    const text = JSON.parse(raw) as string;
    return page.getByText(text, { exact: true });
  }
  const roleMatch = /^role=([a-z]+)\[name=(.+)\]$/i.exec(selector);
  if (roleMatch) {
    const role = roleMatch[1] as Parameters<Page["getByRole"]>[0];
    const name = JSON.parse(roleMatch[2]!) as string;
    return page.getByRole(role, { name });
  }
  if (selector.startsWith("handler:")) {
    return page.locator("body");
  }
  return page.locator(selector);
}

function actionLabel(action: PlannedAction): string {
  return [action.kind, action.label ?? action.text ?? action.selector].filter(Boolean).join(":");
}

function attachRequestCollector(page: Page): { drain: () => CapturedRequest[]; reset: () => void } {
  const collected: CapturedRequest[] = [];
  page.on("response", (res) => {
    void (async () => {
      try {
        const req = res.request();
        const type = req.resourceType();
        if (type !== "xhr" && type !== "fetch") return;
        const ct = res.headers()["content-type"] ?? "";
        const entry: CapturedRequest = {
          method: req.method(),
          url: res.url(),
          path: new URL(res.url()).pathname,
          status: res.status(),
          contentType: ct.split(";")[0] ?? "",
        };
        collected.push(entry);
      } catch {
        /* response may be gone */
      }
    })();
  });
  return {
    drain: () => dedupeRequests(collected.splice(0, collected.length)),
    reset: () => {
      collected.length = 0;
    },
  };
}

async function saveScreenshot(base64: string, dir: string | undefined, name: string): Promise<string | undefined> {
  if (!dir) return undefined;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.from(base64, "base64"));
  return path.basename(file);
}

async function snapshotOutline(page: Page): Promise<string[]> {
  const data = await page.evaluate(extractInPage);
  return data.outline.slice(0, 20);
}

async function runOnPage(
  page: Page,
  opts: Omit<RunWorkflowCaptureOptions, keyof OpenBrowserSessionOptions | "page">,
): Promise<WorkflowCaptureResult> {
  const depth = opts.workflowDepth ?? 3;
  const steps: WorkflowStep[] = [];
  const net = attachRequestCollector(page);

  await page.goto(opts.captureUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(opts.settleMs ?? 400);

  const baselineRequests = net.drain();
  const baseline = await captureFromPage(page, opts.captureUrl, baselineRequests);
  const baselineShot = await saveScreenshot(
    await captureViewportJpeg(page),
    opts.screenshotsDir,
    "step-0-baseline.jpg",
  );
  steps.push({
    index: 0,
    action: "baseline",
    status: "verified",
    url: page.url(),
    outlineSlice: baseline.outline.slice(0, 20),
    screenshotRef: baselineShot,
    requests: baselineRequests.map((r) => toWorkflowNetworkRequest({ method: r.method, url: r.url, status: r.status })),
  });

  const queue = opts.actions.filter((a) => !a.skipped).slice(0, depth);
  for (let i = 0; i < queue.length; i++) {
    const planned = queue[i]!;
    const stepIndex = steps.length;
    net.reset();
    let status: WorkflowStepStatus = "verified";
    let error: string | undefined;
    try {
      const loc = locatorFor(page, planned.selector);
      if (planned.kind === "click") {
        await loc.click({ timeout: 8_000 });
      } else if (planned.kind === "submit") {
        await loc.click({ timeout: 8_000 });
      } else if (planned.kind === "change") {
        await loc.fill("probe", { timeout: 8_000 }).catch(() => loc.click({ timeout: 8_000 }));
      }
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(200);
    } catch (e) {
      status = "unverified";
      error = (e as Error).message.split("\n")[0];
    }
    const shot = await saveScreenshot(
      await captureViewportJpeg(page),
      opts.screenshotsDir,
      `step-${stepIndex}.jpg`,
    );
    steps.push({
      index: stepIndex,
      action: actionLabel(planned),
      selector: planned.selector,
      status,
      url: page.url(),
      error,
      outlineSlice: await snapshotOutline(page),
      screenshotRef: shot,
      requests: net.drain().map((r) => toWorkflowNetworkRequest({ method: r.method, url: r.url, status: r.status })),
    });
    if (status === "unverified" && !opts.yes) break;
  }

  return {
    trace: { version: 1, captureUrl: opts.captureUrl, steps },
    baseline,
  };
}

/** Multi-step interactive capture using an isolated or CDP browser session. */
export async function runWorkflowCapture(opts: RunWorkflowCaptureOptions): Promise<WorkflowCaptureResult> {
  if (opts.page) {
    return runOnPage(opts.page, opts);
  }
  const session = await openBrowserSession(opts);
  try {
    await session.page.setViewportSize({ width: 1440, height: 900 });
    return await runOnPage(session.page, opts);
  } finally {
    await session.release();
  }
}
