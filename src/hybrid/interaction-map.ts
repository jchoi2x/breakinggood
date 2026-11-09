import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import type { RepoFacts } from "../repo/detect-stack.js";
import type { InteractionControl, InteractionMap, InteractionMapUnresolved } from "./types.js";

const MAX_FILES = 200;
const MAX_CONTROLS = 80;
const JSX_HANDLER_ATTRS = ["onClick", "onSubmit", "onChange"] as const;
const TSX_EXT = /\.(tsx|jsx)$/i;

export interface BuildInteractionMapOptions {
  maxFiles?: number;
  maxControls?: number;
}

/** Static React/TSX extraction → `interaction-map.json` schema. */
export function buildInteractionMap(
  repoRoot: string,
  sourcePaths: string[],
  _facts?: RepoFacts,
  opts: BuildInteractionMapOptions = {},
): InteractionMap {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxControls = opts.maxControls ?? MAX_CONTROLS;
  const resolvedPaths = resolveSourcePaths(repoRoot, sourcePaths);
  const controls: InteractionControl[] = [];
  const unresolved: InteractionMapUnresolved[] = [];
  const routeLinks = new Map<string, string[]>();

  let fileCount = 0;
  for (const abs of resolvedPaths) {
    if (fileCount >= maxFiles || controls.length >= maxControls) break;
    if (!TSX_EXT.test(abs)) continue;
    fileCount++;
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const text = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
    collectRoutes(sf, rel, routeLinks);
    collectControls(sf, rel, text, controls, unresolved, maxControls);
    collectNetworkHints(sf, rel, controls, maxControls);
    collectNavigateHooks(sf, rel, controls, unresolved, maxControls);
  }

  linkRouteEffects(controls, routeLinks);
  if (controls.length > maxControls) {
    controls.length = maxControls;
  }

  return {
    version: 1,
    sourcePaths: resolvedPaths.map((p) => path.relative(repoRoot, p).split(path.sep).join("/")),
    controls,
    unresolved,
  };
}

export function resolveSourcePaths(repoRoot: string, sourcePaths: string[]): string[] {
  const patterns =
    sourcePaths.length > 0 ? sourcePaths : ["src/**/*.{tsx,jsx}", "**/*.{tsx,jsx}"];
  const out = new Set<string>();
  for (const pattern of patterns) {
    for (const abs of expandPattern(repoRoot, pattern)) {
      if (existsSync(abs) && statSync(abs).isFile() && TSX_EXT.test(abs)) {
        out.add(path.resolve(abs));
      }
    }
  }
  return [...out].sort();
}

function expandPattern(repoRoot: string, pattern: string): string[] {
  const normalized = pattern.split(path.sep).join("/");
  if (!normalized.includes("*") && !normalized.includes("{")) {
    const abs = path.resolve(repoRoot, normalized);
    return existsSync(abs) ? [abs] : [];
  }
  const out = new Set<string>();
  for (const variant of bracePatternVariants(normalized)) {
    for (const abs of walkGlobs(repoRoot, variant.split("/"), repoRoot)) {
      out.add(abs);
    }
  }
  return [...out];
}

function bracePatternVariants(pattern: string): string[] {
  const m = pattern.match(/\{([^}]+)\}/);
  if (!m || m.index === undefined) return [pattern];
  const alts = m[1]!.split(",").map((s) => s.trim());
  const head = pattern.slice(0, m.index);
  const tail = pattern.slice(m.index + m[0].length);
  return alts.flatMap((alt) => bracePatternVariants(head + alt + tail));
}

function walkGlobs(base: string, parts: string[], repoRoot: string): string[] {
  if (parts.length === 0) {
    const abs = path.resolve(base);
    return abs.startsWith(repoRoot) ? [abs] : [];
  }
  const [head, ...rest] = parts;
  if (!head) return walkGlobs(base, rest, repoRoot);
  if (head === "**") {
    const out: string[] = [];
    if (rest.length === 0) {
      return listAllFiles(base, repoRoot);
    }
    out.push(...walkGlobs(base, rest, repoRoot));
    for (const ent of safeReaddir(base)) {
      const child = path.join(base, ent.name);
      if (ent.isDirectory()) {
        out.push(...walkGlobs(child, parts, repoRoot));
      }
    }
    return out;
  }
  if (head.includes("*")) {
    const re = globToRegExp(head);
    const out: string[] = [];
    for (const ent of safeReaddir(base)) {
      if (!re.test(ent.name)) continue;
      const child = path.join(base, ent.name);
      out.push(...walkGlobs(child, rest, repoRoot));
    }
    return out;
  }
  return walkGlobs(path.join(base, head), rest, repoRoot);
}

