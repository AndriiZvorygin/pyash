import fs from "node:fs/promises";
import path from "node:path";

const BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];
const ROLE_FILE_ORDER = ["ROLE.md", "ROLES.md"];

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function resolveBaseIdentityDir(agentHouse) {
  if (!agentHouse) return "";
  const houseDir = path.dirname(agentHouse);
  const houseName = path.basename(agentHouse);
  if (!houseDir || houseName === "base") return "";
  return path.join(houseDir, "base", "identity");
}

function formatSection(title, content) {
  if (!content) return "";
  return `## ${title}\n\n${content}`;
}

async function loadBootstrapFiles(identityDir, { baseIdentityDir = "" } = {}) {
  const parts = [];
  for (const filename of BOOTSTRAP_FILES) {
    const basePath = baseIdentityDir ? path.join(baseIdentityDir, filename) : "";
    const filePath = path.join(identityDir, filename);
    const baseContent = basePath ? await readFileIfExists(basePath) : "";
    const content = await readFileIfExists(filePath);
    const merged = [baseContent, content].filter(Boolean).join("\n\n");
    if (merged) parts.push(formatSection(filename, merged));
  }
  return parts.join("\n\n");
}

async function loadRolesContext(agentHouse) {
  if (!agentHouse) return "";
  const rolesDir = path.join(agentHouse, "roles");
  let entries = [];
  try {
    entries = await fs.readdir(rolesDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  if (!files.length) return "";
  const ordered = [
    ...ROLE_FILE_ORDER.filter(name => files.includes(name)),
    ...files.filter(name => !ROLE_FILE_ORDER.includes(name)).sort()
  ];
  const parts = [];
  for (const filename of ordered) {
    const filePath = path.join(rolesDir, filename);
    const content = await readFileIfExists(filePath);
    if (content) parts.push(formatSection(filename, content));
  }
  if (!parts.length) return "";
  return `# Roles\n\n${parts.join("\n\n")}`;
}

async function loadSummaryContext(memoryDir) {
  const summaryPath = path.join(memoryDir, "SUMMARY.md");
  const summary = await readFileIfExists(summaryPath);
  if (!summary) return "";
  return `# Summary\n\n${summary}`;
}

async function loadMemoryContext(memoryDir) {
  const memoryPath = path.join(memoryDir, "MEMORY.md");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const dailyPath = path.join(memoryDir, `${day}.md`);
  const longTerm = await readFileIfExists(memoryPath);
  const daily = await readFileIfExists(dailyPath);
  const parts = [];
  if (longTerm) parts.push(`## Long-term Memory\n${longTerm}`);
  if (daily) parts.push(`## Today's Notes\n${daily}`);
  if (!parts.length) return "";
  return `# Memory\n\n${parts.join("\n\n")}`;
}

function buildIdentityBlock({ agentHouse, mindName } = {}) {
  const now = new Date().toISOString();
  const lines = ["# Pyash agent", "", "## Current Time", now];
  if (mindName) {
    lines.push("", "## Agent", String(mindName));
  }
  if (agentHouse) {
    lines.push("", "## Agent House", String(agentHouse));
  }
  return lines.join("\n");
}

function buildToolExplainerBlock() {
  return [
    "# Tool Notes",
    "",
    "Use memory tools deliberately:",
    "- `be remember ... during date today` for daily notes.",
    "- `be remember ... during date tomorrow` for reminders (writes tomorrow's file).",
    "- `be remember ... during date YYYY-MM-DD` for future reminders.",
    "- `be remember ... during wo always` for long-term memory."
  ].join("\n");
}

export async function buildAgentSystemPrompt({
  agentHouse,
  mindName,
  configPrompt,
  includeMemory = true,
  includeIdentity = true,
  includeRoles = true,
  includeSummary = true,
  includeToolExplainer = true
} = {}) {
  const parts = [];
  if (includeIdentity) {
    parts.push(buildIdentityBlock({ agentHouse, mindName }));
  }
  if (configPrompt) {
    parts.push(String(configPrompt));
  }
  if (agentHouse) {
    const identityDir = path.join(agentHouse, "identity");
    const baseIdentityDir = resolveBaseIdentityDir(agentHouse);
    const bootstrap = await loadBootstrapFiles(identityDir, { baseIdentityDir });
    if (bootstrap) parts.push(bootstrap);
  }
  if (includeRoles && agentHouse) {
    const roles = await loadRolesContext(agentHouse);
    if (roles) parts.push(roles);
  }
  if (includeSummary && agentHouse) {
    const memoryDir = path.join(agentHouse, "memory");
    const summary = await loadSummaryContext(memoryDir);
    if (summary) parts.push(summary);
  }
  if (includeMemory && agentHouse) {
    const memoryDir = path.join(agentHouse, "memory");
    const memory = await loadMemoryContext(memoryDir);
    if (memory) parts.push(memory);
  }
  if (includeToolExplainer) {
    parts.push(buildToolExplainerBlock());
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}

export async function buildAgentNamingPrompt({ agentHouse, configPrompt } = {}) {
  const parts = [];
  if (configPrompt) parts.push(String(configPrompt));
  if (agentHouse) {
    const identityDir = path.join(agentHouse, "identity");
    const baseIdentityDir = resolveBaseIdentityDir(agentHouse);
    const bootstrap = await loadBootstrapFiles(identityDir, { baseIdentityDir });
    if (bootstrap) parts.push(bootstrap);
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}

export { loadMemoryContext };
