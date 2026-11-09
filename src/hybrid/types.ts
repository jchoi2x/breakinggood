import path from "node:path";

/** Parsed user override for how to start the dev server (`--run`). */
export interface UserRunSpec {
  cmd: string;
  args: string[];
  ports?: number[];
  captureUrl?: string;
  notes?: string;
}

export interface InteractionControl {
  selectorHint?: string;
  label?: string;
  text?: string;
  file: string;
  line: number;
  handlerRef: string;
  routeEffects?: string[];
  networkHints?: string[];
}

export interface InteractionMapUnresolved {
  file: string;
  line: number;
  reason: string;
}

/** Static source map: controls → handlers (artifact: `interaction-map.json`). */
export interface InteractionMap {
  version: 1;
  sourcePaths: string[];
  controls: InteractionControl[];
  unresolved: InteractionMapUnresolved[];
}

export type WorkflowStepStatus = "verified" | "partial" | "unverified";

export interface WorkflowNetworkRequest {
  method: string;
  url: string;
  status?: number;
}

export interface WorkflowStep {
  index: number;
  action: string;
  selector?: string;
  status: WorkflowStepStatus;
  url?: string;
  error?: string;
  outlineSlice?: string[];
  screenshotRef?: string;
  requests?: WorkflowNetworkRequest[];
}

/** Interactive capture trace (artifact: `workflow-trace.json`). */
export interface WorkflowTrace {
  version: 1;
  captureUrl: string;
  steps: WorkflowStep[];
}

export interface EgressSourceFile {
  path: string;
  bytes: number;
}

/** Pre-LLM manifest of what would leave the machine (artifact: `egress-manifest.json`). */
export interface EgressManifest {
  version: 1;
  allowEgress: boolean;
  /** Generated frontend scaffold (e.g. vite-react-primereact-tailwind-v4). */
  outputStack: string;
  sourceFiles: EgressSourceFile[];
  imageCount: number;
  networkBodyBytes: number;
}

export interface HybridRunProvenance {
  command?: string;
  reasons: string[];
  captureUrl: string;
}

/** Inputs merged for hybrid generation and capture phases. */
export interface HybridContext {
  dir: string;
  sourcePaths: string[];
  entryUrl: string;
  interactionMap?: InteractionMap;
  workflowTrace?: WorkflowTrace;
  egressManifest?: EgressManifest;
  run?: HybridRunProvenance;
  operatorNotes?: string;
}

/** Resolved artifact paths under `<output>/.breakinggood/hybrid/`. */
export interface HybridArtifacts {
  root: string;
  interactionMap: string;
  workflowTrace: string;
  egressManifest: string;
  interactivityReport: string;
}

export function hybridArtifactPaths(outputDir: string): HybridArtifacts {
  const root = path.join(outputDir, ".breakinggood", "hybrid");
  return {
    root,
    interactionMap: path.join(root, "interaction-map.json"),
    workflowTrace: path.join(root, "workflow-trace.json"),
    egressManifest: path.join(root, "egress-manifest.json"),
    interactivityReport: path.join(root, "interactivity-report.md"),
  };
}

export interface HybridOptions {
  dir: string;
  sourcePaths: string[];
  url: string;
  out?: string;
  userRun?: UserRunSpec;
  captureUrl?: string;
  maxInteractions?: number;
  workflowDepth?: number;
  noNetworkMutations?: boolean;
  allowEgress?: boolean;
  planOnly?: boolean;
  captureOnly?: boolean;
  yes?: boolean;
  sanitize?: boolean;
  attachCdp?: string;
  attachUrlPrefix?: string;
  attachAllowedOrigins?: string[];
  provider?: string;
  model?: string;
  open?: boolean;
}