function listAllFiles(dir: string, repoRoot: string): string[] {
  const out: string[] = [];
  for (const ent of safeReaddir(dir)) {
    const child = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listAllFiles(child, repoRoot));
    } else if (child.startsWith(repoRoot)) {
      out.push(child);
    }
  }
  return out;
}

function safeReaddir(dir: string): { name: string; isDirectory(): boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  return /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
}

function collectRoutes(
  sf: ts.SourceFile,
  relFile: string,
  routeLinks: Map<string, string[]>,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createBrowserRouter"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isArrayLiteralExpression(arg)) {
        for (const el of arg.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          let routePath: string | undefined;
          let componentHint: string | undefined;
          for (const prop of el.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            if (prop.name.text === "path" && ts.isStringLiteral(prop.initializer)) {
              routePath = prop.initializer.text;
            }
            if (prop.name.text === "element") {
              componentHint = elementComponentRef(prop.initializer);
            }
          }
          if (routePath && componentHint) {
            const list = routeLinks.get(componentHint) ?? [];
            list.push(routePath);
            routeLinks.set(componentHint, list);
          }
        }
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = jsxTagName(node);
      if (tag === "Route") {
        let routePath: string | undefined;
        let componentHint: string | undefined;
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
          if (attr.name.text === "path" && attr.initializer && ts.isStringLiteral(attr.initializer)) {
            routePath = attr.initializer.text;
          }
          if (attr.name.text === "element" && attr.initializer) {
            componentHint = elementComponentRef(attr.initializer);
          }
        }
        if (routePath && componentHint) {
          const list = routeLinks.get(componentHint) ?? [];
          list.push(routePath);
          routeLinks.set(componentHint, list);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (routeLinks.size === 0 && relFile.endsWith("App.tsx")) {
    // fixture still valid without route extraction on other files
  }
}

function elementComponentRef(node: ts.Node): string | undefined {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    return jsxTagName(node);
  }
  if (ts.isJsxElement(node)) {
    return jsxTagName(node.openingElement);
  }
  return undefined;
}

function jsxTagName(node: ts.JsxOpeningLikeElement): string | undefined {
  const n = node.tagName;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) return n.name.text;
  return undefined;
}

