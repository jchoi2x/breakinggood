import { existsSync } from "node:fs";
import path from "node:path";
import type { HybridOptions } from "../hybrid/types.js";
import { parseUserRun } from "../hybrid/user-run.js";

export interface HybridCliInput {
  dir: string;
  sourcePath: string[];
  url: string;
  out?: string;
  run?: string;
  captureUrl?: string;
  maxInteractions?: number;
  workflowDepth?: number;
  noNetworkMutations?: boolean;
  planOnly?: boolean;
  captureOnly?: boolean;
  allowEgress?: boolean;
  sanitize?: boolean;
  yes?: boolean;
  open?: boolean;
  attachCdp?: string;
  attachUrlPrefix?: string;
  attachAllowedOrigin?: string[];
  provider?: string;
  model?: string;
}

export interface ParsedHybridTarget {
  mode: "hybrid";
  url: string;
  options: HybridOptions;
}

/** Validate hybrid CLI flags and normalize paths relative to `--dir`. */
export function parseHybridTarget(input: HybridCliInput): ParsedHybridTarget {
  const dir = path.resolve(input.dir);
  if (!existsSync(dir)) {
    throw new Error(`--dir does not exist: ${dir}`);
  }

  const sourcePaths = input.sourcePath?.length ? input.sourcePath : [];
  if (sourcePaths.length === 0) {
    throw new Error("hybrid mode requires at least one --source-path");
  }

  const normalizedSources = sourcePaths.map((sp) => resolveSourceUnderDir(dir, sp));

  let pageUrl: URL;
  try {
    pageUrl = new URL(input.url);
  } catch {
    throw new Error(`--url is not a valid URL: ${input.url}`);
  }

  if (input.captureUrl) {
    const cap = new URL(input.captureUrl);
    const host = cap.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error("--capture-url must be localhost or 127.0.0.1");
    }
  }

  const attachCdp = input.attachCdp ?? process.env.BREAKINGGOOD_CDP_URL;

  const options: HybridOptions = {
    dir,
    sourcePaths: normalizedSources,
    url: pageUrl.toString(),
    out: input.out ? path.resolve(input.out) : undefined,
    userRun: input.run ? parseUserRun(input.run) : undefined,
    captureUrl: input.captureUrl,
    maxInteractions: input.maxInteractions ?? 40,
    workflowDepth: input.workflowDepth ?? 3,
    noNetworkMutations: input.noNetworkMutations ?? true,
    planOnly: input.planOnly ?? false,
    captureOnly: input.captureOnly ?? false,
    allowEgress: input.allowEgress ?? false,
    sanitize: input.sanitize ?? false,
    yes: input.yes ?? false,
    open: input.open ?? true,
    attachCdp,
    attachUrlPrefix: input.attachUrlPrefix,
    attachAllowedOrigins: input.attachAllowedOrigin,
    provider: input.provider,
    model: input.model,
  };

  return { mode: "hybrid", url: options.url, options };
}

function resolveSourceUnderDir(repoRoot: string, sourcePath: string): string {
  const resolved = path.resolve(repoRoot, sourcePath);
  const rel = path.relative(repoRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`--source-path must resolve inside --dir: ${sourcePath}`);
  }
  return rel.replace(/\\/g, "/");
}
