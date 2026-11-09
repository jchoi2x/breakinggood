import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Capture } from "../site/capture.js";
import type { EgressManifest, EgressSourceFile, InteractionMap, WorkflowTrace } from "./types.js";

const MAX_SOURCE_FILES = 50;
const MAX_EXCERPT_CHARS = 12_000;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const COOKIE_LINE_RE = /(?:^|\s)(?:[Cc]ookie|Set-Cookie)\s*:\s*.+$/i;
const AUTH_HEADER_RE = /Authorization\s*:\s*\S+/gi;

export class EgressNotAllowedError extends Error {
  constructor() {
    super(
      "Hybrid generation sends screenshots, source excerpts, and API samples to your configured AI provider. " +
        "Re-run with --allow-egress to proceed.",
    );
  }
}

export interface RequireEgressOptions {
  allowEgress?: boolean;
  planOnly?: boolean;
  captureOnly?: boolean;
}

/** Throw unless generation egress is explicitly allowed (never throws for plan/capture-only). */
export function requireEgress(opts: RequireEgressOptions): void {
  if (opts.planOnly || opts.captureOnly) return;
  if (!opts.allowEgress) throw new EgressNotAllowedError();
}

export interface BuildEgressManifestInput {
  allowEgress: boolean;
  repoRoot: string;
  interactionMap: InteractionMap;
  baseline: Capture;
  trace: WorkflowTrace;
}

/** Summarize what would be sent to an external model before `provider.complete`. */
export function buildEgressManifest(input: BuildEgressManifestInput): EgressManifest {
  const sourceFiles = collectSourceFileSizes(input.repoRoot, input.interactionMap);
  const imageCount =
    input.baseline.screenshotsDesktop.length + input.baseline.screenshotsMobile.length;
  let networkBodyBytes = 0;
  for (const r of input.baseline.requests) {
    if (r.body) networkBodyBytes += Buffer.byteLength(r.body, "utf8");
  }
  void input.trace;
  return {
    version: 1,
    allowEgress: input.allowEgress,
    sourceFiles,
    imageCount,
    networkBodyBytes,
  };
}

function collectSourceFileSizes(repoRoot: string, map: InteractionMap): EgressSourceFile[] {
  const seen = new Set<string>();
  const out: EgressSourceFile[] = [];

  const pushFile = (rel: string) => {
    const norm = rel.split(path.sep).join("/");
    if (seen.has(norm)) return;
    seen.add(norm);
    const abs = path.join(repoRoot, norm);
    if (!existsSync(abs)) {
      out.push({ path: norm, bytes: 0 });
      return;
    }
    out.push({ path: norm, bytes: statSync(abs).size });
  };

  for (const rel of map.sourcePaths) pushFile(rel);
  for (const c of map.controls) pushFile(c.file);
  for (const u of map.unresolved) pushFile(u.file);

  return out.slice(0, MAX_SOURCE_FILES);
}

function redactLine(line: string): string {
  let l = line.replace(AUTH_HEADER_RE, "Authorization: [redacted]");
  if (COOKIE_LINE_RE.test(l)) {
    l = l.replace(COOKIE_LINE_RE, (m) => (/set-cookie/i.test(m) ? "Set-Cookie: [redacted]" : "Cookie: [redacted]"));
  }
  return l.replace(BEARER_RE, "Bearer [redacted]");
}

/** Redact credentials, cookies, JWTs, and emails from text destined for an LLM. */
export function redactForEgress(text: string): string {
  const lines = text.split("\n").map(redactLine);
  return lines
    .join("\n")
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(EMAIL_RE, "[redacted-email]");
}

/** Read capped source excerpts (redacted) for the hybrid generation prompt. */
export function readSourceExcerpts(repoRoot: string, interactionMap: InteractionMap): string {
  const files = new Set<string>();
  for (const c of interactionMap.controls) files.add(c.file);
  for (const rel of interactionMap.sourcePaths.slice(0, 30)) files.add(rel);

  const parts: string[] = [];
  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    let content = readFileSync(abs, "utf8");
    if (content.length > MAX_EXCERPT_CHARS) {
      content = content.slice(0, MAX_EXCERPT_CHARS) + "\n… [truncated]";
    }
    parts.push(`### ${rel}\n${content}`);
  }
  return redactForEgress(parts.join("\n\n"));
}
