const WORD = (value) => ({ kind: "word", value });
const SEQUENCE = (...values) => ({ kind: "sequence", values });

// This declarative table is the single classifier contract for the interpreter
// and generated JavaScript/C runtimes.
export const COMMAND_POLICY_CONTRACT = Object.freeze([
  Object.freeze({
    name: "destructive",
    rules: Object.freeze([
      SEQUENCE("rm", "-rf"),
      SEQUENCE("rm", "-fr"),
      WORD("mkfs"),
      WORD("dd"),
      WORD("shred"),
      { kind: "fork_bomb" },
      WORD("format")
    ])
  }),
  Object.freeze({
    name: "network",
    rules: Object.freeze([
      WORD("curl"),
      WORD("wget"),
      { kind: "url" },
      WORD("ssh"),
      WORD("nc"),
      WORD("scp"),
      WORD("rsync"),
      WORD("ping")
    ])
  }),
  Object.freeze({
    name: "process_control",
    rules: Object.freeze([
      WORD("kill"),
      WORD("killall"),
      WORD("pkill"),
      WORD("systemctl"),
      WORD("service"),
      WORD("nohup"),
      WORD("docker"),
      WORD("kubectl")
    ])
  }),
  Object.freeze({
    name: "write_local",
    rules: Object.freeze([
      WORD("tee"),
      WORD("touch"),
      WORD("mkdir"),
      WORD("mv"),
      WORD("cp"),
      WORD("chmod"),
      WORD("chown"),
      WORD("truncate"),
      WORD("install"),
      { kind: "redirect" },
      { kind: "word_before_redirect", value: "cat" }
    ])
  }),
  Object.freeze({
    name: "read_only",
    rules: Object.freeze([
      WORD("cat"),
      WORD("ls"),
      WORD("find"),
      WORD("head"),
      WORD("tail"),
      WORD("grep"),
      WORD("rg"),
      WORD("wc"),
      WORD("sed"),
      WORD("awk"),
      WORD("echo"),
      WORD("printf"),
      { kind: "sequence", values: ["node", "--version"] },
      WORD("uname"),
      WORD("pwd"),
      WORD("whoami")
    ])
  })
]);

const LEGACY_MODE_NAMES = {
  session: "session command policy mode",
  agent: "agent command policy mode",
  command: "command policy mode"
};
const MAP_NAMES = {
  session: "session command configure",
  agent: "agent command configure",
  command: "command configure"
};
const LEGACY_POLICY_NAMES = new Set([
  ...Object.values(LEGACY_MODE_NAMES),
  "command classifier enabled"
]);

function hasWordBoundary(text, value) {
  const escaped = String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "iu").test(text);
}

function hasRule(text, rule) {
  if (rule.kind === "word") return hasWordBoundary(text, rule.value);
  if (rule.kind === "sequence") {
    const normalized = String(text).toLowerCase();
    const sequence = rule.values.map(value => String(value).toLowerCase()).join("\\s+");
    return new RegExp(`(^|[^A-Za-z0-9_])${sequence}(?=$|[^A-Za-z0-9_])`, "u").test(normalized);
  }
  if (rule.kind === "fork_bomb") return /\b:\(\)\s*\{\s*:\|:\s*&\s*\};:/u.test(text);
  if (rule.kind === "url") return /\bhttps?:\/\//iu.test(text);
  if (rule.kind === "redirect") return />>?/u.test(text);
  if (rule.kind === "word_before_redirect") return hasWordBoundary(text, rule.value) && />>?/u.test(text);
  if (rule.kind === "text") return String(text).toLowerCase().includes(String(rule.value).toLowerCase());
  return false;
}

function hasContractRule(text, rules = []) {
  return rules.some(rule => hasRule(text, rule));
}

export function classifyCommandText(commandText) {
  const cmd = String(commandText ?? "").trim();
  if (!cmd) return "unknown";
  if (/^node\s+(?:\.\/)?command\/see_vl_runner\.mjs\b/iu.test(cmd)) return "read_only";
  for (const entry of COMMAND_POLICY_CONTRACT) {
    if (hasContractRule(cmd, entry.rules)) return entry.name;
  }
  return "unknown";
}

