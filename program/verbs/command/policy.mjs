import { remember } from "../../remember/index.mjs";
import { resolveConfigBool, resolveConfigMapBool, resolveConfigMapText, resolveConfigText } from "../../configure/env.mjs";
import { normalizeCommandPolicyMode } from "../../library/command_policy.mjs";

export function resolveCommandPolicy({ sentence, cmdClass, rememberFn = remember } = {}) {
  const sessionMode = resolveConfigMapText("session command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("session command policy mode", { rememberFn });
  const agentMode = resolveConfigMapText("agent command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("agent command policy mode", { rememberFn });
  const globalMode = resolveConfigMapText("command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("command policy mode", { rememberFn });
  const baseMode = normalizeCommandPolicyMode(sessionMode ?? agentMode ?? globalMode, "ask");

  const sessionClassifier = resolveConfigMapBool("session command configure", "classifier enabled", { rememberFn });
  const agentClassifier = resolveConfigMapBool("agent command configure", "classifier enabled", { rememberFn });
  const globalClassifier =
    resolveConfigMapBool("command configure", "classifier enabled", { rememberFn })
    ?? resolveConfigBool("command classifier enabled", { rememberFn });
  const classifierEnabled = sessionClassifier ?? agentClassifier ?? globalClassifier ?? true;
  const source = sessionMode !== undefined ? "session command configure"
    : agentMode !== undefined ? "agent command configure"
      : "command configure";

  let mode = baseMode;
  if (sentence?.mood === "propose") mode = "ask";
  if (sentence?.mood === "can" && mode !== "deny") mode = "allow";
  if (!classifierEnabled) {
    return {
      mode,
      classifierEnabled: false,
      class: "unknown",
      source
    };
  }
  return {
    mode,
    classifierEnabled: true,
    class: cmdClass ?? "unknown",
    source
  };
}

const commandStreamProcesses = new Map();
const STREAM_END_TOKEN = "[PYA_STREAM_END]";
const DEFAULT_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER"
];

export function shouldRequireRatify({ sentence, policy, commandClass, resumed = false } = {}) {
  if (resumed) return false;
  if (policy?.mode !== "ask") return false;
  if (sentence?.mood === "propose") return true;
  return commandClass === "destructive";
}

export function shouldDeny({ sentence, policy, commandClass } = {}) {
  if (policy?.mode !== "deny") return false;
  if (sentence?.mood === "propose") return true;
  return commandClass === "destructive";
}

export function isNetworkDenied() {
  return false;
}

export function buildCommandResumeToken({ sentence, commandClass, commandText, requestIdentity }) {
  return JSON.stringify({
    kind: "command",
    issuedAt: new Date().toISOString(),
    class: commandClass ?? "unknown",
    text: String(commandText ?? ""),
    requestIdentity: requestIdentity?.name ?? null,
    sentence: sentence && typeof sentence === "object" ? sentence : {}
  });
}

