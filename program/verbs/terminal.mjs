import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { remember } from "../remember/index.mjs";
import { resolveConfigMapSeries } from "../configure/env.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { classifyCommandText } from "../library/command_policy.mjs";
import { resolveSaddleMindProfile, normalizeSaddleBackend, normalizeSaddleModel } from "../agent/coding_saddle.mjs";
import { requestManagedTerminal } from "../agent/managed_terminal_ipc.mjs";
import { resolveRatifyDecision } from "../agent/ratify_policy.mjs";
import { resolveCommandPolicy, shouldDeny, shouldRequireRatify } from "./command/policy.mjs";
import { resolveSandboxSettings, validateSandboxWritePolicy } from "./command/sandbox.mjs";

const SADDLE_ENTRY = fileURLToPath(new URL("../../command/pyash_saddle.mjs", import.meta.url));
const CHILD_SESSION_PREFIX = "child-";
const CHILD_READY_TIMEOUT_MS = 30000;
const CHILD_READY_POLL_MS = 100;

function normalized(value) {
  return String(value ?? "").trim();
}

function requestObject(sentence) {
  const raw = sentence?.ob?.text;
  if (typeof raw !== "string") throw new Error("terminal request must be a JSON object string");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("terminal request is malformed JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("terminal request must be a JSON object");
  }
  return value;
}