export function normalizeCommandPolicyMode(value, fallback = "ask") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return new Set(["deny", "ask", "allow"]).has(normalized) ? normalized : fallback;
}

function mapEntryOb(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  return entry.ob && typeof entry.ob === "object" ? entry.ob : entry;
}

function configText(entry) {
  const ob = mapEntryOb(entry);
  if (!ob) return undefined;
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.wo === "string") return ob.wo;
  if (typeof ob.name === "string") return ob.name;
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (typeof ob.num === "number") return String(ob.num);
  return undefined;
}

function configBool(entry) {
  const value = configText(entry);
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["truth", "true", "1", "yes"].includes(normalized)) return true;
  if (["lie", "false", "0", "no"].includes(normalized)) return false;
  return Boolean(normalized);
}

function collectConfiguredMaps(sentences = []) {
  const maps = new Map();
  const list = Array.isArray(sentences) ? sentences : [];
  for (let index = 0; index < list.length; index += 1) {
    const sentence = list[index];
    if (sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name) {
      const map = {};
      for (let cursor = index + 1; cursor < list.length; cursor += 1) {
        if (list[cursor]?.mood === "prah") {
          index = cursor;
          break;
        }
        const key = list[cursor]?.su?.name;
        if (key) map[key] = list[cursor];
      }
      maps.set(sentence.su.name, map);
      continue;
    }
    if (sentence?.mood === "ya" && sentence?.be === "map" && sentence?.su?.name && sentence?.ob?.map) {
      maps.set(sentence.su.name, sentence.ob.map);
    }
  }
  return maps;
}

function legacyValues(sentences = []) {
  const values = new Map();
  for (const sentence of sentences) {
    const name = sentence?.su?.name;
    if (!name || sentence?.mood !== "ya") continue;
    if (LEGACY_POLICY_NAMES.has(name)) {
      values.set(name, sentence);
    }
  }
  return values;
}

export function isCommandPolicyConfigurationSentence(sentence) {
  return sentence?.mood === "ya" && LEGACY_POLICY_NAMES.has(sentence?.su?.name);
}

function resolvedScopeValue(scope, maps, legacy) {
  const map = maps.get(MAP_NAMES[scope]);
  const mapMode = configText(map?.["policy mode"]);
  if (mapMode !== undefined) return mapMode;
  return configText(legacy.get(LEGACY_MODE_NAMES[scope]));
}

export function resolveCompiledCommandPolicy(sentences = []) {
  const maps = collectConfiguredMaps(sentences);
  const legacy = legacyValues(sentences);
  const sessionMode = resolvedScopeValue("session", maps, legacy);
  const agentMode = resolvedScopeValue("agent", maps, legacy);
  const commandMode = resolvedScopeValue("command", maps, legacy);
  const mode = normalizeCommandPolicyMode(sessionMode ?? agentMode ?? commandMode, "ask");
  const source = sessionMode !== undefined ? MAP_NAMES.session
    : agentMode !== undefined ? MAP_NAMES.agent
      : MAP_NAMES.command;

  const sessionClassifier = configBool(maps.get(MAP_NAMES.session)?.["classifier enabled"]);
  const agentClassifier = configBool(maps.get(MAP_NAMES.agent)?.["classifier enabled"]);
  const commandClassifier = configBool(maps.get(MAP_NAMES.command)?.["classifier enabled"]);
  const legacyClassifier = configBool(legacy.get("command classifier enabled"));
  return {
    mode,
    classifierEnabled: sessionClassifier ?? agentClassifier ?? commandClassifier ?? legacyClassifier ?? true,
    source
  };
}

export function commandPolicyRuntimeData(policy = {}) {
  return {
    mode: normalizeCommandPolicyMode(policy.mode, "ask"),
    classifierEnabled: policy.classifierEnabled !== false,
    source: String(policy.source || MAP_NAMES.command)
  };
}

export { MAP_NAMES };
