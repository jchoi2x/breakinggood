/**
 * MCP server so coding agents (Claude Code, Cursor, Codex, …) can use
 * breakinggood as a tool: capture a site, scan a repo, or clone + prepare one.
 *
 * Nothing in here may write to stdout — that's the protocol channel.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { captureSite } from "./site/capture.js";
import { heuristicPlan, readFacts } from "./repo/detect-stack.js";
import { scanRepo } from "./repo/scan.js";
import { prepareEnv } from "./util/env-file.js";
import { parseHybridTarget, parseTarget } from "./util/detect-url.js";
import { run } from "./util/shell.js";
import { hybridCaptureAndGenerate } from "./hybrid/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "breakinggood", version });

  server.registerTool(
    "capture_site",
    {
      title: "Capture a website for reverse-engineering",
      description:
        "Loads a public web page in a headless browser and returns what it's made of: title, design tokens " +
        "(fonts, colours, radii, type scale), semantic outline, links, images, every XHR/fetch call with its JSON " +
        "body, a simplified DOM, and paths to desktop/mobile screenshot slices on disk. Use it before rebuilding a " +
        "page or when asked how a site is built.",
      inputSchema: { url: z.string().url().describe("Page URL, e.g. https://tailwindcss.com") },
    },
    async ({ url }) => {
      const cap = await captureSite(url);
      const dir = path.join(os.tmpdir(), "breakinggood", parseTarget(url).name);
      mkdirSync(dir, { recursive: true });
      const shots: string[] = [];
      cap.screenshotsDesktop.forEach((b, i) => {
        const p = path.join(dir, `desktop-${i + 1}.jpg`);
        writeFileSync(p, Buffer.from(b, "base64"));
        shots.push(p);
      });
      cap.screenshotsMobile.forEach((b, i) => {
        const p = path.join(dir, `mobile-${i + 1}.jpg`);
        writeFileSync(p, Buffer.from(b, "base64"));
        shots.push(p);
      });
      const { screenshotsDesktop: _d, screenshotsMobile: _m, html, ...rest } = cap;
      writeFileSync(path.join(dir, "capture.json"), JSON.stringify({ ...rest, html }, null, 2));
      return text({ ...rest, screenshots: shots, captureFile: path.join(dir, "capture.json"), html: html.slice(0, 20_000) });
    },
  );

  server.registerTool(
    "scan_repo",
    {
      title: "Scan a repository before running it",
      description:
        "Given a git URL or a local path, detects the stack and the install/run commands, and reports dependency " +
        "risks: packages that run install scripts, foreign registries, very new packages, curl|bash in lifecycle " +
        "hooks, obfuscated code, shipped .env files. Clones to a temp dir when given a URL.",
      inputSchema: { target: z.string().describe("https://github.com/owner/repo or /path/to/checkout") },
    },
    async ({ target }) => {
      const dir = await ensureCheckout(target);
      const facts = readFacts(dir);
      const plan = heuristicPlan(facts);
      const report = await scanRepo(dir);
      return text({ dir, stack: plan.stack, packageManager: plan.packageManager, install: plan.install.map((c) => c.label), run: plan.run?.label ?? null, ports: plan.ports, confident: plan.confident, findings: report.findings, checked: report.checked });
    },
  );

  server.registerTool(
    "hybrid_rebuild",
    {
      title: "Hybrid rebuild from local source + reference URL",
      description:
        "Experimental hybrid mode: scan a local checkout, start its dev server, capture interactive workflows " +
        "in a real browser, and optionally generate a greenfield frontend rebuild with mocked APIs. " +
        "LLM calls run only when allow_egress is true. Writes artifacts under <out>/.breakinggood/hybrid/ and " +
        "generated project files when egress is allowed.",
      inputSchema: {
        dir: z.string().describe("Local repository root"),
        source_path: z
          .array(z.string())
          .min(1)
          .describe("Source paths or globs relative to dir (e.g. src)"),
        url: z.string().url().describe("Public entry URL for workflow context"),
        out: z.string().optional().describe("Output directory (default: sibling of dir)"),
        run: z.string().optional().describe('Dev server override, e.g. "npm run dev" (no shell)'),
        capture_url: z.string().url().optional().describe("localhost URL to open once dev server is up"),
        max_interactions: z.number().int().positive().optional().default(40),
        workflow_depth: z.number().int().positive().optional().default(3),
        network_mutations: z.boolean().optional().describe("Allow non-GET to non-localhost during explore"),
        plan_only: z.boolean().optional(),
        capture_only: z.boolean().optional(),
        allow_egress: z
          .boolean()
          .optional()
          .describe("Allow LLM API calls during generation (off by default)"),
        sanitize: z.boolean().optional(),
        yes: z.boolean().optional().describe("Skip install confirmations"),
        attach_cdp: z.string().optional().describe("Chromium CDP endpoint (ws or http debug URL)"),
        attach_url_prefix: z.string().optional().describe("Pick attached tab whose URL starts with this prefix"),
        attach_allowed_origin: z.array(z.string()).optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
      },
    },
    async (input) => {
      const target = parseHybridTarget({
        dir: input.dir,
        sourcePath: input.source_path,
        url: input.url,
        out: input.out,
        run: input.run,
        captureUrl: input.capture_url,
        maxInteractions: input.max_interactions,
        workflowDepth: input.workflow_depth,
        noNetworkMutations: input.network_mutations === undefined ? true : !input.network_mutations,
        planOnly: input.plan_only,
        captureOnly: input.capture_only,
        allowEgress: input.allow_egress,
        sanitize: input.sanitize,
        yes: input.yes,
        open: false,
        attachCdp: input.attach_cdp,
        attachUrlPrefix: input.attach_url_prefix,
        attachAllowedOrigin: input.attach_allowed_origin,
        provider: input.provider,
        model: input.model,
      });
      await hybridCaptureAndGenerate(target.options);
      const out = target.options.out ?? `${path.resolve(target.options.dir)}-hybrid-rebuild`;
      const artifactRoot = path.join(out, ".breakinggood", "hybrid");
      return text({
        out,
        artifactRoot,
        interactionMap: path.join(artifactRoot, "interaction-map.json"),
        workflowTrace: path.join(artifactRoot, "workflow-trace.json"),
        interactivityReport: path.join(artifactRoot, "interactivity-report.md"),
        allowEgress: target.options.allowEgress ?? false,
      });
    },
  );

  server.registerTool(
    "clone_and_prepare",
    {
      title: "Clone a repo, scan it, set up .env and install",
      description:
        "Shallow-clones a repository into `dir` (default: current directory / repo name), runs the dependency scan, " +
        "creates .env from .env.example with random secrets for *_SECRET keys, and runs the install step. Refuses to " +
        "install when the scan finds high-severity issues unless `force` is true. Returns the command to start it; " +
        "it does not start the server itself.",
      inputSchema: {
        url: z.string().describe("git URL"),
        dir: z.string().optional().describe("target directory"),
        force: z.boolean().optional().describe("install even if the scan finds high-severity issues"),
      },
    },
    async ({ url, dir, force }) => {
      const t = parseTarget(url);
      const dest = path.resolve(dir ?? t.name);
      if (!existsSync(dest)) {
        const args = ["clone", "--depth", "1", ...(t.branch ? ["--branch", t.branch] : []), t.cloneUrl ?? url, dest];
        const r = await run("git", args, { cwd: process.cwd(), quiet: true });
        if (r.code !== 0) throw new Error("git clone failed: " + r.output.slice(-800));
      }
      const facts = readFacts(dest);
      const plan = heuristicPlan(facts);
      const report = await scanRepo(dest);
      const high = report.findings.filter((f) => f.severity === "high");
      if (high.length && !force) {
        return text({ dest, installed: false, reason: "high-severity findings; pass force=true to install anyway", findings: report.findings });
      }
      const env = prepareEnv(dest);
      const installLog: string[] = [];
      for (const c of plan.install) {
        const r = await run(c.cmd, c.args, { cwd: dest, quiet: true });
        installLog.push(`${c.label} → exit ${r.code}`);
        if (r.code !== 0) throw new Error(`${c.label} failed:\n${r.output.slice(-1500)}`);
      }
      return text({ dest, stack: plan.stack, installed: true, installLog, env, run: plan.run ? `${plan.run.cmd} ${plan.run.args.join(" ")}` : null, ports: plan.ports, findings: report.findings });
    },
  );

  await server.connect(new StdioServerTransport());
}

async function ensureCheckout(target: string): Promise<string> {
  if (existsSync(target)) return path.resolve(target);
  const t = parseTarget(target);
  if (t.mode !== "repo") throw new Error("scan_repo needs a git URL or a local path");
  const dest = path.join(os.tmpdir(), "breakinggood", "repos", t.name);
  if (!existsSync(dest)) {
    mkdirSync(path.dirname(dest), { recursive: true });
    const r = await run("git", ["clone", "--depth", "1", t.cloneUrl!, dest], { cwd: process.cwd(), quiet: true });
    if (r.code !== 0) throw new Error("git clone failed: " + r.output.slice(-800));
  }
  return dest;
}
