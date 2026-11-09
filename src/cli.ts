#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";
import { listProviders } from "./ai/resolve.js";
import { cloneAndRun } from "./repo/index.js";
import { reverseEngineerAndRun } from "./site/index.js";
import { hybridCaptureAndGenerate } from "./hybrid/index.js";
import { parseHybridTarget, parseTarget } from "./util/detect-url.js";
import { banner, log } from "./util/ui.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("breakinggood")
  .description("One command. Any URL. Cloned, reverse-engineered, running.")
  .version(version)
  .argument("[url]", "GitHub/GitLab repo URL → clone & run.  Any other URL → rebuild as code & run.")
  .option("-d, --dir <path>", "target directory (default: derived from the URL)")
  .option("-y, --yes", "don't ask, just go", false)
  .option("--no-open", "don't open the browser")
  .option("--provider <name>", "ai provider: anthropic | openai | groq | openrouter | gemini | ollama")
  .option("--model <id>", "model id for the provider")
  .option("--no-ai", "repo mode: never call an AI, heuristics only")
  .option("--scan-only", "repo mode: clone + safety scan, then stop", false)
  .option("--sanitize", "site mode: swap brand names/logos for neutral placeholders", false)
  .option("--capture-only", "site mode: save screenshots/DOM/API capture and stop (no AI needed)", false)
  .action(async (url: string | undefined, opts) => {
    banner(version);
    if (!url) {
      program.help();
      return;
    }
    const target = parseTarget(url);
    try {
      if (target.mode === "repo") {
        await cloneAndRun(target, {
          dir: opts.dir,
          yes: opts.yes,
          open: opts.open,
          noAi: !opts.ai,
          scanOnly: opts.scanOnly,
          provider: opts.provider,
          model: opts.model,
        });
      } else {
        await reverseEngineerAndRun(target, {
          dir: opts.dir,
          yes: opts.yes,
          open: opts.open,
          sanitize: opts.sanitize,
          captureOnly: opts.captureOnly,
          provider: opts.provider,
          model: opts.model,
        });
      }
    } catch (e) {
      log.blank();
      log.err((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("hybrid")
  .description("hybrid mode: local checkout + public URL → workflow capture and rebuild (experimental)")
  .requiredOption("-d, --dir <path>", "local repository root")
  .option(
    "--source-path <path>",
    "optional source root for InteractionMap, relative to --dir (repeatable)",
    (v, prev: string[]) => [...prev, v],
    [] as string[],
  )
  .requiredOption("--url <url>", "public entry URL for workflow context (any HTTPS page, e.g. example.com)")
  .option("-o, --out <path>", "output directory (default: sibling of --dir)")
  .option("--run <command>", "override dev-server start command (no shell)")
  .option("--capture-url <url>", "localhost URL to open once the dev server is up")
  .option("--max-interactions <n>", "max UI actions during workflow capture", (v) => Number(v), 40)
  .option("--workflow-depth <n>", "max steps per workflow branch", (v) => Number(v), 3)
  .option("--network-mutations", "allow non-GET requests to non-localhost hosts during explore")
  .option("--plan-only", "write interaction map + run plan only", false)
  .option("--capture-only", "capture artifacts without generation", false)
  .option("--allow-egress", "allow LLM API calls during generation (off by default)", false)
  .option("--sanitize", "swap brand names/logos for neutral placeholders in generated output", false)
  .option("-y, --yes", "do not confirm install/run steps", false)
  .option("--no-open", "do not open a browser")
  .option("--attach-cdp <endpoint>", "attach to existing Chromium via CDP (ws or http debug URL)")
  .option("--attach-url-prefix <prefix>", "pick attached tab whose URL starts with this prefix")
  .option(
    "--attach-allowed-origin <origin>",
    "allowed origin for navigation in attach mode (repeatable)",
    (v, prev: string[]) => [...prev, v],
    [] as string[],
  )
  .option("--provider <name>", "ai provider: anthropic | openai | groq | openrouter | gemini | ollama")
  .option("--model <id>", "model id for the provider")
  .action(async (opts) => {
    banner(version);
    try {
      const target = parseHybridTarget({
        dir: opts.dir,
        sourcePath: opts.sourcePath as string[],
        url: opts.url,
        out: opts.out,
        run: opts.run,
        captureUrl: opts.captureUrl,
        maxInteractions: opts.maxInteractions,
        workflowDepth: opts.workflowDepth,
        noNetworkMutations: !opts.networkMutations,
        planOnly: opts.planOnly,
        captureOnly: opts.captureOnly,
        allowEgress: opts.allowEgress,
        sanitize: opts.sanitize,
        yes: opts.yes,
        open: opts.open,
        attachCdp: opts.attachCdp,
        attachUrlPrefix: opts.attachUrlPrefix,
        attachAllowedOrigin: opts.attachAllowedOrigin as string[],
        provider: opts.provider,
        model: opts.model,
      });
      await hybridCaptureAndGenerate(target.options);
    } catch (e) {
      log.blank();
      log.err((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("providers")
  .description("show which AI providers are configured in this shell")
  .action(() => {
    banner(version);
    for (const p of listProviders()) {
      console.log(
        `  ${p.available ? pc.green("●") : pc.dim("○")} ${p.id.padEnd(11)} ${pc.dim("default model: " + p.defaultModel)}`,
      );
    }
    console.log();
    console.log(pc.dim("  set ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY or OLLAMA_HOST"));
    console.log(pc.dim("  override with --provider / --model or BREAKINGGOOD_PROVIDER / BREAKINGGOOD_MODEL"));
  });

program
  .command("mcp")
  .description("run as an MCP server (stdio) for Claude Code, Cursor, Codex and friends")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
  });

program.parseAsync(process.argv);
