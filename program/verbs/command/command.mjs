import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { renderSayValue } from "../say.mjs";
import { resolveConfigBool, resolveConfigText } from "../../configure/env.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";
import { classifyCommandText } from "../../library/command_policy.mjs";
import { emitExchangeSentence } from "../../bridge/exchange.mjs";
import { resolveCommandText, canRunDirect, splitCommand, resolveDirectProgram, resolveShellCommand } from "./classify.mjs";
import { resolveCommandPolicy, shouldRequireRatify, shouldDeny, isNetworkDenied, buildCommandResumeToken } from "./policy.mjs";
import { emitCommandAudit, commandRequestSentence, resolveCommandIdentity, commandResultSentence, rememberCommandResult, recordCommandOutput } from "./audit.mjs";
import { rewriteRunRootCommandPath, resolveSandboxSettings, buildAllowedEnv, validateSandboxWritePolicy } from "./sandbox.mjs";
import { resolveStreamOutputPath, parseCommandTimeoutOverride, isInlineTimeoutOverrideEnabled, startFileTail, runCommandText } from "./execute.mjs";
import { currentMindInterruptSignal } from "../../agent/interrupt.mjs";

const commandStreamProcesses = new Map();
const STREAM_END_TOKEN = "[PYA_STREAM_END]";
const FAILURE_OUTPUT_LIMIT = 4000;
const FAILURE_COMMAND_LIMIT = 1200;

function resolveStreamProcessPath(streamPath) {
  return String(streamPath).replace(/\.stream\.txt$/u, ".process.txt");
}

function appendBoundedTail(current, chunk, limit = FAILURE_OUTPUT_LIMIT) {
  return `${current}${String(chunk ?? "")}`.slice(-limit);
}

function formatStreamProcessReport({ cmd, cwd, status, signal, stdoutBytes, stderr, stderrBytes, launchError }) {
  const lines = [
    `status: ${Number.isInteger(status) ? status : "unknown"}`,
    `signal: ${signal || "none"}`,
    `working directory: ${cwd || "<unknown>"}`,
    `command: ${boundedDiagnosticText(cmd, FAILURE_COMMAND_LIMIT)}`,
    `stdout bytes: ${stdoutBytes}`,
    `stderr bytes: ${stderrBytes}`,
    `stderr truncated: ${stderrBytes > Buffer.byteLength(stderr, "utf8")}`
  ];
  if (launchError) lines.push(`launch error: ${launchError}`);
  lines.push(`stderr:\n${stderr.trim() ? boundedDiagnosticText(stderr, FAILURE_OUTPUT_LIMIT) : "<empty>"}`);
  return `${lines.join("\n")}\n`;
}

function boundedDiagnosticText(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  const headLength = Math.min(600, Math.floor(limit / 4));
  const tailLength = limit - headLength;
  const omitted = text.length - limit;
  return `${text.slice(0, headLength)}\n...[${omitted} characters omitted; showing output tail]...\n${text.slice(-tailLength)}`;
}

function formatCommandFailure({
  cmd,
  cwd,
  status,
  signal,
  timedOut,
  exceededOutputLimit,
  aborted,
  timeoutMs,
  maxOutputBytes,
  stdout,
  stderr,
  launchError
}) {
  const statusText = Number.isInteger(status) ? String(status) : "unknown";
  const signalText = signal ? String(signal) : "none";
  const stream = (label, value) => {
    const text = String(value ?? "");
    if (!text) return `${label}:\n<empty>`;
    return `${label}:\n${boundedDiagnosticText(text, FAILURE_OUTPUT_LIMIT).trimEnd()}`;
  };
  const details = [
    `command defective: status=${statusText} signal=${signalText}`,
    `command: ${boundedDiagnosticText(cmd, FAILURE_COMMAND_LIMIT)}`,
    `working directory: ${cwd || "<unknown>"}`,
    `exit code: ${statusText}`,
    `timed out: ${timedOut === true}${timedOut && timeoutMs ? ` (limit ${timeoutMs}ms)` : ""}`,
    `output limit exceeded: ${exceededOutputLimit === true}${exceededOutputLimit && maxOutputBytes ? ` (limit ${maxOutputBytes} bytes)` : ""}`,
    `aborted: ${aborted === true}`
  ];
  if (launchError) details.push(`launch error: ${String(launchError)}`);
  details.push(stream("stdout", stdout), stream("stderr", stderr));
  return details.join("\n");
}

