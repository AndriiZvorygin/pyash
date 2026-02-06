import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { resolveAgentHouse } from "../agent/session.mjs";
import { throwErrorSentence } from "../error.mjs";

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

function resolveAgentName() {
  const agentName = remember("agent name")?.ob?.text ?? remember("agent name")?.ob?.name;
  if (agentName) return String(agentName);
  const worldAgent = remember("world agent")?.ob?.text ?? remember("world agent")?.ob?.name;
  if (worldAgent) return String(worldAgent);
  return "agent";
}

function resolveMemoryText(sentence) {
  const ob = sentence?.ob ?? {};
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.name) {
    const fact = remember(ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.num === "number") return String(fact.ob.num);
    if (typeof fact?.ob?.boolean === "boolean") return fact.ob.boolean ? "truth" : "lie";
  }
  return "";
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function appendFile(filePath, text, { addHeader = false, header = "" } = {}) {
  let content = text;
  try {
    const existing = await fs.readFile(filePath, "utf8");
    content = existing ? `${existing}\n${text}` : text;
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    if (addHeader && header) content = `${header}\n\n${text}`;
  }
  await fs.writeFile(filePath, content, "utf8");
}

export async function rememberPersistent(sentence) {
  const agentName = resolveAgentName();
  const agentHouse = resolveAgentHouse({ mindName: agentName, rememberFn: remember });
  const memoryDir = path.join(agentHouse, "memory");
  await ensureDir(memoryDir);

  const text = resolveMemoryText(sentence).trim();
  if (!text) {
    throwErrorSentence({
      name: "memory empty",
      message: "remember requires ob text",
      from: { name: "remember" },
      raw: sentence
    });
  }

  const during = sentence?.during ?? {};
  const always = during?.wo === "always" || String(during?.text ?? "").toLowerCase() === "always";
  if (always) {
    const target = path.join(memoryDir, "MEMORY.md");
    await appendFile(target, text);
    return { mood: "ya", su: { name: "memory" }, be: "text", ob: { text } };
  }

  const date = typeof during?.date === "string" ? during.date : nowDate();
  const target = path.join(memoryDir, `${date}.md`);
  const header = `# ${date}`;
  await appendFile(target, text, { addHeader: true, header });
  return { mood: "ya", su: { name: "memory" }, be: "text", ob: { text } };
}

export default rememberPersistent;

export const signatures = [
  { signatureWords: ["be", "remember", "ob", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "ob", "text", "during", "date"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "ob", "text", "during", "wo"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "date", "ob", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "wo", "ob", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "wo", "always", "ob", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "ob", "name", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "ob", "name", "text", "during", "date"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "ob", "name", "text", "during", "wo"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "date", "ob", "name", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "wo", "ob", "name", "text"], handler: rememberPersistent },
  { signatureWords: ["be", "remember", "during", "wo", "always", "ob", "name", "text"], handler: rememberPersistent }
];
