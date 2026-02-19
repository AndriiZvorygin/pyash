#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { loadChannelPolicyWithGlobal } from "../program/agent/channels/policy.mjs";
import { createMatrixAdapter } from "../program/agent/channels/matrix.mjs";
import { ensureMatrixCredentials } from "../program/agent/channels/bootstrap.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { resolveConfigMapText } from "../program/configure/env.mjs";
import {
  computeParityDelta,
  selectParityFixCandidates,
  summarizeParityStatus
} from "../program/agent/parity_cycle.mjs";

function parseArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function formatRunId(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}-parity-cycle`;
}

function runCommand(cmd, args, { cwd, env, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }
    child.stdout.on("data", (buf) => { stdout += String(buf); });
    child.stderr.on("data", (buf) => { stderr += String(buf); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: Number(code ?? 1), stdout, stderr, timedOut });
    });
  });
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function resolveMatrixConfigWithMap(rawConfig = {}) {
  const mapName = "matrix channel";
  const mapHomeserver = resolveConfigMapText(mapName, "homeserver");
  const mapSharedSecret = resolveConfigMapText(mapName, "registration shared secret");
  const mapAdminToken = resolveConfigMapText(mapName, "admin token");
  const mapToken = resolveConfigMapText(mapName, "token");
  const mapUser = resolveConfigMapText(mapName, "user");
  const mapRoom = resolveConfigMapText(mapName, "room");
  return {
    ...rawConfig,
    homeserver: rawConfig.homeserver ?? mapHomeserver ?? null,
    registrationSharedSecret: rawConfig.registrationSharedSecret ?? mapSharedSecret ?? null,
    adminToken: rawConfig.adminToken ?? mapAdminToken ?? null,
    token: rawConfig.token ?? mapToken ?? null,
    user: rawConfig.user ?? mapUser ?? null,
    room: rawConfig.room ?? mapRoom ?? null
  };
}

async function initializeRuntimeConfig({ cwd, agentName }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) registerSignatureHandler(sig);
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember(agentName)) {
    await interpret(parse(`exists su name ${agentName} be mind ya`));
  }
}

function buildCodexPrompt({ candidates, artifactDir }) {
  return [
    "Fix Pyash parity mismatches in this repository.",
    "Scope:",
    `- Target examples: ${candidates.length ? candidates.join(", ") : "none"}`,
    "Required process:",
    "1. Reproduce each target mismatch individually with ./runjs and ./runc.",
    "2. Implement minimal fixes.",
    "3. Re-test each fixed target individually.",
    "4. Run npm test and avoid regressions.",
    "5. Keep changes focused to parity fixes.",
    `Write brief progress notes to: ${path.join(artifactDir, "codex-progress.log")}`
  ].join("\n");
}

async function sendMatrixSummary({ worldRoot, agentName, summaryText, roomOverride = null }) {
  const agentHouse = resolveAgentHouse({
    mindName: agentName,
    rememberFn: () => null,
    worldRoot
  });
  await ensureAgentDirs(agentHouse);
  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const matrix = resolveMatrixConfigWithMap(allChannels?.matrix ?? {});
  if (!matrix?.enabled) return { sent: false, reason: "matrix_disabled" };
  const rooms = Array.isArray(matrix.rooms) ? matrix.rooms : [];
  const targetRoomId = roomOverride || matrix.room || rooms[0]?.id || null;
  if (!targetRoomId) return { sent: false, reason: "matrix_no_room" };
  const hasCreds = Boolean(
    matrix?.token
    || matrix?.registrationSharedSecret
    || process.env.MATRIX_ACCESS_TOKEN
    || process.env.PYA_MATRIX_ACCESS_TOKEN
    || process.env.MATRIX_REGISTRATION_SHARED_SECRET
    || process.env.PYA_MATRIX_REGISTRATION_SHARED_SECRET
  );
  if (!hasCreds) return { sent: false, reason: "matrix_missing_credentials" };

  const creds = await ensureMatrixCredentials({
    agentName,
    agentHouse,
    config: matrix
  });
  const adapter = createMatrixAdapter();
  await adapter.send({
    config: {
      ...matrix,
      homeserver: creds.homeserver,
      token: creds.token,
      user: matrix.user ?? creds.user
    },
    event: { channelId: targetRoomId },
    content: summaryText
  });
  return { sent: true, roomId: targetRoomId };
}

async function main() {
  const repoRoot = path.resolve(parseArgValue("--repo-root") ?? process.cwd());
  const worldRoot = path.resolve(parseArgValue("--world-root") ?? path.join(repoRoot, "world"));
  const agentName = parseArgValue("--agent") ?? "parity coder";
  const skipFix = hasFlag("--skip-fix");
  const skipNotify = hasFlag("--skip-notify");
  const skipTests = hasFlag("--skip-tests");
  const timeoutMs = Number(parseArgValue("--timeout-ms") ?? 0) || 0;
  const matrixRoom = parseArgValue("--matrix-room");

  const runId = parseArgValue("--run-id") ?? formatRunId(new Date());
  await initializeRuntimeConfig({ cwd: repoRoot, agentName });
  const agentHouse = path.join(worldRoot, "house", agentName);
  const artifactDir = path.join(agentHouse, "artifacts", runId);
  await fs.mkdir(artifactDir, { recursive: true });

  const statusBeforePath = path.join(artifactDir, "status-before.json");
  const statusAfterPath = path.join(artifactDir, "status-after.json");
  const deltaPath = path.join(artifactDir, "delta.json");
  const summaryPath = path.join(artifactDir, "summary.pya");

  const beforeRes = await runCommand("node", ["command/run_parity_examples.mjs", "--status", statusBeforePath], {
    cwd: repoRoot,
    timeoutMs
  });
  await writeText(path.join(artifactDir, "parity-before.log"), `${beforeRes.stdout}\n${beforeRes.stderr}`);

  const statusBefore = await readJson(statusBeforePath, {});
  const candidates = selectParityFixCandidates(statusBefore);

  let codexRes = { code: 0, stdout: "", stderr: "", skipped: true };
  if (!skipFix && candidates.length) {
    const prompt = buildCodexPrompt({ candidates, artifactDir });
    await writeText(path.join(artifactDir, "codex-prompt.txt"), `${prompt}\n`);
    codexRes = await runCommand("codex", ["--full-auto", prompt], {
      cwd: repoRoot,
      timeoutMs
    });
    await writeText(path.join(artifactDir, "codex.log"), `${codexRes.stdout}\n${codexRes.stderr}`);
  }

  let testRes = { code: 0, stdout: "", stderr: "", skipped: true };
  if (!skipTests) {
    testRes = await runCommand("npm", ["test"], { cwd: repoRoot, timeoutMs });
    await writeText(path.join(artifactDir, "npm-test.log"), `${testRes.stdout}\n${testRes.stderr}`);
  }

  const afterRes = await runCommand("node", ["command/run_parity_examples.mjs", "--status", statusAfterPath], {
    cwd: repoRoot,
    timeoutMs
  });
  await writeText(path.join(artifactDir, "parity-after.log"), `${afterRes.stdout}\n${afterRes.stderr}`);

  const statusAfter = await readJson(statusAfterPath, {});
  const delta = computeParityDelta(statusBefore, statusAfter);

  const report = {
    runId,
    agentName,
    createdAt: new Date().toISOString(),
    artifactDir,
    candidates,
    before: summarizeParityStatus(statusBefore),
    after: summarizeParityStatus(statusAfter),
    delta,
    commands: {
      parityBeforeCode: beforeRes.code,
      codexCode: codexRes.code,
      npmTestCode: testRes.code,
      parityAfterCode: afterRes.code
    }
  };
  await writeText(deltaPath, `${JSON.stringify(report, null, 2)}\n`);

  const summaryLines = [
    sentenceToPyash({ mood: "ya", su: { name: "parity cycle run id" }, ob: { text: runId }, be: "text" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity cycle agent" }, ob: { text: agentName }, be: "text" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity cycle improved" }, ob: { boolean: delta.improved }, be: "bool" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity red before" }, ob: { num: report.before.parityRed }, be: "num" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity red after" }, ob: { num: report.after.parityRed }, be: "num" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity green before" }, ob: { num: report.before.parityGreen }, be: "num" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity green after" }, ob: { num: report.after.parityGreen }, be: "num" }),
    sentenceToPyash({ mood: "ya", su: { name: "parity delta file" }, ob: { filename: deltaPath }, be: "filename" })
  ];
  await writeText(summaryPath, `${summaryLines.join("\n")}\n`);

  let notify = { sent: false, reason: "skipped" };
  if (!skipNotify) {
    const summaryText = delta.improved
      ? `[parity] improvement: red ${report.before.parityRed} -> ${report.after.parityRed}, green ${report.before.parityGreen} -> ${report.after.parityGreen}. artifact: ${artifactDir}`
      : `[parity] improve fail error: red ${report.before.parityRed} -> ${report.after.parityRed}, green ${report.before.parityGreen} -> ${report.after.parityGreen}. artifact: ${artifactDir}`;
    try {
      notify = await sendMatrixSummary({
        worldRoot,
        agentName,
        summaryText,
        roomOverride: matrixRoom
      });
    } catch (err) {
      notify = { sent: false, reason: String(err?.message ?? err) };
      await writeText(path.join(artifactDir, "notify-error.log"), `${notify.reason}\n`);
    }
  }

  const final = {
    ok: true,
    improved: delta.improved,
    regressed: delta.regressed,
    unchanged: delta.unchanged,
    runId,
    artifactDir,
    notify
  };
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