function jsonResult(action, result) {
  return {
    mood: "ya",
    su: { name: "terminal result" },
    be: "text",
    ob: { text: JSON.stringify({ action, ...result }) }
  };
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function inside(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveTerminalProjectRoot(sandbox) {
  const projectRoot = await fs.realpath(sandbox.cwd).catch(() => null);
  if (!projectRoot || !(await fs.stat(projectRoot).catch(() => null))?.isDirectory()) {
    throw new Error("terminal project working directory is unavailable");
  }
  return projectRoot;
}

async function resolveProjectDirectory(requested, sandbox, projectRoot) {
  const raw = normalized(requested) || sandbox.cwd;
  const candidate = path.resolve(sandbox.cwd, raw);
  const realCandidate = await fs.realpath(candidate);
  const stat = await fs.stat(realCandidate);
  if (!stat.isDirectory() || !inside(realCandidate, projectRoot)) {
    throw new Error("terminal working directory is outside the agent's active project root");
  }
  return realCandidate;
}

function childBackendPolicy(parentBackend, rememberFn) {
  const backend = normalizeSaddleBackend(parentBackend);
  return resolveConfigMapSeries("agent delegation configure", `${backend} allowed backends`, { rememberFn })
    ?? resolveConfigMapSeries("agent delegation configure", "default allowed backends", { rememberFn })
    ?? ["ollama"];
}

export function resolveChildAgentTarget({
  parentBackend,
  childMind,
  requestedModel,
  profile,
  allowedBackends = ["ollama"],
  allowedModels = [],
  hostForBackend = () => "http://localhost:11434"
} = {}) {
  const mindName = normalized(childMind);
  if (!mindName || !profile || profile.be !== "mind") throw new Error(`Pyash mind not found: ${mindName || "(empty)"}`);
  const target = resolveSaddleMindProfile({ mindName, profile, hostForBackend });
  const allowBackends = new Set((Array.isArray(allowedBackends) ? allowedBackends : [])
    .map((entry) => normalizeSaddleBackend(entry)));
  if (!allowBackends.has(target.backend)) {
    throw new Error(`child backend ${target.backend} is not allowed for parent backend ${normalizeSaddleBackend(parentBackend)}`);
  }
  const model = normalizeSaddleModel(requestedModel, target.model);
  const allowModels = (Array.isArray(allowedModels) ? allowedModels : []).map(normalizeSaddleModel);
  if (allowModels.length && !allowModels.includes(model)) {
    throw new Error(`child model ${model} is not in the parent's delegation model allowlist`);
  }
  return { ...target, model };
}

async function authorizeLaunch({ sentence, command, args, cwd, runtimeContext, rememberFn }) {
  const commandText = [command, ...args].map(shellQuote).join(" ");
  const commandClass = classifyCommandText(commandText);
  const policy = resolveCommandPolicy({ sentence, cmdClass: commandClass, rememberFn });
  if (shouldDeny({ sentence, policy, commandClass })) {
    throw new Error(`terminal command denied by command policy: ${commandClass}`);
  }
  if (shouldRequireRatify({ sentence, policy, commandClass })) {
    const mindName = normalized(runtimeContext?.agentName);
    const decision = await resolveRatifyDecision({
      mindName,
      toolName: "terminal start",
      toolSignature: "terminal start",
      subjectName: "terminal start",
      rememberFn
    });
    if (decision?.decision !== "truth") {
      throw new Error(`terminal command needs an existing ratify allow rule (${commandClass})`);
    }
  }
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const guardSentence = { ...sentence, to: { filename: cwd } };
  validateSandboxWritePolicy({ sentence: guardSentence, commandText, commandClass, sandbox });
  return sandbox;
}

function actionOf(sentence) {
  return normalized(sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name).toLowerCase();
}

function sessionName() {
  return `${CHILD_SESSION_PREFIX}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, "");
}

async function startChildAgent({
  sentence,
  request,
  runtimeContext,
  rememberFn,
  requestTerminal,
  sleepFn
}) {
  const parentBackend = normalizeSaddleBackend(runtimeContext?.backend);
  const mindName = normalized(request.mind) || "mind";
  const profile = rememberFn(mindName);
  const allowedBackends = childBackendPolicy(parentBackend, rememberFn);
  const allowedModels = resolveConfigMapSeries("agent delegation configure", `${parentBackend} allowed models`, { rememberFn }) ?? [];
  const hostFact = rememberFn("ollama host");
  const hostFallback = hostFact?.ob?.text ?? hostFact?.ob?.name ?? runtimeContext?.host ?? "http://localhost:11434";
  const target = resolveChildAgentTarget({
    parentBackend,
    childMind: mindName,
    requestedModel: request.model,
    profile,
    allowedBackends,
    allowedModels,
    hostForBackend: (backend) => backend === parentBackend
      ? normalized(runtimeContext?.host) || hostFallback
      : hostFallback
  });
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const projectRoot = await resolveTerminalProjectRoot(sandbox);
  const cwd = await resolveProjectDirectory(request.cwd, sandbox, projectRoot);
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.join(sandbox.runRoot, "world");
  const childSession = sessionName();
  const environment = {
    PYA_SADDLE_CWD: cwd,
    PYA_SADDLE_MIND: target.mindName,
    PYA_SADDLE_MODEL: target.model,
    PYA_SADDLE_HOST: target.host,
    PYA_SADDLE_SESSION_NAME: childSession
  };
  await authorizeLaunch({
    sentence,
    command: process.execPath,
    args: [SADDLE_ENTRY],
    cwd,
    runtimeContext,
    rememberFn
  });
  const started = await requestTerminal(worldRoot, projectRoot, {
    action: "start",
    command: process.execPath,
    args: [SADDLE_ENTRY],
    cwd,
    columns: request.columns,
    rows: request.rows,
    env: environment
  });
  const initialInstruction = normalized(request.instruction);
  let instructionState = "not requested";
  if (initialInstruction) {
    instructionState = await deliverInitialInstruction({
      requestTerminal,
      sleepFn,
      worldRoot,
      projectRoot,
      terminalId: started.id,
      instruction: initialInstruction
    });
  }
  return jsonResult("start coding agent", {
    ...started,
    mind: target.mindName,
    backend: target.backend,
    model: target.model,
    sessionName: childSession,
    instructionState
  });
}

async function deliverInitialInstruction({ requestTerminal, sleepFn, worldRoot, projectRoot, terminalId, instruction }) {
  const deadline = Date.now() + CHILD_READY_TIMEOUT_MS;
  let cursor = 0;
  let accumulated = "";
  while (Date.now() < deadline) {
    const output = await requestTerminal(worldRoot, projectRoot, {
      action: "read",
      id: terminalId,
      after: cursor,
      maxBytes: 65536
    });
    cursor = output.cursor ?? cursor;
    accumulated = `${accumulated}${output.output ?? ""}`.slice(-131072);
    if (/(?:^|\n)[^\n]*pyash>\s*$/imu.test(stripAnsi(accumulated))) {
      await requestTerminal(worldRoot, projectRoot, {
        action: "write",
        id: terminalId,
        input: `${instruction}\r`
      });
      return "sent";
    }
    if (output.status !== "running") return "child exited before its prompt was ready";
    await sleepFn(CHILD_READY_POLL_MS);
  }
  return "terminal started; initial instruction can be sent with terminal write";
}

export async function terminal(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null,
  requestTerminal = requestManagedTerminal,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const action = actionOf(sentence);
  if (!new Set(["start", "start coding agent", "read", "write", "resize", "status", "list", "close"]).has(action)) {
    throwErrorSentence({
      name: "terminal action invalid",
      message: `terminal action invalid: ${action || "(empty)"}`,
      from: { name: "terminal" },
      raw: { sentence }
    });
  }
  const request = requestObject(sentence);
  if (action === "start coding agent") {
    return startChildAgent({ sentence, request, runtimeContext, rememberFn, requestTerminal, sleepFn });
  }

  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.join(sandbox.runRoot, "world");
  const projectRoot = await resolveTerminalProjectRoot(sandbox);
  if (action === "start") {
    const command = normalized(request.command);
    const args = Array.isArray(request.args) ? request.args.map((value) => String(value)) : [];
    if (!command) throw new Error("terminal start requires a command");
    const cwd = await resolveProjectDirectory(request.cwd, sandbox, projectRoot);
    await authorizeLaunch({ sentence, command, args, cwd, runtimeContext, rememberFn });
    const result = await requestTerminal(worldRoot, projectRoot, {
      action,
      command,
      args,
      cwd,
      columns: request.columns,
      rows: request.rows
    });
    return jsonResult(action, result);
  }
  if (action === "list") return jsonResult(action, { sessions: await requestTerminal(worldRoot, projectRoot, { action }) });

  const id = normalized(request.id);
  if (!id) throw new Error(`terminal ${action} requires a terminal id`);
  const result = await requestTerminal(worldRoot, projectRoot, { ...request, action, id });
  return jsonResult(action, result);
}

export default terminal;

export const signatures = [
  { signatureWords: ["be", "terminal", "as", "wo", "start", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "start", "coding", "agent", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "read", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "write", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "resize", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "status", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "list", "ob", "text"], handler: terminal },
  { signatureWords: ["be", "terminal", "as", "wo", "close", "ob", "text"], handler: terminal }
];
