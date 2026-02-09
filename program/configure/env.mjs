import { doRemember, remember, setDefault } from "../remember/index.mjs";

const ENV_BINDINGS = [
  { env: "PYA_MIND_RESPONSE", name: "mind response", type: "text" },
  { env: "PYA_MIND_DEBUG", name: "mind debug", type: "bool" },
  { env: "PYA_STREAM_STDOUT", name: "stream stdout", type: "bool" },
  { env: "PYA_OLLAMA_STREAM_TEST", name: "ollama stream test", type: "bool" },
  { env: "OLLAMA_TEST_MODEL", name: "ollama test model", type: "text" },
  { env: "PYA_COMMAND_RESPONSE", name: "command response", type: "text" },
  { env: "PYA_COMMAND_DEBUG", name: "command debug", type: "bool" },
  { env: "PYA_PIPER_BIN", name: "piper bin", type: "text" },
  { env: "PYA_PIPER_VOICE", name: "piper voice", type: "text" },
  { env: "PYA_PIPER_FIXTURE", name: "piper fixture", type: "text" },
  { env: "PYA_AUDIO_PLAYER", name: "audio player", type: "text" },
  { env: "PYA_SAY_SILENT", name: "say silent", type: "bool" },
  { env: "PYA_SAY_STRICT_AUDIO", name: "say strict audio", type: "bool" },
  { env: "PYA_ESPEAK_BIN", name: "espeak bin", type: "text" },
  { env: "PYA_SAY_STREAM_DELAY_MS", name: "say stream delay", type: "num" },
  { env: "PYA_HEAR_BIN", name: "hear bin", type: "text" },
  { env: "PYA_HEAR_STREAM_BIN", name: "hear stream bin", type: "text" },
  { env: "PYA_HEAR_MODEL", name: "hear model", type: "text" },
  { env: "PYA_HEAR_LANGUAGE", name: "hear language", type: "text" },
  { env: "PYA_HEAR_CAPTURE", name: "hear capture", type: "num" },
  { env: "PYA_HEAR_FIXTURE", name: "hear fixture", type: "text" },
  { env: "PYA_KEYBOARD_BIN", name: "keyboard bin", type: "text" },
  { env: "PYA_CHECKPOINTS", name: "checkpoint seed", type: "text" },
  { env: "PYA_NO_CHECKPOINT", name: "checkpoint disabled", type: "bool" },
  { env: "PYA_NEWSPAPER", name: "newspaper enabled", type: "bool" },
  { env: "PYA_NEWSPAPER_MIND_AUTO", name: "newspaper mind auto", type: "bool" },
  { env: "PYA_RUN_ID", name: "run id", type: "text" },
  { env: "PYA_REFINERY", name: "refinery name", type: "text" },
  { env: "OLLAMA_HOST", name: "ollama host", type: "text" },
  { env: "OPENAI_BASE_URL", name: "ai host", type: "text" },
  { env: "AI_HOST", name: "ai host", type: "text" }
];

function parseBoolean(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "truth" || value === "true" || value === "1" || value === "yes") return true;
  if (value === "lie" || value === "false" || value === "0" || value === "no") return false;
  return Boolean(value);
}

function parseNumber(raw) {
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  return null;
}

function buildObValue(raw, type) {
  if (type === "bool") {
    return { boolean: parseBoolean(raw) };
  }
  if (type === "num") {
    const value = parseNumber(raw);
    return { num: value ?? 0 };
  }
  return { text: String(raw ?? "") };
}

export function applyEnvDefaults({ rememberFn = remember, doRememberFn = doRemember, env = process.env } = {}) {
  for (const binding of ENV_BINDINGS) {
    const raw = env?.[binding.env];
    if (raw === undefined || raw === "") continue;
    const existing = rememberFn?.(binding.name);
    if (existing && existing.be !== "default") continue;
    const ob = buildObValue(raw, binding.type);
    if (existing) {
      existing.mood = "ya";
      existing.be = "default";
      existing.su = { name: binding.name };
      existing.ob = ob;
      continue;
    }
    setDefault(binding.name, { mood: "ya", su: { name: binding.name }, be: "default", ob });
  }
}

export function resolveConfigBool(name, { rememberFn = remember } = {}) {
  const fact = rememberFn?.(name);
  if (!fact) return undefined;
  const ob = fact.ob ?? {};
  if (typeof ob.boolean === "boolean") return ob.boolean;
  if (typeof ob.num === "number") return ob.num !== 0;
  if (typeof ob.text === "string") return parseBoolean(ob.text);
  return undefined;
}

export function resolveConfigNum(name, { rememberFn = remember } = {}) {
  const fact = rememberFn?.(name);
  if (!fact) return undefined;
  const ob = fact.ob ?? {};
  if (typeof ob.num === "number") return ob.num;
  if (typeof ob.text === "string") return parseNumber(ob.text);
  if (typeof ob.boolean === "boolean") return ob.boolean ? 1 : 0;
  return undefined;
}

export function resolveConfigText(name, { rememberFn = remember } = {}) {
  const fact = rememberFn?.(name);
  if (!fact) return undefined;
  const ob = fact.ob ?? {};
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.name === "string") return ob.name;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  return undefined;
}

function normalizeMapEntryOb(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  if (entry.ob && typeof entry.ob === "object") return entry.ob;
  return entry;
}

function parseMapBoolean(ob = {}) {
  if (typeof ob.boolean === "boolean") return ob.boolean;
  if (typeof ob.num === "number") return ob.num !== 0;
  if (typeof ob.text === "string") return parseBoolean(ob.text);
  if (typeof ob.wo === "string") return parseBoolean(ob.wo);
  return undefined;
}

function parseMapNumber(ob = {}) {
  if (typeof ob.num === "number") return ob.num;
  if (typeof ob.text === "string") return parseNumber(ob.text);
  if (typeof ob.wo === "string") return parseNumber(ob.wo);
  if (typeof ob.boolean === "boolean") return ob.boolean ? 1 : 0;
  return undefined;
}

function parseMapText(ob = {}) {
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.wo === "string") return ob.wo;
  if (typeof ob.name === "string") return ob.name;
  if (typeof ob.filename === "string") return ob.filename;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  return undefined;
}

export function resolveConfigMap(name, { rememberFn = remember } = {}) {
  const fact = rememberFn?.(name);
  const map = fact?.ob?.map;
  return map && typeof map === "object" && !Array.isArray(map) ? map : undefined;
}

export function resolveConfigMapOb(name, key, { rememberFn = remember } = {}) {
  const map = resolveConfigMap(name, { rememberFn });
  if (!map || !key || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  return normalizeMapEntryOb(map[key]);
}

export function resolveConfigMapBool(name, key, { rememberFn = remember } = {}) {
  const ob = resolveConfigMapOb(name, key, { rememberFn });
  if (!ob) return undefined;
  return parseMapBoolean(ob);
}

export function resolveConfigMapNum(name, key, { rememberFn = remember } = {}) {
  const ob = resolveConfigMapOb(name, key, { rememberFn });
  if (!ob) return undefined;
  return parseMapNumber(ob);
}

export function resolveConfigMapText(name, key, { rememberFn = remember } = {}) {
  const ob = resolveConfigMapOb(name, key, { rememberFn });
  if (!ob) return undefined;
  return parseMapText(ob);
}
