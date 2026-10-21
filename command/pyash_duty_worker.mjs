#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { prepareSaddle, runSaddleTurn } from "./pyash_saddle.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import { readSessionReplay } from "../program/agent/session.mjs";
import { parseDutyRepositories } from "../program/agent/coding_duty.mjs";

const pyashRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MS = 4000;
const HEARTBEAT_MS = 12000;
const SESSION_LIMIT = 4 * 1024 * 1024;

function env(name) {
  return String(process.env[name] ?? "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeIdentityPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function sessionFileForDuty(stateRoot, sessionName) {
  const safeName = String(sessionName ?? "").replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!safeName || safeName.includes("..")) throw new Error("worker received invalid duty session name");
  return path.join(stateRoot, "world", "house", "coding-saddle", "session", `${safeName}.pya`);
}

function dutyTurn(replay, messageId) {
  return replay.turns.find((turn) => (
    turn.records?.user?.metadata?.payloadId === messageId
  )) || null;
}

function completedAssistantText(turn) {
  return turn?.complete ? String(turn.responseText ?? "").trim() : "";
}

async function postJson(url, body, { token, timeoutMs = 15000, fetchFn = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error?.message || `hub returned HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveDutyWorkerConfig(envValue = process.env) {
  const hubUrl = String(envValue.PYA_DUTY_HUB_URL ?? "").trim().replace(/\/+$/u, "");
  const account = String(envValue.USER ?? envValue.LOGNAME ?? os.userInfo().username).trim();
  const hostName = String(envValue.PYA_DUTY_WORKER_HOSTNAME ?? os.hostname()).trim();
  const workerId = String(envValue.PYA_DUTY_WORKER_ID ?? `${safeIdentityPart(hostName)}-${safeIdentityPart(account)}`).trim();
  const label = String(envValue.PYA_DUTY_WORKER_LABEL ?? `${hostName} (${account})`).trim();
  const token = String(envValue.PYA_DUTY_WORKER_TOKEN ?? "").trim();
  const repositories = parseDutyRepositories(envValue.PYA_DUTY_REPOSITORIES ?? "");
  const stateRoot = path.resolve(String(envValue.PYA_DUTY_STATE_ROOT ?? path.join(os.homedir(), ".local", "state", "pyash-duty")));
  if (!hubUrl || !workerId || !token || !repositories.length) {
    throw new Error("configure PYA_DUTY_HUB_URL, PYA_DUTY_WORKER_ID, PYA_DUTY_WORKER_TOKEN, and PYA_DUTY_REPOSITORIES");
  }
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("duty hub must use HTTPS outside loopback");
  }
  return { hubUrl, workerId, label, token, repositories, stateRoot, homeAccess: enabled(envValue.PYA_DUTY_HOME_ACCESS) };
}

async function canonicalRepositories(config) {
  const resolved = [];
  for (const repository of config.repositories) {
    const root = await fs.realpath(repository.root);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error(`configured repository is not a directory: ${repository.id}`);
    resolved.push({ ...repository, root });
  }
  return resolved;
}

async function syncSessionBeforeTurn({ assignment, localSessionFile }) {
  await fs.mkdir(path.dirname(localSessionFile), { recursive: true });
  let replay = null;
  try {
    replay = await readSessionReplay({ sessionFile: localSessionFile, historyWindow: 0 });
  } catch {
    replay = null;
  }
  const existing = replay ? dutyTurn(replay, assignment.message.id) : null;
  if (existing) return { existing, localText: await fs.readFile(localSessionFile, "utf8") };
  const sessionText = String(assignment.sessionText ?? "");
  if (Buffer.byteLength(sessionText, "utf8") > SESSION_LIMIT) throw new Error("hub duty session exceeds local safety limit");
  await fs.writeFile(localSessionFile, sessionText, "utf8");
  return { existing: null, localText: sessionText };
}

export async function processDutyAssignment(config, repositories, assignment, {
  fetchFn = fetch,
  prepareFn = prepareSaddle,
  mindFn = mind_to_name_text,
  log = (line) => process.stdout.write(`${line}\n`)
} = {}) {
  const duty = assignment.duty;
  const message = assignment.message;
  const repository = repositories.find((entry) => entry.id === duty.repositoryId);
  if (!repository) throw new Error(`duty requests unconfigured directory ${duty.repositoryId}`);
  const permissionScope = String(duty.permissionScope ?? "project").trim().toLowerCase();
  if (!["project", "home"].includes(permissionScope)) throw new Error("duty has an invalid permission scope");
  if (permissionScope === "home" && config.homeAccess !== true) {
    throw new Error("worker is not configured to allow full home-directory access");
  }
  const workingRoot = permissionScope === "home" ? os.homedir() : repository.root;
  const localSessionFile = sessionFileForDuty(config.stateRoot, duty.sessionName);
  const session = await syncSessionBeforeTurn({ assignment, localSessionFile });
  let output = completedAssistantText(session.existing);
  let heartbeatTimer = null;
  if (!output) {
    await prepareFn({
      cwd: workingRoot,
      runtimeRoot: pyashRoot,
      worldRoot: path.join(config.stateRoot, "world"),
      model: duty.model,
      backend: duty.backend,
      host: duty.host
    });
    heartbeatTimer = setInterval(() => {
      postJson(`${config.hubUrl}/api/duty-workers/heartbeat`, {
        workerId: config.workerId,
        label: config.label || config.workerId,
        repositories: repositories.map(({ id, label, root }) => ({ id, label, root })),
        dutyId: duty.id,
        messageId: message.id,
        claimId: assignment.claimId
      }, { token: config.token, fetchFn }).catch((error) => log(`heartbeat: ${error.message}`));
    }, HEARTBEAT_MS);
    try {
      const result = await runSaddleTurn({
        input: message.text,
        model: duty.model,
        backend: duty.backend,
        host: duty.host,
        sessionFile: localSessionFile,
        sessionUserMetadata: { payloadId: message.id },
        mindFn
      });
      output = String(result?.ob?.text ?? result?.fromstate?.text ?? result?.value?.text ?? "").trim();
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
  if (!output) throw new Error("mind returned no response text");
  const sessionText = await fs.readFile(localSessionFile, "utf8");
  await postJson(`${config.hubUrl}/api/duty-workers/result`, {
    workerId: config.workerId,
    dutyId: duty.id,
    messageId: message.id,
    claimId: assignment.claimId,
    text: output,
    sessionText
  }, { token: config.token, timeoutMs: 30000, fetchFn });
  log(`duty ${duty.id}: response recorded`);
}

export async function runDutyWorker({
  config = resolveDutyWorkerConfig(),
  fetchFn = fetch,
  log = (line) => process.stdout.write(`${line}\n`),
  shouldStop = () => false,
  sleepFn = sleep
} = {}) {
  const repositories = await canonicalRepositories(config);
  let failures = 0;
  while (!shouldStop()) {
    try {
      const heartbeat = await postJson(`${config.hubUrl}/api/duty-workers/heartbeat`, {
        workerId: config.workerId,
        label: config.label || config.workerId,
        repositories: repositories.map(({ id, label, root }) => ({ id, label, root }))
      }, { token: config.token, fetchFn });
      if (!heartbeat.ok) throw new Error("hub rejected worker heartbeat");
      const claim = await postJson(`${config.hubUrl}/api/duty-workers/claim`, {
        workerId: config.workerId
      }, { token: config.token, fetchFn });
      if (claim.assignment) {
        failures = 0;
        try {
          await processDutyAssignment(config, repositories, claim.assignment, { fetchFn, log });
        } catch (error) {
          const assignment = claim.assignment;
          log(`duty ${assignment.duty.id}: ${error.message}`);
          await postJson(`${config.hubUrl}/api/duty-workers/failure`, {
            workerId: config.workerId,
            dutyId: assignment.duty.id,
            messageId: assignment.message.id,
            claimId: assignment.claimId,
            error: String(error?.stack ?? error).slice(0, 1800)
          }, { token: config.token, fetchFn }).catch((failureError) => log(`failure report: ${failureError.message}`));
        }
      }
    } catch (error) {
      failures += 1;
      log(`hub unavailable (${failures}): ${error.message}`);
    }
    if (!shouldStop()) await sleepFn(Math.min(POLL_MS * Math.max(1, failures), 30000));
  }
}

async function main() {
  const config = resolveDutyWorkerConfig();
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  process.stdout.write(`Pyash duty worker ${config.workerId} starting\n`);
  await runDutyWorker({ config, shouldStop: () => stopping });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
