import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { parse } from "../understand/index.mjs";
import { mapSentenceToPyash } from "../verbs/exchange/json_map.mjs";
import { resolveWorldAgentHouseDirectory } from "../library/agent_command_policy.mjs";

const ORGANIZATION_FILE = path.join("conduct", "organization.pya");
const ORGANIZATION_MAP_NAME = "organization";
const EMPTY_ORGANIZATION = Object.freeze({
  role: "",
  supervisor: "",
  responsibilities: Object.freeze([]),
  domains: Object.freeze([])
});

function text(value) {
  return String(value ?? "").trim();
}

function mapValue(input = {}) {
  if (input?.ob?.map && typeof input.ob.map === "object" && !Array.isArray(input.ob.map)) {
    return input.ob.map;
  }
  if (input?.map && typeof input.map === "object" && !Array.isArray(input.map)) {
    return input.map;
  }
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function primitiveValue(entry) {
  if (entry == null) return undefined;
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry;
  if (entry.text !== undefined) return entry.text;
  if (entry.num !== undefined) return entry.num;
  if (entry.boolean !== undefined) return entry.boolean;
  if (entry.ob?.text !== undefined) return entry.ob.text;
  if (entry.ob?.num !== undefined) return entry.ob.num;
  if (entry.ob?.boolean !== undefined) return entry.ob.boolean;
  return undefined;
}

function vectorValue(entry) {
  const values = entry?.ve?.values ?? entry?.ob?.ve?.values;
  if (Array.isArray(values)) return values;
  const primitive = primitiveValue(entry);
  return primitive === undefined ? [] : [primitive];
}

function orderedTextList(value) {
  const source = Array.isArray(value) ? value : vectorValue(value);
  const out = [];
  for (const item of source) {
    const normalized = text(primitiveValue(item) ?? item);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function normalizeAgentOrganization(input = {}) {
  const map = mapValue(input);
  return {
    role: text(primitiveValue(map.role) ?? map.role),
    supervisor: text(primitiveValue(map.supervisor) ?? map.supervisor),
    responsibilities: orderedTextList(map.responsibilities),
    domains: orderedTextList(map.domains)
  };
}

export function emptyAgentOrganization() {
  return {
    role: EMPTY_ORGANIZATION.role,
    supervisor: EMPTY_ORGANIZATION.supervisor,
    responsibilities: [],
    domains: []
  };
}

export function agentOrganizationHash(input = {}) {
  const normalized = normalizeAgentOrganization(input);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function organizationPath(agentRoot) {
  return path.join(String(agentRoot), ORGANIZATION_FILE);
}

export function resolveAgentOrganizationPath({ worldRoot, agentName, agentRoot } = {}) {
  const root = agentRoot || resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName,
    includeFallback: true
  });
  return root ? organizationPath(root) : "";
}

function organizationSentence(normalized, hash) {
  return {
    mood: "ya",
    su: { name: ORGANIZATION_MAP_NAME },
    be: "map",
    ob: {
      map: {
        domains: { ve: { type: "text", values: normalized.domains } },
        responsibilities: { ve: { type: "text", values: normalized.responsibilities } },
        role: { text: normalized.role },
        "spec hash": { text: hash },
        supervisor: { text: normalized.supervisor }
      }
    }
  };
}

export function agentOrganizationToPyash(input = {}) {
  const normalized = normalizeAgentOrganization(input);
  return `${mapSentenceToPyash(organizationSentence(normalized, agentOrganizationHash(normalized)))}\n`;
}

function organizationFromText(source) {
  const block = String(source ?? "").match(
    /su name organization be map def\n([\s\S]*?)\nprah/i
  );
  if (!block) return emptyAgentOrganization();
  const map = {};
  for (const rawLine of String(block[1] ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const sentence = parse(line);
      if (sentence?.su?.name) map[sentence.su.name] = sentence.ob;
    } catch {
      // A malformed optional organization line does not make a legacy house unreadable.
    }
  }
  return normalizeAgentOrganization(map);
}

export async function readAgentOrganization({ worldRoot, agentName, agentRoot } = {}) {
  const target = resolveAgentOrganizationPath({ worldRoot, agentName, agentRoot });
  if (!target) return emptyAgentOrganization();
  try {
    return organizationFromText(await fs.readFile(target, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return emptyAgentOrganization();
    throw err;
  }
}

export async function writeAgentOrganization({ agentRoot, organization } = {}) {
  if (!agentRoot) throw new Error("agentRoot is required");
  const target = organizationPath(agentRoot);
  const desired = agentOrganizationToPyash(organization);
  let existing = null;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  if (existing === desired) return { organizationPath: target, changed: false };
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, desired, "utf8");
  await fs.rename(temporary, target);
  return { organizationPath: target, changed: true };
}
