import type { Command, RepoFacts, RunPlan } from "../repo/detect-stack.js";
import { heuristicPlan } from "../repo/detect-stack.js";
import type { Provider } from "../ai/provider.js";
import { aiRefinePlan } from "../repo/ai-plan.js";
import type { UserRunSpec } from "./types.js";
import { mergeRunDocsIntoPlan, type RunDocEvidence } from "./run-discovery.js";

const FORBIDDEN_CMD = /\bsudo\b/i;
const FORBIDDEN_PIPELINE = /\bcurl\b|\bwget\b|rm\s+-rf|\|\s*sh\b/i;

/** Reject commands that match the AI planner denylist (sudo, curl|sh, etc.). */
export function assertAllowedRunCommand(cmd: string, args: string[]): void {
  const joined = [cmd, ...args].join(" ");
  if (FORBIDDEN_CMD.test(joined) || FORBIDDEN_PIPELINE.test(joined)) {
    throw new Error(`Refusing unsafe run command: ${joined}`);
  }
}

/** Parse `--run "npm run dev"` into `{ cmd, args }` without shell interpolation. */
export function parseUserRun(run: string): UserRunSpec {
  const trimmed = run.trim();
  if (!trimmed) throw new Error("--run must not be empty");
  const parts = splitArgv(trimmed);
  if (parts.length === 0) throw new Error("--run must not be empty");
  const cmd = parts[0]!;
  const args = parts.slice(1);
  assertAllowedRunCommand(cmd, args);
  return { cmd, args };
}

export function userRunToCommand(spec: UserRunSpec): Command {
  const label = [spec.cmd, ...spec.args].join(" ");
  return { cmd: spec.cmd, args: spec.args, label };
}

export interface ResolveRunPlanOptions {
  userRun?: UserRunSpec;
  docs?: RunDocEvidence[];
  provider?: Provider | null;
  /** When true, call AI even if user supplied `--run`. */
  forceAiPlan?: boolean;
}

/**
 * Priority: user run > doc+heuristic merge > AI refine > heuristic alone.
 * Produces `RunPlan` with provenance in `reasons[]`.
 */
export async function resolveRunPlan(
  facts: RepoFacts,
  opts: ResolveRunPlanOptions = {},
): Promise<RunPlan> {
  if (opts.userRun && !opts.forceAiPlan) {
    let plan = heuristicPlan(facts);
    plan = applyUserRun(plan, opts.userRun);
    return plan;
  }

  let plan = heuristicPlan(facts);
  if (opts.docs?.length) {
    plan = mergeRunDocsIntoPlan(plan, opts.docs, facts);
  }

  if (opts.provider && (opts.forceAiPlan || !plan.confident || !plan.run)) {
    plan = await aiRefinePlan(opts.provider, facts, plan);
  }

  if (opts.userRun) {
    plan = applyUserRun(plan, opts.userRun);
  }

  return plan;
}

export function applyUserRun(plan: RunPlan, userRun: UserRunSpec): RunPlan {
  const run = userRunToCommand(userRun);
  assertAllowedRunCommand(run.cmd, run.args);
  const ports = userRun.ports?.length ? userRun.ports : plan.ports;
  return {
    ...plan,
    run,
    ports,
    confident: true,
    reasons: [...plan.reasons, `user: --run ${run.label}`],
  };
}

function splitArgv(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