export async function command(sentence, { remember: rememberFn = remember, runtimeContext = null } = {}) {
  const interruptSignal = runtimeContext?.signal ?? currentMindInterruptSignal();
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "command", caseKey: "vyah" });
  const debug = resolveConfigBool("command debug", { rememberFn }) === true;
  if (aspect === "cancel") {
    const targetName = sentence?.su?.name;
    if (!targetName) {
      throwErrorSentence({
        name: "command cancel invalid",
        message: "command cancel requires su name",
        from: { name: "command" },
        raw: { sentence }
      });
    }
    const entry = commandStreamProcesses.get(targetName);
    if (entry?.proc) {
      entry.proc.kill("SIGINT");
      if (entry.stop) entry.stop();
      commandStreamProcesses.delete(targetName);
    }
    return { su: { name: targetName }, vyah: { ve: { type: "name", values: ["cancel", "success"] } }, be: "command", mood: "ya" };
  }
  if (aspect && aspect !== "stream" && aspect !== "eval") {
    throwErrorSentence({
      name: "command aspect invalid",
      message: `command does not support vyah ${aspect}`,
      from: { name: "command" },
      raw: { aspect }
    });
  }

  const { identity: requestIdentity, resumed } = resolveCommandIdentity({ sentence });
  const commandResponse = resolveConfigText("command response", { rememberFn });
  if (commandResponse !== undefined) {
    const output = String(commandResponse);
    if (aspect === "stream") {
      const streamName = sentence?.su?.name;
      if (!streamName) {
        throwErrorSentence({
          name: "command stream invalid",
          message: "command vyah stream requires su name",
          from: { name: "command" },
          raw: { sentence }
        });
      }
      const values = output.split(/\r?\n/).filter(Boolean);
      return makeStream({
        name: streamName,
        state: "open",
        ob: { ve: { values }, kind: "command", final: true }
      });
    }
    if (!resumed) emitExchangeSentence(commandRequestSentence({ requestIdentity, sentence }));
    if (sentence?.to?.filename) {
      await fs.mkdir(path.dirname(sentence.to.filename), { recursive: true });
      await fs.writeFile(sentence.to.filename, output, "utf8");
    }
    const resultSentence = commandResultSentence({ requestIdentity, output });
    await recordCommandOutput({ filename: sentence?.to?.filename, output, requestIdentity });
    rememberCommandResult({ sentence, resultSentence });
    return resultSentence;
  }
  const rawCmd = resolveCommandText(sentence.ob ?? {}, { rememberFn });
  if (!rawCmd) {
    throwErrorSentence({
      name: "command defective",
      message: "command defective: empty command",
      from: { la: sentence },
      raw: { cmd: rawCmd }
    });
  }
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const cmd = rewriteRunRootCommandPath(rawCmd, { cwd: sandbox.cwd, rememberFn });
  const commandClass = classifyCommandText(cmd);
  const policy = resolveCommandPolicy({ sentence, cmdClass: commandClass, rememberFn });
  const auditedCommandClass = policy.classifierEnabled ? commandClass : "unknown";
  const commandEnv = buildAllowedEnv({ allowlist: sandbox.envAllowlist, cwd: sandbox.cwd, runRoot: sandbox.runRoot });
  if (!resumed) emitExchangeSentence(commandRequestSentence({ requestIdentity, sentence }));
  if (shouldDeny({ sentence, policy, commandClass })) {
    emitCommandAudit({ requestIdentity, stage: "policy", commandClass: auditedCommandClass, policy, decision: "deny", sentence, rememberFn });
    throwErrorSentence({
      name: "command policy defective",
      message: `command policy defective: denied class=${commandClass}`,
      from: { la: sentence },
      raw: { class: commandClass, mode: policy.mode }
    });
  }
  if (shouldRequireRatify({ sentence, policy, commandClass, resumed })) {
    const resumeToken = buildCommandResumeToken({ sentence, commandClass, commandText: cmd, requestIdentity });
    const ratifySentence = {
      mood: "do",
      be: "ratify",
      su: { name: sentence?.su?.name ?? "command approval" },
      ob: { text: `approve command (${commandClass}): ${cmd}` },
      from: { name: "command" },
      to: { name: requestIdentity.name },
      accordingto: { name: "resume token" },
      fromtext: { text: resumeToken }
    };
    emitCommandAudit({
      requestIdentity,
      stage: "policy",
      commandClass: auditedCommandClass,
      policy,
      decision: "ask",
      sentence,
      resultSentence: ratifySentence,
      rememberFn
    });
    return ratifySentence;
  }
  if (isNetworkDenied({ commandClass, sandbox })) {
    emitCommandAudit({ requestIdentity, stage: "sandbox", commandClass: auditedCommandClass, policy, decision: "deny", sentence, rememberFn });
    throwErrorSentence({
      name: "command sandbox defective",
      message: "command sandbox defective: network disabled",
      from: { la: sentence },
      raw: { class: commandClass, network: false }
    });
  }
  validateSandboxWritePolicy({ sentence, commandText: cmd, commandClass, sandbox });
  emitCommandAudit({ requestIdentity, stage: "policy", commandClass: auditedCommandClass, policy, decision: "allow", sentence, rememberFn });

  let input = null;
  if (sentence.from?.filename) {
    input = await fs.readFile(sentence.from.filename, "utf8");
  }
  if (input === null && sentence.fromtext) {
    const resolved = renderSayValue(sentence.fromtext, { rememberFn });
    if (resolved !== undefined && resolved !== null) {
      input = String(resolved);
    }
  }
  if (input === null && sentence.from) {
    const resolved = renderSayValue(sentence.from, { rememberFn });
    if (resolved !== undefined && resolved !== null) {
      input = String(resolved);
    }
  }
  if (aspect === "stream") {
    const streamName = sentence?.su?.name;
    if (!streamName) {
      throwErrorSentence({
        name: "command stream invalid",
        message: "command vyah stream requires su name",
        from: { name: "command" },
        raw: { sentence }
      });
    }
    const streamPath = resolveStreamOutputPath(sentence);
    const processPath = resolveStreamProcessPath(streamPath);
    await fs.mkdir(path.dirname(streamPath), { recursive: true });
    await fs.rm(processPath, { force: true });
    fsSync.writeFileSync(streamPath, "");
    const outStream = fsSync.createWriteStream(streamPath, { flags: "a" });
    let proc;
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: sandbox.cwd,
      env: commandEnv
    };
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(resolveDirectProgram(parts[0]), parts.slice(1), spawnOptions);
    } else {
      const shell = resolveShellCommand();
      if (!shell) {
        throwErrorSentence({
          name: "command defective",
          message: "command defective: no shell executable found",
          from: { la: sentence },
          raw: { cmd }
        });
      }
      proc = spawn(shell, ["-lc", String(cmd)], spawnOptions);
    }
    let stderr = "";
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let processReportWritten = false;
    let abortTimer = null;
    const writeProcessReport = ({ status = proc.exitCode, signal = proc.signalCode, launchError = "" } = {}) => {
      if (processReportWritten) return;
      processReportWritten = true;
      fsSync.writeFileSync(processPath, formatStreamProcessReport({
        cmd,
        cwd: sandbox.cwd,
        status,
        signal,
        stdoutBytes,
        stderr,
        stderrBytes,
        launchError
      }), "utf8");
    };
    const abortProcess = () => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill("SIGINT");
      abortTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      }, 1000);
      abortTimer.unref?.();
    };
    const cleanupSignal = () => {
      if (abortTimer) clearTimeout(abortTimer);
      interruptSignal?.removeEventListener?.("abort", abortProcess);
    };
    proc.stderr.on("data", data => {
      const text = data.toString("utf8");
      stderrBytes += Buffer.byteLength(text, "utf8");
      stderr = appendBoundedTail(stderr, text);
    });
    proc.stdout.on("data", data => {
      stdoutBytes += data.length;
      outStream.write(data);
    });
    proc.on("close", (status) => {
      cleanupSignal();
      writeProcessReport({ status, signal: proc.signalCode });
      if (status && status !== 0) {
        // eslint-disable-next-line no-console
        console.error(`command stream exited ${status}: ${stderr.trim()}`);
      }
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
    proc.on("error", (error) => {
      cleanupSignal();
      writeProcessReport({ status: null, signal: proc.signalCode, launchError: error?.message ?? String(error) });
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
    if (interruptSignal?.aborted) abortProcess();
    else interruptSignal?.addEventListener?.("abort", abortProcess, { once: true });
    const streamInput = sentence?.from?.name ? rememberFn?.(sentence.from.name) : null;
    if (streamInput?.be === "stream" && streamInput.ob?.filename) {
      const stopTail = startFileTail({
        filename: streamInput.ob.filename,
        onLine: (line) => {
          const trimmed = String(line ?? "").trim();
          if (!trimmed) return;
          if (trimmed.includes(STREAM_END_TOKEN) || trimmed.includes("[BLANK_AUDIO]")) {
            proc.stdin.end();
            stopTail();
            return;
          }
          proc.stdin.write(`${trimmed}\n`);
        }
      });
    } else if (streamInput?.be === "stream" && Array.isArray(streamInput.ob?.ve?.values)) {
      for (const value of streamInput.ob.ve.values) {
        proc.stdin.write(String(value ?? ""));
        proc.stdin.write("\n");
      }
      proc.stdin.end();
    } else if (input !== null && input !== undefined) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
    commandStreamProcesses.set(streamName, { proc });
    return makeStream({
      name: streamName,
      state: "open",
      ob: { filename: streamPath, kind: "command" }
    });
  }

  const piperFixture = process.env.PYA_PIPER_FIXTURE;
  if (piperFixture !== undefined && String(cmd).includes("command/piper_say_runner.mjs")) {
    const outputText = String(piperFixture);
    const match = String(cmd).match(/--output\s+([^\s]+)/);
    if (match?.[1]) {
      const outPath = match[1];
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, outputText, "utf8");
    }
    if (sentence?.to?.filename) {
      await fs.mkdir(path.dirname(sentence.to.filename), { recursive: true });
      await fs.writeFile(sentence.to.filename, outputText, "utf8");
    }
    const resultSentence = commandResultSentence({ requestIdentity, output: outputText });
    await recordCommandOutput({ filename: sentence?.to?.filename, output: outputText, requestIdentity });
    rememberCommandResult({ sentence, resultSentence });
    return resultSentence;
  }

  const inlineTimeoutMs = parseCommandTimeoutOverride(cmd);
  const effectiveTimeoutMs = (inlineTimeoutMs !== null && isInlineTimeoutOverrideEnabled({ rememberFn }))
    ? inlineTimeoutMs
    : sandbox.timeoutMs;
  let res;
  try {
    res = await runCommandText(cmd, {
      input,
      timeoutMs: effectiveTimeoutMs,
      cwd: sandbox.cwd,
      env: commandEnv,
      maxOutputBytes: sandbox.maxOutputBytes,
      signal: interruptSignal,
      onStdout: process.env.PYA_RUN_VERBOSE === "1"
        ? (text) => {
            try {
              process.stdout.write(text);
            } catch {}
          }
        : null,
      onStderr: process.env.PYA_RUN_VERBOSE === "1"
        ? (text) => {
            try {
              process.stderr.write(text);
            } catch {}
          }
        : null
    });
  } catch (err) {
    const launchError = String(err?.message ?? err);
    throwErrorSentence({
      name: "command defective",
      message: formatCommandFailure({
        cmd,
        cwd: sandbox.cwd,
        status: null,
        signal: null,
        timedOut: false,
        exceededOutputLimit: false,
        aborted: false,
        timeoutMs: effectiveTimeoutMs,
        maxOutputBytes: sandbox.maxOutputBytes,
        stdout: "",
        stderr: "",
        launchError
      }),
      from: { la: sentence },
      raw: { cmd, cwd: sandbox.cwd, timeoutMs: effectiveTimeoutMs, launchError }
    });
  }
  if (debug) {
    const stdout = String(res.stdout ?? "");
    const stderr = String(res.stderr ?? "");
    // eslint-disable-next-line no-console
    console.error(`[command debug] ${JSON.stringify({
      cmd,
      class: commandClass,
      policyMode: policy.mode,
      policySource: policy.source,
      status: res.status ?? null,
      signal: res.signal ?? null,
      timedOut: res.timedOut === true,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
      stderr: stderr.slice(0, 200)
    })}`);
  }
  const failed = Boolean(res.status) || Boolean(res.signal) || res.timedOut === true || res.exceededOutputLimit === true;
  if (failed) {
    emitCommandAudit({
      requestIdentity,
      stage: "result",
      commandClass: auditedCommandClass,
      policy,
      decision: "error",
      sentence,
      resultSentence: { mood: "do", be: "error", su: { name: "command defective" }, ob: { text: `status=${Number.isInteger(res.status) ? res.status : "unknown"} signal=${res.signal ?? "none"}` } },
      rememberFn
    });
    throwErrorSentence({
      name: "command defective",
      message: formatCommandFailure({
        cmd,
        cwd: sandbox.cwd,
        status: res.status,
        signal: res.signal,
        timedOut: res.timedOut,
        exceededOutputLimit: res.exceededOutputLimit,
        aborted: res.aborted,
        timeoutMs: effectiveTimeoutMs,
        maxOutputBytes: sandbox.maxOutputBytes,
        stdout: res.stdout,
        stderr: res.stderr
      }),
      from: { la: sentence },
      raw: {
        status: res.status,
        signal: res.signal ?? "",
        timedOut: res.timedOut === true,
        exceededOutputLimit: res.exceededOutputLimit === true,
        stderr: res.stderr ?? "",
        stdout: res.stdout ?? "",
        command: cmd,
        cwd: sandbox.cwd,
        timeoutMs: effectiveTimeoutMs,
        maxOutputBytes: sandbox.maxOutputBytes,
        aborted: res.aborted === true
      }
    });
  }
  const output = String(res.stdout ?? "");
  if (sentence?.to?.filename) {
    await fs.mkdir(path.dirname(sentence.to.filename), { recursive: true });
    await fs.writeFile(sentence.to.filename, output, "utf8");
  }
  const resultSentence = commandResultSentence({ requestIdentity, output });
  await recordCommandOutput({ filename: sentence?.to?.filename, output, requestIdentity });
  rememberCommandResult({ sentence, resultSentence });
  emitCommandAudit({
    requestIdentity,
    stage: "result",
    commandClass: auditedCommandClass,
    policy,
    decision: "allow",
    sentence,
    resultSentence,
    rememberFn
  });
  return resultSentence;
}

export const signatures = [
  { signatureWords: ["be", "command", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "vyah", "cancel"], handler: command }
];

