import fs from "node:fs/promises";
import path from "node:path";

const BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function formatSection(title, content) {
  if (!content) return "";
  return `## ${title}\n\n${content}`;
}

async function loadBootstrapFiles(identityDir) {
  const parts = [];
  for (const filename of BOOTSTRAP_FILES) {
    const filePath = path.join(identityDir, filename);
    const content = await readFileIfExists(filePath);
    if (content) parts.push(formatSection(filename, content));
  }
  return parts.join("\n\n");
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

export async function buildAgentSystemPrompt({
  agentHouse,
  mindName,
  configPrompt,
  includeMemory = true,
  includeIdentity = true
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
    const bootstrap = await loadBootstrapFiles(identityDir);
    if (bootstrap) parts.push(bootstrap);
  }
  if (includeMemory && agentHouse) {
    const memoryDir = path.join(agentHouse, "memory");
    const memory = await loadMemoryContext(memoryDir);
    if (memory) parts.push(memory);
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}

export async function buildAgentNamingPrompt({ agentHouse, configPrompt } = {}) {
  const parts = [];
  if (configPrompt) parts.push(String(configPrompt));
  if (agentHouse) {
    const identityDir = path.join(agentHouse, "identity");
    const bootstrap = await loadBootstrapFiles(identityDir);
    if (bootstrap) parts.push(bootstrap);
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}

export { loadMemoryContext };
