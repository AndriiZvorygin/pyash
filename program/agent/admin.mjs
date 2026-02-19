import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { sentenceToPyash } from "../beautiful.mjs";
import { discoverScheduledJobs } from "./scheduler.mjs";
import { schedulerBegin } from "./scheduler_control.mjs";
import { setServiceEnabled } from "./scheduler_service_control.mjs";
import {
  listWorldDeclaredAgentHouses,
  resolveWorldAgentHouseDirectory
} from "../library/agent_command_policy.mjs";

const REQUIRED_AGENT_DIRS = [
  "identity",
  "memory",
  "session",
  "conduct",
  "program",
  "artifacts",
  path.join("gold", "accepted"),
  path.join("gold", "rejected")
];

function normalizeAgentName(value) {
  return String(value ?? "").trim();
}

function sanitizeLaneName(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "session";
  const compact = text
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return compact || "session";
}

function isoNow(nowFn = () => new Date()) {
  const value = nowFn();
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function ensureDirectoryTree(rootPath, relativeDirs) {
  for (const rel of relativeDirs) {
    await fs.mkdir(path.join(rootPath, rel), { recursive: true });
  }
}

async function ensureBaseIdentityFiles(worldRoot) {
  const baseIdentityDir = path.join(worldRoot, "house", "base", "identity");
  const defaults = {
    "AGENTS.md": "# Base Agent Guide\n\nUse house-local program and artifacts folders.\n",
    "SOUL.md": "# Soul\n\nAct with deterministic, verifiable changes.\n",
    "USER.md": "# User\n\nPrefer concise, actionable updates.\n",
    "TOOLS.md": "# Tools\n\nUse local tools first; record outputs in artifacts.\n",
    "IDENTITY.md": "# Identity\n\nBase agent identity template.\n"
  };
  await fs.mkdir(baseIdentityDir, { recursive: true });
  for (const [fileName, content] of Object.entries(defaults)) {
    const fullPath = path.join(baseIdentityDir, fileName);
    if (!(await pathExists(fullPath))) {
      await fs.writeFile(fullPath, content, "utf8");
    }
  }
}

function resolveAgentHouseRoot(worldRoot, agentName) {
  return resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName,
    includeFallback: true
  }) ?? path.join(worldRoot, "house", String(agentName ?? "").trim());
}

