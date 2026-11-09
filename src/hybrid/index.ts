import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveProvider } from "../ai/resolve.js";
import { NoProviderError } from "../ai/provider.js";
import { readFacts } from "../repo/detect-stack.js";
import { runInstall } from "../repo/run.js";
import { scanRepo } from "../repo/scan.js";
import { startDevServer } from "../repo/run-background.js";
import { generateHybridProject } from "../site/generate-hybrid.js";
import type { Capture } from "../site/capture.js";
import { buildEgressManifest, readSourceExcerpts, requireEgress } from "./egress.js";
import { buildInteractionMap } from "./interaction-map.js";
import { discoverRunDocs } from "./run-discovery.js";
import type { HybridOptions } from "./types.js";
import { hybridArtifactPaths } from "./types.js";
import type { WorkflowTrace } from "./types.js";
import { resolveRunPlan } from "./user-run.js";
import { planWorkflow } from "./workflow-planner.js";
import { runWorkflowCapture } from "./workflow-runner.js";

function defaultOutDir(dir: string): string {
  return `${dir}-hybrid-rebuild`;
}

function writeInteractivityReport(
  file: string,
  traceSteps: { status: string }[],
  attempted: number,
  generation?: { provider: string; model: string; fileCount: number },
): void {
  const verified = traceSteps.filter((s) => s.status === "verified").length;
  const unverified = traceSteps.filter((s) => s.status === "unverified").length;
  const partial = traceSteps.filter((s) => s.status === "partial").length;
  const genLine = generation
    ? `\nGeneration ran with **${generation.provider}/${generation.model}** (${generation.fileCount} files written to output root).\n`
    : "\nGeneration was not run (use \`--allow-egress\` and a configured provider to generate).\n";
  const body = `# Interactivity report

Hybrid workflow capture.${genLine}

| Metric | Count |
|--------|------:|
| Attempted actions | ${attempted} |
| Verified steps | ${verified} |
| Partial steps | ${partial} |
| Unverified steps | ${unverified} |

Detailed step status is in \`workflow-trace.json\`.
`;
  writeFileSync(file, body);
}

function writeGeneratedProject(outDir: string, files: Map<string, string>): void {
  for (const [rel, content] of files) {
    const full = path.join(outDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

async function runHybridGeneration(
  opts: HybridOptions,
  out: string,
  dir: string,
  interactionMap: ReturnType<typeof buildInteractionMap>,
  trace: WorkflowTrace,
  baseline: Capture,
  plan: Awaited<ReturnType<typeof resolveRunPlan>>,
  artifacts: ReturnType<typeof hybridArtifactPaths>,
  attempted: number,
): Promise<void> {
  requireEgress(opts);
  const provider = resolveProvider({ provider: opts.provider, model: opts.model });
  if (!provider) throw new NoProviderError();

  const sourceExcerpts = readSourceExcerpts(dir, interactionMap);
  const manifest = buildEgressManifest({
    allowEgress: true,
    repoRoot: dir,
    interactionMap,
    baseline,
    trace,
  });
  writeFileSync(artifacts.egressManifest, JSON.stringify(manifest, null, 2));

  const projectName = path.basename(out);
  const files = await generateHybridProject(
    provider,
    projectName,
    {
      entryUrl: opts.url,
      interactionMap,
      trace,
      baseline,
      runCommand: plan.run?.label,
      runReasons: plan.reasons,
      sourceExcerpts,
    },
    { sanitize: opts.sanitize ?? false },
  );

  writeGeneratedProject(out, files);
  writeInteractivityReport(artifacts.interactivityReport, trace.steps, attempted, {
    provider: provider.name,
    model: provider.model,
    fileCount: files.size,
  });
}

function assertScanAllowed(
  findings: { severity: string }[],
  yes: boolean | undefined,
): void {
  const worst = findings[0]?.severity;
  if (worst === "high" && !yes) {
    throw new Error("High-risk scan findings — re-run with -y to install anyway.");
  }
}

/** Scan → install → dev server → InteractionMap → WorkflowRunner → artifacts. */
export async function hybridCaptureAndGenerate(opts: HybridOptions): Promise<void> {
  const dir = path.resolve(opts.dir);
  const out = path.resolve(opts.out ?? defaultOutDir(dir));
  const artifacts = hybridArtifactPaths(out);
  mkdirSync(artifacts.root, { recursive: true });

  const report = await scanRepo(dir);
  assertScanAllowed(report.findings, opts.yes);

  const facts = readFacts(dir);
  const docs = discoverRunDocs(dir);
  const plan = await resolveRunPlan(facts, { userRun: opts.userRun, docs, provider: null });

  const runPlanPath = path.join(artifacts.root, "run-plan.json");
  writeFileSync(runPlanPath, JSON.stringify(plan, null, 2));

  const interactionMap = buildInteractionMap(dir, opts.sourcePaths, facts);
  writeFileSync(artifacts.interactionMap, JSON.stringify(interactionMap, null, 2));

  if (opts.planOnly) {
    return;
  }

  if (plan.install.length) {
    if (!opts.yes) {
      throw new Error("Install required — pass -y/--yes to proceed without prompts.");
    }
    await runInstall(dir, plan);
  }

  if (!plan.run) {
    throw new Error("No run command resolved for hybrid capture.");
  }

  const server = await startDevServer(dir, plan, {
    run: opts.userRun ? { cmd: opts.userRun.cmd, args: opts.userRun.args, label: plan.run.label } : undefined,
    knownPorts: opts.userRun?.ports?.length ? opts.userRun.ports : plan.ports,
  });

  let captureUrl = opts.captureUrl;
  if (!captureUrl) {
    const base = server.url.replace(/\/$/, "");
    try {
      const entry = new URL(opts.url);
      captureUrl = base + (entry.pathname === "/" ? "" : entry.pathname);
    } catch {
      captureUrl = base;
    }
  }

  const screenshotsDir = path.join(artifacts.root, "screenshots");

  try {
    const planned = planWorkflow(interactionMap, { maxInteractions: opts.maxInteractions });
    const depth = opts.workflowDepth ?? 3;
    const attempted = planned.filter((p) => !p.skipped).slice(0, depth).length;

    const { trace, baseline } = await runWorkflowCapture({
      captureUrl,
      actions: planned,
      workflowDepth: depth,
      yes: opts.yes,
      noNetworkMutations: opts.noNetworkMutations,
      screenshotsDir,
      headless: true,
      cdpEndpoint: opts.attachCdp,
      attachUrlPrefix: opts.attachUrlPrefix,
      allowedOrigins: opts.attachAllowedOrigins,
      mode: opts.attachCdp ? "cdp-attached" : "isolated",
    });

    writeFileSync(artifacts.workflowTrace, JSON.stringify(trace, null, 2));
    writeFileSync(path.join(artifacts.root, "baseline-capture.json"), JSON.stringify(baseline, null, 2));

    if (!opts.captureOnly && opts.allowEgress) {
      await runHybridGeneration(opts, out, dir, interactionMap, trace, baseline, plan, artifacts, attempted);
    } else {
      writeInteractivityReport(artifacts.interactivityReport, trace.steps, attempted);
    }
  } finally {
    server.kill();
  }

  if (!existsSync(artifacts.workflowTrace)) {
    throw new Error("workflow capture did not produce artifacts");
  }
}
