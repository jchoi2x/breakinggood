import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Command, RepoFacts, RunPlan } from "../repo/detect-stack.js";
import { fileTree } from "../repo/detect-stack.js";

export type RunDocKind = "readme" | "doc" | "manifest" | "script";

export interface RunDocEvidence {
  source: string;
  kind: RunDocKind;
  excerpts: string[];
  inferredPorts: number[];
  inferredCommands: string[];
}

const ROOT_NAMES = /^readme(\.md|\.rst|\.txt)?$/i;
const ROOT_EXTRA = /^(CONTRIBUTING|DEVELOPMENT|HACKING)(\.md)?$/i;
const DOC_KEYWORDS = /\b(running|development|getting started|quick start|local setup)\b/i;
const MAX_DOC_FILES = 5;
const EXCERPT_CAP = 2000;
const TOTAL_EXCERPT_CAP = 8000;

const CMD_RE =
  /(?:^|\s)(?:npm run|yarn|pnpm run|pnpm|bun run|bun)\s+([a-zA-Z0-9:_-]+)|(?:^|\s)(?:make|just)\s+(dev|run|serve|start)\b/gi;
const PORT_RE =
  /(?:localhost|127\.0\.0\.1):(\d{2,5})\b|PORT=(\d{2,5})\b|:(\d{4,5})\b/g;

/** Discover run-related docs and manifests under `dir` (assessment §4c). */
export function discoverRunDocs(dir: string): RunDocEvidence[] {
  const evidence: RunDocEvidence[] = [];
  const treeLines = fileTree(dir).split("\n").filter(Boolean);
  const relPaths = rankRunDocPaths(dir, treeLines);

  let excerptBudget = TOTAL_EXCERPT_CAP;
  for (const rel of relPaths) {
    if (excerptBudget <= 0) break;
    const full = path.join(dir, rel);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const kind = classifyPath(rel);
    const body = readFileSync(full, "utf8");
    const slice = body.slice(0, Math.min(EXCERPT_CAP, excerptBudget));
    excerptBudget -= slice.length;
    const inferredPorts = extractPorts(body);
    const inferredCommands = extractCommands(body);
    if (kind === "manifest" && rel.endsWith("package.json")) {
      mergePackageScripts(evidence, rel, body, inferredPorts, inferredCommands);
      continue;
    }
    evidence.push({ source: rel, kind, excerpts: [slice], inferredPorts, inferredCommands });
  }

  mergeComposePorts(dir, evidence);
  return evidence;
}

export function mergeRunDocsIntoPlan(plan: RunPlan, docs: RunDocEvidence[], facts: RepoFacts): RunPlan {
  const ports = new Set(plan.ports);
  const reasons = [...plan.reasons];
  let run = plan.run;
  let confident = plan.confident;

  for (const doc of docs) {
    for (const p of doc.inferredPorts) ports.add(p);
    for (const cmdLine of doc.inferredCommands) {
      const cmd = commandFromInferred(cmdLine, facts);
      if (!cmd) continue;
      if (!run || (corroboratesScript(run, facts) && cmd.label !== run.label)) {
        run = cmd;
        confident = corroboratesScript(cmd, facts);
        reasons.push(`docs/${doc.source}: ${cmdLine}`);
      } else if (!run) {
        run = cmd;
        reasons.push(`docs/${doc.source}: ${cmdLine}`);
      }
    }
  }

  return {
    ...plan,
    run: run ?? plan.run,
    ports: ports.size ? [...ports] : plan.ports,
    confident: confident || plan.confident,
    reasons,
  };
}

function rankRunDocPaths(dir: string, treeLines: string[]): string[] {
  const candidates: string[] = [];

  try {
    for (const name of readdirSync(dir)) {
      if (ROOT_NAMES.test(name) || ROOT_EXTRA.test(name)) {
        candidates.push(name);
      }
    }
  } catch {
    /* unreadable root */
  }

  const docMd: string[] = [];
  for (const line of treeLines) {
    if (line.endsWith("/")) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith("docs/") && lower.endsWith(".md") && DOC_KEYWORDS.test(readHeadingHint(path.join(dir, line)))) {
      docMd.push(line);
    }
    if (/^(Makefile|justfile|docker-compose\.ya?ml|compose\.ya?ml|Procfile|package\.json)$/i.test(line)) {
      candidates.push(line);
    }
    if (/^(scripts\/run\.|bin\/dev|bin\/start|run\.sh|\.vscode\/tasks\.json)$/i.test(line)) {
      candidates.push(line);
    }
  }

  docMd.sort((a, b) => a.length - b.length);
  return [...new Set([...candidates, ...docMd.slice(0, MAX_DOC_FILES)])];
}

