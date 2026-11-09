import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { RunPlan } from "../repo/detect-stack.js";
import { startDevServer } from "../repo/run-background.js";
import { extractInPage } from "../site/capture.js";
import { run } from "../util/shell.js";
import type { WorkflowStepStatus, WorkflowTrace } from "./types.js";
import { locatorFor } from "./workflow-runner.js";

export interface WorkflowsFile {
  version: number;
  captureUrl: string;
  steps: {
    index: number;
    action: string;
    selector?: string;
    status: WorkflowStepStatus;
    url?: string;
  }[];
}

export interface ReplayStepResult {
  index: number;
  action: string;
  captureStatus: WorkflowStepStatus;
  replayStatus: WorkflowStepStatus;
  urlMatch: boolean;
  outlineMatch: boolean;
  note?: string;
}

export interface WorkflowReplayResult {
  ran: boolean;
  skipReason?: string;
  baseUrl?: string;
  steps: ReplayStepResult[];
  verified: number;
  partial: number;
  unverified: number;
}

export function hashOutline(lines: string[]): string {
  const normalized = lines.map((l) => l.trim()).join("\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function urlsEquivalent(expected: string | undefined, actual: string): boolean {
  if (!expected) return true;
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    const local = (h: string) => h === "localhost" || h === "127.0.0.1";
    if (local(a.hostname) && local(e.hostname)) {
      return a.pathname === e.pathname && a.search === e.search;
    }
    return a.origin === e.origin && a.pathname === e.pathname && a.search === e.search;
  } catch {
    return actual === expected;
  }
}

function classifyReplay(urlMatch: boolean, outlineMatch: boolean, actionFailed: boolean): WorkflowStepStatus {
  if (actionFailed) return "unverified";
  if (urlMatch && outlineMatch) return "verified";
  if (urlMatch || outlineMatch) return "partial";
  return "unverified";
}

async function snapshotOutline(page: Page): Promise<string[]> {
  const data = await page.evaluate(extractInPage);
  return data.outline.slice(0, 20);
}

function replayEntryUrl(baseUrl: string, workflows: WorkflowsFile, preferBaseUrl: boolean): string {
  if (preferBaseUrl) return baseUrl;
  if (workflows.captureUrl.startsWith("http")) return workflows.captureUrl;
  const base = baseUrl.replace(/\/$/, "");
  try {
    const rel = new URL(workflows.captureUrl, base);
    return rel.toString();
  } catch {
    return baseUrl;
  }
}

/** Replay `workflows.json` steps in a browser and compare URL + outline hash to the capture trace. */
export async function runWorkflowReplay(opts: {
  baseUrl: string;
  workflows: WorkflowsFile;
  expectedTrace: WorkflowTrace;
  headless?: boolean;
  /** When true, open the generated dev server root (ignore captured host/port). */
  preferBaseUrl?: boolean;
}): Promise<WorkflowReplayResult> {
  const expectedByIndex = new Map(opts.expectedTrace.steps.map((s) => [s.index, s]));
  const steps: ReplayStepResult[] = [];
  let verified = 0;
  let partial = 0;
  let unverified = 0;
  const bump = (status: WorkflowStepStatus) => {
    if (status === "verified") verified++;
    else if (status === "partial") partial++;
    else unverified++;
  };

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = replayEntryUrl(opts.baseUrl, opts.workflows, opts.preferBaseUrl ?? false);
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(400);

    for (const step of opts.workflows.steps) {
      const expected = expectedByIndex.get(step.index);

      if (step.index === 0 || step.action === "baseline") {
        const outlineSlice = await snapshotOutline(page);
        const urlMatch = urlsEquivalent(expected?.url ?? step.url, page.url());
        const outlineMatch = expected?.outlineSlice?.length
          ? hashOutline(outlineSlice) === hashOutline(expected.outlineSlice)
          : true;
        const replayStatus = classifyReplay(urlMatch, outlineMatch, false);
        steps.push({
          index: step.index,
          action: step.action,
          captureStatus: expected?.status ?? step.status,
          replayStatus,
          urlMatch,
          outlineMatch,
        });
        bump(replayStatus);
        continue;
      }

      if (step.status === "unverified" || !step.selector) {
        steps.push({
          index: step.index,
          action: step.action,
          captureStatus: step.status,
          replayStatus: "unverified",
          urlMatch: false,
          outlineMatch: false,
          note: "skipped (unverified at capture)",
        });
        unverified++;
        continue;
      }

      try {
        const loc = locatorFor(page, step.selector);
        await loc.first().click({ timeout: 8_000 });
        await page.waitForTimeout(400);
      } catch (e) {
        steps.push({
          index: step.index,
          action: step.action,
          captureStatus: step.status,
          replayStatus: "unverified",
          urlMatch: false,
          outlineMatch: false,
          note: (e as Error).message.split("\n")[0],
        });
        unverified++;
        continue;
      }

      const outlineSlice = await snapshotOutline(page);
      const urlMatch = urlsEquivalent(expected?.url ?? step.url, page.url());
      const outlineMatch = expected?.outlineSlice?.length
        ? hashOutline(outlineSlice) === hashOutline(expected.outlineSlice)
        : true;
      const replayStatus = classifyReplay(urlMatch, outlineMatch, false);
      steps.push({
        index: step.index,
        action: step.action,
        captureStatus: step.status,
        replayStatus,
        urlMatch,
        outlineMatch,
      });
      bump(replayStatus);
    }
  } finally {
    await browser.close();
  }

  return { ran: true, baseUrl: opts.baseUrl, steps, verified, partial, unverified };
}

