import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../beautiful.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";

const ACTIVE_SESSION_NAME = "coding saddle active session";
const ACTIVE_SESSION_FILE = "coding saddle active session file";
const PROFILE_PREFIX = "coding saddle profile ";
const PROFILE_FIELDS = ["mindName", "backend", "model", "host"];
const FIELD_TO_SUFFIX = {
  mindName: "mind",
  backend: "backend",
  model: "model",
  host: "host"
};
const SUFFIX_TO_FIELD = Object.fromEntries(Object.entries(FIELD_TO_SUFFIX).map(([field, suffix]) => [suffix, field]));

function textSentence(name, value) {
  return sentenceToPyash({
    su: { name },
    ob: { text: String(value ?? "") },
    be: "text",
    mood: "ya"
  });
}

export function saddleSessionProfileKey({ sessionName = "coding", sessionFile = "" } = {}) {
  const identity = String(sessionFile).trim()
    ? `file:${path.resolve(String(sessionFile))}`
    : `name:${String(sessionName || "coding").trim().toLowerCase()}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

export function getCodingSaddleProfile(state, session = {}) {
  const key = saddleSessionProfileKey(session);
  return { ...(state?.profiles?.[key] || {}) };
}

export function setCodingSaddleProfile(state, session = {}, profile = {}) {
  const key = saddleSessionProfileKey(session);
  const profiles = { ...(state?.profiles || {}) };
  profiles[key] = Object.fromEntries(PROFILE_FIELDS
    .map((field) => [field, String(profile?.[field] ?? "").trim()])
    .filter(([, value]) => value));
  return { ...state, profiles };
}

export async function readCodingSaddleState(filePath) {
  const state = {
    activeSessionName: "coding",
    activeSessionFile: "",
    profiles: {}
  };
  let source = "";
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return state;
    throw error;
  }

  for (const raw of splitSentences(source, { includeThen: true })) {
    let sentence;
    try {
      sentence = parse(raw.trim());
    } catch {
      continue;
    }
    const subject = String(sentence?.su?.name || "").trim();
    const value = String(sentence?.ob?.text ?? "");
    if (subject === ACTIVE_SESSION_NAME) {
      state.activeSessionName = value.trim() || "coding";
      continue;
    }
    if (subject === ACTIVE_SESSION_FILE) {
      state.activeSessionFile = value.trim();
      continue;
    }
    if (!subject.startsWith(PROFILE_PREFIX)) continue;
    const match = subject.slice(PROFILE_PREFIX.length).match(/^([a-f0-9]{20}) (mind|backend|model|host)$/u);
    if (!match || !value.trim()) continue;
    const [, key, suffix] = match;
    const field = SUFFIX_TO_FIELD[suffix];
    state.profiles[key] ||= {};
    state.profiles[key][field] = value.trim();
  }
  return state;
}

export async function writeCodingSaddleState(filePath, state = {}) {
  const lines = [
    textSentence(ACTIVE_SESSION_NAME, state.activeSessionName || "coding"),
    textSentence(ACTIVE_SESSION_FILE, state.activeSessionFile || "")
  ];
  for (const [key, profile] of Object.entries(state.profiles || {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[a-f0-9]{20}$/u.test(key)) continue;
    for (const field of PROFILE_FIELDS) {
      const value = String(profile?.[field] ?? "").trim();
      if (!value) continue;
      lines.push(textSentence(`${PROFILE_PREFIX}${key} ${FIELD_TO_SUFFIX[field]}`, value));
    }
  }

  const resolvedPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${lines.join("\n")}\n`, "utf8");
  await fs.rename(temporaryPath, resolvedPath);
  return resolvedPath;
}