function readHeadingHint(full: string): string {
  try {
    const head = readFileSync(full, "utf8").slice(0, 400);
    const first = head.split("\n").slice(0, 8).join(" ");
    return first;
  } catch {
    return "";
  }
}

function classifyPath(rel: string): RunDocKind {
  if (/^readme/i.test(rel) || /^CONTRIBUTING|^DEVELOPMENT|^HACKING/i.test(rel)) return "readme";
  if (rel.startsWith("docs/")) return "doc";
  if (/package\.json|Makefile|justfile|docker-compose|compose\.ya?ml|Procfile|tasks\.json$/i.test(rel)) return "manifest";
  return "script";
}

function extractPorts(text: string): number[] {
  const ports = new Set<number>();
  for (const m of text.matchAll(PORT_RE)) {
    const p = Number(m[1] ?? m[2] ?? m[3]);
    if (p > 0 && p <= 65535) ports.add(p);
  }
  return [...ports];
}

function extractCommands(text: string): string[] {
  const cmds = new Set<string>();
  for (const m of text.matchAll(CMD_RE)) {
    const fragment = m[0].trim();
    if (fragment) cmds.add(fragment.replace(/\s+/g, " "));
  }
  return [...cmds];
}

function mergePackageScripts(
  evidence: RunDocEvidence[],
  rel: string,
  body: string,
  ports: number[],
  commands: string[],
): void {
  try {
    const pkg = JSON.parse(body) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    for (const key of ["dev", "start", "serve", "preview"]) {
      if (scripts[key]) commands.push(`npm run ${key}`);
    }
    evidence.push({
      source: rel,
      kind: "manifest",
      excerpts: [body.slice(0, EXCERPT_CAP)],
      inferredPorts: ports,
      inferredCommands: [...new Set(commands)],
    });
  } catch {
    evidence.push({ source: rel, kind: "manifest", excerpts: [body.slice(0, 500)], inferredPorts: ports, inferredCommands: commands });
  }
}

function mergeComposePorts(dir: string, evidence: RunDocEvidence[]): void {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const full = path.join(dir, name);
    if (!existsSync(full)) continue;
    const body = readFileSync(full, "utf8");
    const ports: number[] = [];
    for (const m of body.matchAll(/"(\d{2,5}):\d+"/g)) {
      const p = Number(m[1]);
      if (p > 0) ports.push(p);
    }
    if (ports.length) {
      evidence.push({
        source: name,
        kind: "manifest",
        excerpts: [body.slice(0, EXCERPT_CAP)],
        inferredPorts: ports,
        inferredCommands: [],
      });
    }
  }
}

function commandFromInferred(line: string, facts: RepoFacts): Command | null {
  const normalized = line.replace(/\s+/g, " ").trim();
  const npmRun = normalized.match(/^npm run (\w+)$/i);
  if (npmRun && facts.stack === "node") {
    const script = npmRun[1]!;
    return { cmd: "npm", args: ["run", script], label: `npm run ${script}` };
  }
  const yarn = normalized.match(/^yarn (\w+)$/i);
  if (yarn && facts.stack === "node") {
    const script = yarn[1]!;
    return { cmd: "yarn", args: [script], label: `yarn ${script}` };
  }
  const make = normalized.match(/^(?:make|just) (dev|run|serve|start)$/i);
  if (make) {
    const target = make[1]!;
    const tool = normalized.startsWith("just") ? "just" : "make";
    return { cmd: tool, args: [target], label: `${tool} ${target}` };
  }
  return null;
}

function corroboratesScript(run: Command, facts: RepoFacts): boolean {
  if (facts.stack !== "node" || !facts.packageJson) return false;
  const scripts = (facts.packageJson.scripts ?? {}) as Record<string, string>;
  const npmScript = run.args[0] === "run" ? run.args[1] : run.args[0];
  return typeof npmScript === "string" && Boolean(scripts[npmScript]);
}