function collectControls(
  sf: ts.SourceFile,
  relFile: string,
  _text: string,
  controls: InteractionControl[],
  unresolved: InteractionMapUnresolved[],
  maxControls: number,
): void {
  const visit = (node: ts.Node): void => {
    if (controls.length >= maxControls) return;
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if ((JSX_HANDLER_ATTRS as readonly string[]).includes(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const handlerRef = handlerRefText(node.initializer);
        const host = findJsxHost(node);
        const hints = host ? readSelectorHints(host) : {};
        const control: InteractionControl = {
          file: relFile,
          line,
          handlerRef: handlerRef ?? "?",
          ...hints,
        };
        if (!handlerRef || handlerRef === "?" || isNonLiteralHandler(handlerRef)) {
          unresolved.push({
            file: relFile,
            line,
            reason: `non-literal ${name} handler`,
          });
        }
        controls.push(control);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function collectNetworkHints(
  sf: ts.SourceFile,
  relFile: string,
  controls: InteractionControl[],
  maxControls: number,
): void {
  const visit = (node: ts.Node): void => {
    if (controls.length >= maxControls) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let kind: "fetch" | "axios" | undefined;
      if (ts.isIdentifier(callee) && callee.text === "fetch") kind = "fetch";
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "axios"
      ) {
        kind = "axios";
      }
      if (kind) {
        const url = literalFirstArg(node);
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const hint = url ? `${kind}(${url})` : kind;
        const nearest = controls.find((c) => c.file === relFile && Math.abs(c.line - line) < 12);
        if (nearest) {
          nearest.networkHints = [...(nearest.networkHints ?? []), hint];
        } else {
          controls.push({
            file: relFile,
            line,
            handlerRef: hint,
            networkHints: [hint],
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function collectNavigateHooks(
  sf: ts.SourceFile,
  relFile: string,
  controls: InteractionControl[],
  unresolved: InteractionMapUnresolved[],
  maxControls: number,
): void {
  const visit = (node: ts.Node): void => {
    if (controls.length >= maxControls) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useNavigate") {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      controls.push({
        file: relFile,
        line,
        handlerRef: "useNavigate()",
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "navigate"
    ) {
      const dest = literalFirstArg(node);
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!dest) {
        unresolved.push({ file: relFile, line, reason: "dynamic navigate target" });
      } else {
        const nearest = controls.find((c) => c.file === relFile && Math.abs(c.line - line) < 8);
        if (nearest) {
          nearest.routeEffects = [...(nearest.routeEffects ?? []), dest];
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function linkRouteEffects(controls: InteractionControl[], routeLinks: Map<string, string[]>): void {
  for (const c of controls) {
    const base = path.basename(c.file, path.extname(c.file));
    for (const [component, paths] of routeLinks) {
      if (component === base || c.file.includes(`/${component}.`)) {
        c.routeEffects = [...new Set([...(c.routeEffects ?? []), ...paths])];
      }
    }
  }
}

function handlerRefText(initializer: ts.JsxAttributeValue | undefined): string | undefined {
  if (!initializer) return undefined;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    return exprRef(initializer.expression);
  }
  return undefined;
}

function isNonLiteralHandler(handlerRef: string): boolean {
  if (handlerRef.includes("=>") || handlerRef.includes("function")) return false;
  return /^[a-zA-Z_$][\w$.]*$/.test(handlerRef);
}

function exprRef(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.getText();
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return ts.isBlock(expr.body) ? "function(){...}" : `() => ${expr.body.getText().slice(0, 40)}`;
  }
  return expr.getText().slice(0, 60);
}

function findJsxHost(attr: ts.JsxAttribute): ts.JsxOpeningLikeElement | undefined {
  let p: ts.Node | undefined = attr.parent;
  while (p) {
    if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) return p;
    if (ts.isJsxElement(p)) return p.openingElement;
    p = p.parent;
  }
  return undefined;
}

function readSelectorHints(host: ts.JsxOpeningLikeElement): Partial<InteractionControl> {
  let selectorHint: string | undefined;
  let label: string | undefined;
  let text: string | undefined;
  for (const prop of host.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === "data-testid" && prop.initializer && ts.isStringLiteral(prop.initializer)) {
      selectorHint = `[data-testid="${prop.initializer.text}"]`;
    }
    if (prop.name.text === "aria-label" && prop.initializer && ts.isStringLiteral(prop.initializer)) {
      label = prop.initializer.text;
      if (!selectorHint) selectorHint = `[aria-label="${prop.initializer.text}"]`;
    }
    if (prop.name.text === "type" && prop.initializer && ts.isStringLiteral(prop.initializer)) {
      if (prop.initializer.text === "submit") label = label ?? "submit";
    }
  }
  const tag = jsxTagName(host);
  if (!text && tag === "button") {
    const textChild = host.parent && ts.isJsxElement(host.parent) ? jsxInnerText(host.parent) : undefined;
    if (textChild) text = textChild;
  }
  return { selectorHint, label, text };
}

function jsxInnerText(el: ts.JsxElement): string | undefined {
  for (const child of el.children) {
    if (ts.isJsxText(child)) {
      const t = child.getText().trim();
      if (t) return t;
    }
    if (ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression)) {
      return child.expression.text;
    }
  }
  return undefined;
}

function literalFirstArg(call: ts.CallExpression): string | undefined {
  const arg = call.arguments[0];
  if (arg && ts.isStringLiteral(arg)) return arg.text;
  if (arg && ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}
