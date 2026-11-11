import { resolveTextFromMapEntry } from "./media.mjs";

export function parseCharacterRouteSpec(name, raw) {
  const fields = {};
  for (const part of String(raw ?? "").split(/[;\n]+/u)) {
    const match = /^\s*([a-z_ -]+)\s*[:=]\s*([\s\S]*?)\s*$/iu.exec(part);
    if (!match) continue;
    fields[String(match[1] ?? "").trim().toLowerCase().replace(/[ -]+/gu, "_")] = String(match[2] ?? "").trim();
  }
  const aliases = String(fields.aliases ?? fields.alias ?? name ?? "")
    .split(/\s+or\s+|[|,]/iu)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    name: String(name ?? "").trim(),
    aliases,
    workflowName: String(fields.workflow ?? fields.workflow_name ?? "").trim(),
    prefix: String(fields.prefix ?? "").trim(),
    suffix: String(fields.suffix ?? "").trim(),
    template: String(fields.template ?? "").trim()
  };
}

export function characterDrawRoutes(rememberFn) {
  const fact = rememberFn?.("draw character routes");
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") return [];
  const routes = [];
  for (const [name, entry] of Object.entries(map)) {
    const raw = resolveTextFromMapEntry(entry);
    if (!raw) continue;
    const route = parseCharacterRouteSpec(name, raw);
    if (route.aliases.length && route.workflowName) routes.push(route);
  }
  return routes;
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function textMatchesAlias(text, alias) {
  const pattern = new RegExp("(?:^|[^A-Za-z0-9_])" + escapeRegExp(alias) + "(?:$|[^A-Za-z0-9_])", "iu");
  return pattern.test(String(text ?? ""));
}

export function findCharacterDrawRoute(sourceText, rememberFn) {
  const text = String(sourceText ?? "");
  if (!text.trim()) return null;
  return characterDrawRoutes(rememberFn).find((route) => route.aliases.some((alias) => textMatchesAlias(text, alias))) ?? null;
}

export function findCharacterDrawRouteByWorkflow(workflowName, rememberFn) {
  const workflow = String(workflowName ?? "").trim();
  if (!workflow) return null;
  return characterDrawRoutes(rememberFn).find((route) => route.workflowName === workflow) ?? null;
}

export function composeCharacterDrawPrompt(route, scenePrompt) {
  const scene = String(scenePrompt ?? "").trim();
  const template = String(route?.template ?? "").trim();
  if (template) return template.replace(/\[\[scene\]\]/gu, scene).trim();
  return [route?.prefix, scene, route?.suffix]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