/** Append replay parity section to an existing interactivity report. */
export function mergeInteractivityReport(existing: string, replay: WorkflowReplayResult): string {
  if (!replay.ran) {
    const reason = replay.skipReason ?? "replay not run";
    return `${existing.trimEnd()}\n\n## Replay verification\n\n_Replay skipped: ${reason}._\n`;
  }

  const rows = replay.steps.map(
    (s) =>
      `| ${s.index} | ${s.action.replace(/\|/g, "\\|")} | ${s.captureStatus} | ${s.replayStatus} | ${s.urlMatch ? "✓" : "—"} | ${s.outlineMatch ? "✓" : "—"} |`,
  );

  const block = [
    "## Replay verification",
    "",
    replay.baseUrl ? `Dev server: \`${replay.baseUrl}\`` : "",
    "",
    "| Step | Action | Capture | Replay | URL | Outline |",
    "|-----:|--------|---------|--------|:---:|:-------:|",
    ...rows,
    "",
    `Replay summary: **${replay.verified}** verified, **${replay.partial}** partial, **${replay.unverified}** unverified.`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `${existing.trimEnd()}\n\n${block}`;
}

/** Best-effort: launch Chromium headless to see if replay can run in this environment. */
export async function isBrowserReplayAvailable(): Promise<boolean> {
  if (process.env.BREAKINGGOOD_SKIP_HYBRID_REPLAY === "1") return false;
  try {
    const browser = await chromium.launch({ headless: true, timeout: 8_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const generatedDevPlan = (): RunPlan => ({
  stack: "node",
  packageManager: "npm",
  install: [],
  run: { cmd: "npm", args: ["run", "dev"], label: "npm run dev" },
  ports: [5173, 8787],
  reasons: ["generated hybrid output"],
  confident: true,
});

export interface VerifyGeneratedReplayOptions {
  outDir: string;
  workflowTrace: WorkflowTrace;
  reportPath: string;
}

/** Install deps, start generated dev server, replay workflows, merge report. */
export async function verifyGeneratedReplay(opts: VerifyGeneratedReplayOptions): Promise<void> {
  const workflowsPath = path.join(opts.outDir, "workflows.json");
  if (!existsSync(workflowsPath)) return;

  const prior = existsSync(opts.reportPath) ? readFileSync(opts.reportPath, "utf8") : "";

  if (!(await isBrowserReplayAvailable())) {
    writeFileSync(
      opts.reportPath,
      mergeInteractivityReport(prior, {
        ran: false,
        skipReason: "no Chromium launch (set BREAKINGGOOD_SKIP_HYBRID_REPLAY=1 to silence)",
        steps: [],
        verified: 0,
        partial: 0,
        unverified: 0,
      }),
    );
    return;
  }

  const pkg = path.join(opts.outDir, "package.json");
  if (!existsSync(pkg)) {
    writeFileSync(
      opts.reportPath,
      mergeInteractivityReport(prior, {
        ran: false,
        skipReason: "no package.json in generated output",
        steps: [],
        verified: 0,
        partial: 0,
        unverified: 0,
      }),
    );
    return;
  }

  const install = await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: opts.outDir,
    quiet: true,
  });
  if (install.code !== 0) {
    writeFileSync(
      opts.reportPath,
      mergeInteractivityReport(prior, {
        ran: false,
        skipReason: "npm install failed in generated output",
        steps: [],
        verified: 0,
        partial: 0,
        unverified: 0,
      }),
    );
    return;
  }

  const server = await startDevServer(opts.outDir, generatedDevPlan(), {
    knownPorts: [5173, 8787],
    timeoutMs: 120_000,
  });

  try {
    const workflows = JSON.parse(readFileSync(workflowsPath, "utf8")) as WorkflowsFile;
    const replay = await runWorkflowReplay({
      baseUrl: server.url,
      workflows,
      expectedTrace: opts.workflowTrace,
      headless: true,
      preferBaseUrl: true,
    });
    writeFileSync(opts.reportPath, mergeInteractivityReport(prior, replay));
  } catch (e) {
    writeFileSync(
      opts.reportPath,
      mergeInteractivityReport(prior, {
        ran: false,
        skipReason: (e as Error).message.split("\n")[0],
        steps: [],
        verified: 0,
        partial: 0,
        unverified: 0,
      }),
    );
  } finally {
    server.kill();
  }
}