async function copyBaseIdentityFiles(worldRoot, agentName) {
  const baseIdentityDir = path.join(worldRoot, "house", "base", "identity");
  const agentIdentityDir = path.join(resolveAgentHouseRoot(worldRoot, agentName), "identity");
  await fs.mkdir(agentIdentityDir, { recursive: true });
  let entries = [];
  try {
    entries = await fs.readdir(baseIdentityDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(baseIdentityDir, entry.name);
    const target = path.join(agentIdentityDir, entry.name);
    if (await pathExists(target)) continue;
    await fs.copyFile(source, target);
  }
}

function heartbeatJobName(agentName) {
  return `${agentName} heartbeat`;
}

function defaultCalendarText({ agentName, intervalMinutes }) {
  const job = heartbeatJobName(agentName);
  const lane = sanitizeLaneName(job);
  const lines = [
    sentenceToPyash({
      mood: "ya",
      su: { name: job },
      for: { name: agentName },
      with: { wo: "tools" },
      vyah: { habit: true },
      during: { minute: Number(intervalMinutes) },
      be: "calendar"
    }),
    sentenceToPyash({
      mood: "ya",
      su: { name: `${job} lane` },
      ob: { text: lane },
      be: "text"
    })
  ];
  return `# managed by agent_admin\n${lines.join("\n")}\n`;
}

function defaultImportConductText() {
  const lines = [
    "su name import be map def",
    '  su name default ob text "" ya',
    '  su name photograph ob text "" ya',
    '  su name documentation ob text "" ya',
    '  su name audio ob text "" ya',
    '  su name text ob text "" ya',
    '  su name file ob text "" ya',
    '  su name read tool ob text "" ya',
    '  su name see tool ob text "" ya',
    '  su name command tool ob text "" ya',
    '  su name repair tool ob text "" ya',
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

async function ensureImportConductFile({ worldRoot, agentName }) {
  const importPath = path.join(resolveAgentHouseRoot(worldRoot, agentName), "conduct", "import.pya");
  const exists = await pathExists(importPath);
  if (exists) return { importPath, changed: false };
  await fs.writeFile(importPath, defaultImportConductText(), "utf8");
  return { importPath, changed: true };
}

async function writeManagedConductCalendar({ worldRoot, agentName, intervalMinutes }) {
  const calendarPath = path.join(resolveAgentHouseRoot(worldRoot, agentName), "conduct", "calendar.pya");
  const desired = defaultCalendarText({ agentName, intervalMinutes });
  const existing = await readTextIfExists(calendarPath);
  if (existing != null && !existing.startsWith("# managed by agent_admin")) {
    return { calendarPath, changed: false, managed: false };
  }
  if (existing === desired) return { calendarPath, changed: false, managed: true };
  await fs.writeFile(calendarPath, desired, "utf8");
  return { calendarPath, changed: true, managed: true };
}

async function upsertPurposeIdentity({ worldRoot, agentName, purpose }) {
  if (!purpose) return { changed: false, identityPath: null };
  const identityPath = path.join(resolveAgentHouseRoot(worldRoot, agentName), "identity", "IDENTITY.md");
  const markerStart = "<!-- managed-purpose:start -->";
  const markerEnd = "<!-- managed-purpose:end -->";
  const managedBlock = [
    markerStart,
    "## Purpose",
    "",
    String(purpose).trim(),
    markerEnd
  ].join("\n");
  const existing = (await readTextIfExists(identityPath)) ?? "";
  if (existing.includes(markerStart) && existing.includes(markerEnd)) {
    const next = existing.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "m"), managedBlock);
    if (next === existing) return { changed: false, identityPath };
    await fs.writeFile(identityPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return { changed: true, identityPath };
  }
  const prefix = existing.trimEnd();
  const next = prefix ? `${prefix}\n\n${managedBlock}\n` : `${managedBlock}\n`;
  await fs.writeFile(identityPath, next, "utf8");
  return { changed: true, identityPath };
}

function managedSpecHash(spec) {
  const canonical = JSON.stringify(spec);
  return createHash("sha256").update(canonical).digest("hex");
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quotePyashText(value) {
  return JSON.stringify(String(value ?? ""));
}

function policyPathTextForAgentRoot({ worldRoot, agentRoot }) {
  const resolvedWorld = path.resolve(worldRoot);
  const resolvedAgentRoot = path.resolve(agentRoot);
  const repoRoot = path.dirname(resolvedWorld);
  const relative = path.relative(repoRoot, resolvedAgentRoot);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return resolvedAgentRoot;
}

function buildAgentPolicyBlock({ agentName, housePathText }) {
  return [
    `su name ${agentName} directory license be map def`,
    `  su name ${quotePyashText(housePathText)} ob ve text "read" "write" "command" ya`,
    "prah"
  ].join("\n");
}

async function upsertAgentPolicyRegistration({ worldRoot, agentName, agentRoot }) {
  const policyPath = path.join(worldRoot, "conduct", "agent.pya");
  const housePathText = policyPathTextForAgentRoot({ worldRoot, agentRoot });
  const houseLine = `su name ${agentName} house directory ob filename ${quotePyashText(housePathText)} ya`;
  const existing = (await readTextIfExists(policyPath)) ?? "";
  let nextText = existing;
  const housePattern = new RegExp(`^\\s*su name ${escapeRegex(agentName)} house directory ob filename .* ya\\s*$`, "i");
  const lines = nextText.split("\n");
  const kept = [];
  let houseInserted = false;
  for (const line of lines) {
    if (!housePattern.test(line.trim())) {
      kept.push(line);
      continue;
    }
    if (houseInserted) continue;
    kept.push(houseLine);
    houseInserted = true;
  }
  nextText = kept.join("\n");
  if (!houseInserted) {
    const prefix = nextText.trimEnd();
    nextText = prefix ? `${prefix}\n${houseLine}\n` : `${houseLine}\n`;
  }
  const mapPattern = new RegExp(`su name ${escapeRegex(agentName)} directory license be map def[\\s\\S]*?\\nprah`, "m");
  if (!mapPattern.test(nextText)) {
    const prefix = nextText.trimEnd();
    const block = buildAgentPolicyBlock({ agentName, housePathText });
    nextText = prefix ? `${prefix}\n${block}\n` : `${block}\n`;
  }
  const normalizedExisting = `${existing.trimEnd()}\n`;
  const normalizedNext = `${nextText.trimEnd()}\n`;
  if (normalizedNext === normalizedExisting) return { changed: false, policyPath };
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, normalizedNext, "utf8");
  return { changed: true, policyPath };
}

async function writeManagedState({ worldRoot, agentName, spec, hash }) {
  const managedPath = path.join(resolveAgentHouseRoot(worldRoot, agentName), "conduct", "managed.pya");
  const lines = [
    "# managed by agent_admin",
    sentenceToPyash({ mood: "ya", su: { name: "managed version" }, ob: { num: 1 }, be: "num" }),
    sentenceToPyash({ mood: "ya", su: { name: "managed spec hash" }, ob: { text: hash }, be: "text" }),
    sentenceToPyash({ mood: "ya", su: { name: "managed agent name" }, ob: { text: spec.agentName }, be: "text" }),
    sentenceToPyash({ mood: "ya", su: { name: "managed purpose" }, ob: { text: spec.purpose }, be: "text" }),
    sentenceToPyash({ mood: "ya", su: { name: "managed interval minutes" }, ob: { num: spec.intervalMinutes }, be: "num" })
  ];
  const body = `${lines.join("\n")}\n`;
  const existing = await readTextIfExists(managedPath);
  if (existing === body) return { managedPath, changed: false };
  await fs.writeFile(managedPath, body, "utf8");
  return { managedPath, changed: true };
}

async function readManagedHash({ worldRoot, agentName }) {
  const managedPath = path.join(resolveAgentHouseRoot(worldRoot, agentName), "conduct", "managed.pya");
  const text = await readTextIfExists(managedPath);
  if (!text) return null;
  const m = text.match(/su name managed spec hash ob text "([^"]+)"/);
  return m?.[1] ?? null;
}

export async function ensureBaseHouseTemplate({ worldRoot } = {}) {
  if (!worldRoot) throw new Error("worldRoot is required");
  const baseHouse = path.join(worldRoot, "house", "base");
  await ensureDirectoryTree(baseHouse, REQUIRED_AGENT_DIRS);
  await ensureBaseIdentityFiles(worldRoot);
  return {
    worldRoot,
    baseHouse,
    dirs: REQUIRED_AGENT_DIRS
  };
}

export async function listAgents({ worldRoot, includeBase = false } = {}) {
  if (!worldRoot) throw new Error("worldRoot is required");
  const names = listWorldDeclaredAgentHouses({ worldRoot }).map((entry) => entry.agentName);
  if (includeBase && !names.includes("base")) names.push("base");
  return names
    .filter((name) => includeBase || name !== "base")
    .sort((a, b) => a.localeCompare(b, "en"));
}

export async function establishAgent({
  worldRoot,
  agentName,
  purpose = "",
  intervalMinutes = 24,
  writePolicy = true,
  nowFn
} = {}) {
  if (!worldRoot) throw new Error("worldRoot is required");
  const normalized = normalizeAgentName(agentName);
  if (!normalized) throw new Error("agentName is required");
  await ensureBaseHouseTemplate({ worldRoot });
  const agentRoot = resolveAgentHouseRoot(worldRoot, normalized);
  const existedBefore = await pathExists(agentRoot);
  await ensureDirectoryTree(agentRoot, REQUIRED_AGENT_DIRS);
  await copyBaseIdentityFiles(worldRoot, normalized);
  const desiredSpec = {
    agentName: normalized,
    purpose: String(purpose).trim(),
    intervalMinutes: Number(intervalMinutes)
  };
  const desiredHash = managedSpecHash(desiredSpec);
  const priorHash = await readManagedHash({ worldRoot, agentName: normalized });
  const created = !existedBefore;
  const changes = [];
  if (writePolicy) {
    const policyResult = await upsertAgentPolicyRegistration({
      worldRoot,
      agentName: normalized,
      agentRoot
    });
    if (policyResult.changed) changes.push("agent_policy");
  }
  let calendarResult = { calendarPath: null, changed: false };
  let purposeResult = { changed: false };
  const importResult = await ensureImportConductFile({ worldRoot, agentName: normalized });
  if (importResult.changed) changes.push("import_conduct");
  if (priorHash !== desiredHash) {
    calendarResult = await writeManagedConductCalendar({
      worldRoot,
      agentName: normalized,
      intervalMinutes
    });
    if (calendarResult.changed) changes.push("calendar");
    purposeResult = await upsertPurposeIdentity({
      worldRoot,
      agentName: normalized,
      purpose
    });
    if (purposeResult.changed) changes.push("identity_purpose");
    const managedResult = await writeManagedState({
      worldRoot,
      agentName: normalized,
      spec: desiredSpec,
      hash: desiredHash
    });
    if (managedResult.changed) changes.push("managed_state");
  }
  const status = created ? "created" : (changes.length ? "updated" : "unchanged");
  return {
    action: "establish",
    status,
    worldRoot,
    agentName: normalized,
    agentRoot,
    calendarPath: calendarResult.calendarPath,
    calendarCreated: calendarResult.changed,
    purposeUpdated: purposeResult.changed,
    changed: changes.length > 0,
    changes
  };
}

export async function improveAgent({
  worldRoot,
  agentName,
  purpose = "",
  note = "",
  nowFn
} = {}) {
  if (!worldRoot) throw new Error("worldRoot is required");
  const normalized = normalizeAgentName(agentName);
  if (!normalized) throw new Error("agentName is required");
  const agentRoot = resolveAgentHouseRoot(worldRoot, normalized);
  if (!(await pathExists(agentRoot))) {
    throw new Error(`agent not found: ${normalized}`);
  }
  const stamp = isoNow(nowFn);
  const changes = [];
  if (purpose) {
    await writePurposeIdentity({ worldRoot, agentName: normalized, purpose, nowFn });
    changes.push("purpose");
  }
  if (note) {
    const filePath = path.join(agentRoot, "memory", "MEMORY.md");
    const payload = `\n## Improve Note\n\n${String(note).trim()}\n\nUpdated: ${stamp}\n`;
    await fs.appendFile(filePath, payload, "utf8");
    changes.push("note");
  }
  return {
    action: "improve",
    worldRoot,
    agentName: normalized,
    changed: changes.length > 0,
    fields: changes
  };
}

async function setAgentServicesEnabled({ worldRoot, agentName, enabled }) {
  const normalized = normalizeAgentName(agentName);
  const jobs = await discoverScheduledJobs({ worldRoot });
  const targets = jobs.filter((job) => job?.agentName === normalized);
  for (const job of targets) {
    await setServiceEnabled({ worldRoot, serviceName: job.jobName, enabled });
  }
  return targets.map((job) => job.jobName);
}

export async function beginAgent({ worldRoot, agentName, startScheduler = true } = {}) {
  const services = await setAgentServicesEnabled({ worldRoot, agentName, enabled: true });
  if (startScheduler) {
    await schedulerBegin({ worldRoot });
  }
  return {
    action: "begin",
    worldRoot,
    agentName: normalizeAgentName(agentName),
    enabledServices: services
  };
}

export async function stopAgent({ worldRoot, agentName } = {}) {
  const services = await setAgentServicesEnabled({ worldRoot, agentName, enabled: false });
  return {
    action: "stop",
    worldRoot,
    agentName: normalizeAgentName(agentName),
    disabledServices: services
  };
}

export async function restartAgent({ worldRoot, agentName, startScheduler = true } = {}) {
  await stopAgent({ worldRoot, agentName });
  const beginResult = await beginAgent({ worldRoot, agentName, startScheduler });
  return {
    action: "restart",
    worldRoot,
    agentName: normalizeAgentName(agentName),
    enabledServices: beginResult.enabledServices
  };
}
