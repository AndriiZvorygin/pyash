import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeStream } from "../library/runtimePrimitives.mjs";

function resolveCommandText(ob = {}, { rememberFn } = {}) {
  if (typeof ob.wo === "string") return ob.wo;
  return renderSayValue(ob, { rememberFn });
}

function canRunDirect(cmd) {
  if (typeof cmd !== "string") return false;
  return !/[|&;<>()$`\\]/.test(cmd) && !/["']/.test(cmd);
}

function splitCommand(cmd) {
  return String(cmd).trim().split(/\s+/).filter(Boolean);
}

const commandStreamProcesses = new Map();
const STREAM_END_TOKEN = "[PYA_STREAM_END]";

function resolveStreamOutputPath(sentence) {
  const base = sentence?.su?.name ?? `command-${Date.now()}`;
  return path.join("artifacts", "command", `${base}.stream.txt`);
}

function startFileTail({ filename, onLine }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

async function runCommandText(cmd, { input } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(parts[0], parts.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } else {
      proc = spawn(String(cmd), { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", status => resolve({ status, stdout, stderr }));
    if (input !== null && input !== undefined) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

export async function command(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "command", caseKey: "vyah" });
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
    return { su: { name: targetName }, vyah: { ve: { type: "name", values: ["cancel", "sloh"] } }, be: "command", mood: "ya" };
  }
  if (aspect && aspect !== "stream" && aspect !== "eval") {
    throwErrorSentence({
      name: "command aspect invalid",
      message: `command does not support vyah ${aspect}`,
      from: { name: "command" },
      raw: { aspect }
    });
  }

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
    if (sentence?.to?.name) {
      const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: output } };
      doRemember(fact);
    }
    return { ob: { text: output }, be: "command" };
  }
  const cmd = resolveCommandText(sentence.ob ?? {}, { rememberFn });
  if (!cmd) {
    throwErrorSentence({
      name: "command defective",
      message: "command defective: empty command",
      from: { la: sentence },
      raw: { cmd }
    });
  }
  let input = null;
  if (sentence.from?.filename) {
    input = await fs.readFile(sentence.from.filename, "utf8");
  } else if (sentence.fromtext?.text) {
    input = sentence.fromtext.text;
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
    await fs.mkdir(path.dirname(streamPath), { recursive: true });
    fsSync.writeFileSync(streamPath, "");
    const outStream = fsSync.createWriteStream(streamPath, { flags: "a" });
    let proc;
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(parts[0], parts.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } else {
      proc = spawn(String(cmd), { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    }
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.stdout.on("data", data => { outStream.write(data); });
    proc.on("close", (status) => {
      if (status && status !== 0) {
        // eslint-disable-next-line no-console
        console.error(`command stream exited ${status}: ${stderr.trim()}`);
      }
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
    proc.on("error", () => {
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
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
      await fs.writeFile(sentence.to.filename, outputText, "utf8");
    }
    if (sentence?.to?.name) {
      const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: outputText } };
      doRemember(fact);
    }
    return { ob: { text: outputText }, be: "command" };
  }

  const res = await runCommandText(cmd, { input });
  if (res.status) {
    throwErrorSentence({
      name: "command defective",
      message: `command defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
      from: { la: sentence },
      raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
    });
  }
  const output = String(res.stdout ?? "");
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, output, "utf8");
  }
  if (sentence?.to?.name) {
    const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: output } };
    doRemember(fact);
  }
  return { ob: { text: output }, be: "command" };
}

export default command;

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
  { signatureWords: ["be", "command", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "vyah", "cancel"], handler: command }
];
