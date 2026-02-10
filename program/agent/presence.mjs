import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../beautiful.mjs";

function quoteFilenameList(paths = []) {
  const dedup = [...new Set(paths.map((value) => String(value).trim()).filter(Boolean))];
  return dedup;
}

function formatPresenceLine({ agentName, sinceIso, latestIso, touchedFiles = [] } = {}) {
  const quoted = quoteFilenameList(touchedFiles)
    .map((file) => `"${file.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`)
    .join(" ");
  const withClause = quoted ? `with ve filename ${quoted} ` : "";
  return `su name ${agentName} be present since date "${sinceIso}" during date "${latestIso}" ${withClause}ya`;
}

async function readExistingSince(presencePath) {
  let text = "";
  try {
    text = await fs.readFile(presencePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const match = text.match(/since\s+date\s+"([^"]+)"/i);
  return match?.[1] ?? null;
}

export async function updateAgentPresence({
  worldRoot,
  agentName,
  latestIso = new Date().toISOString(),
  touchedFiles = []
} = {}) {
  if (!worldRoot || !agentName) return null;
  const agentHouse = path.join(worldRoot, "house", String(agentName));
  await fs.mkdir(agentHouse, { recursive: true });
  const presencePath = path.join(agentHouse, ".presence.pya");
  const existingSince = await readExistingSince(presencePath);
  const sinceIso = existingSince ?? latestIso;
  const line = formatPresenceLine({
    agentName: String(agentName),
    sinceIso,
    latestIso,
    touchedFiles
  });
  await fs.writeFile(presencePath, `${line}\n`, "utf8");
  return {
    presencePath,
    sinceIso,
    latestIso
  };
}

export function presenceSentence({
  agentName,
  sinceIso,
  latestIso,
  touchedFiles = []
} = {}) {
  const files = quoteFilenameList(touchedFiles);
  const sentence = {
    mood: "ya",
    su: { name: String(agentName) },
    be: "present",
    since: { date: String(sinceIso) },
    during: { date: String(latestIso) }
  };
  if (files.length) {
    sentence.with = { ve: { type: "filename", values: files } };
  }
  return sentenceToPyash(sentence);
}
