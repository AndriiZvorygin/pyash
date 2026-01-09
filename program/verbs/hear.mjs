import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { recordArtifact, getExchangeSentenceId } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeStream } from "../library/runtimePrimitives.mjs";

const hearStreamProcesses = new Map();

let hearCounter = 0;

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonValue(item));
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function resolveComputer() {
  const arch = process.arch;
  switch (process.platform) {
    case "win32":
      return arch === "x64" ? "win-x64" : `win-${arch}`;
    case "darwin":
      if (arch === "x64") return "darwin-x64";
      if (arch === "arm64") return "darwin-arm64";
      return `darwin-${arch}`;
    case "linux":
      if (arch === "x64") return "linux-x64";
      if (arch === "arm64") return "linux-arm64";
      return `linux-${arch}`;
    default:
      return `${process.platform}-${arch}`;
  }
}

function resolveWhisperBinary() {
  if (process.env.PYA_HEAR_BIN) return process.env.PYA_HEAR_BIN;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-main${ext}`);
}

function resolveWhisperStreamBinary() {
  if (process.env.PYA_HEAR_STREAM_BIN) return process.env.PYA_HEAR_STREAM_BIN;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-stream${ext}`);
}

function resolveModelPath() {
  if (process.env.PYA_HEAR_MODEL) return process.env.PYA_HEAR_MODEL;
  const baseBin = path.join("caterer", "hear", "template", "whisper", "ggml-base.bin");
  if (fsSync.existsSync(baseBin)) return baseBin;
  return path.join("caterer", "hear", "template", "whisper", "ggml-base.en.bin");
}

function resolveHearLanguage() {
  return process.env.PYA_HEAR_LANGUAGE || "auto";
}

function resolveHearPrompt(sentence) {
  const prompt = sentence?.ob?.text;
  if (typeof prompt !== "string") return "";
  const trimmed = prompt.trim();
  return trimmed.length ? trimmed : "";
}

function resolveOutputPath(sentence) {
  const base = getExchangeSentenceId() || sentence?.su?.name || `hear-${hearCounter++}`;
  return path.join("artifacts", "hear", `${base}.txt`);
}

function resolveStreamOutputPath(sentence) {
  const base = getExchangeSentenceId() || sentence?.su?.name || `hear-${hearCounter++}`;
  return path.join("artifacts", "hear", `${base}.stream.txt`);
}

function metadataPathForOutput(outputPath) {
  if (outputPath.endsWith(".txt")) {
    return `${outputPath.slice(0, -4)}.metadata.json`;
  }
  return `${outputPath}.metadata.json`;
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

async function readInputBytes(sentence) {
  const filename = sentence?.from?.filename;
  if (!filename) return Buffer.alloc(0);
  try {
    return await fs.readFile(filename);
  } catch {
    return Buffer.alloc(0);
  }
}

function parseFixtureLines(fixtureText) {
  return String(fixtureText ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBlankAudioLine(line));
}

function normalizeStreamLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function normalizeStreamPrefix(line) {
  const normalized = normalizeStreamLine(line);
  return normalized.replace(/[.]+$/u, "");
}

function isBlankAudioLine(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.includes("[BLANK_AUDIO]");
}

function collapseStreamLines(lines) {
  const output = [];
  let lastLine = "";
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || isBlankAudioLine(trimmed)) continue;
    if (!lastLine) {
      output.push(trimmed);
      lastLine = trimmed;
      continue;
    }
    const normLast = normalizeStreamLine(lastLine);
    const normNext = normalizeStreamLine(trimmed);
    const normLastPrefix = normalizeStreamPrefix(lastLine);
    if (normNext === normLast) continue;
    if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
      output[output.length - 1] = trimmed;
      lastLine = trimmed;
      continue;
    }
    output.push(trimmed);
    lastLine = trimmed;
  }
  return output;
}

function buildStreamTranscript(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  return collapseStreamLines(lines).join("\n");
}

function sanitizeTranscript(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBlankAudioLine(line))
    .join("\n");
}

function makeStreamStdoutWriter() {
  let lastLine = "";
  let lineOpen = false;
  return {
    write(line) {
      const trimmed = String(line ?? "").trim();
      if (!trimmed || trimmed === "[BLANK_AUDIO]") return;
      if (!lastLine) {
        process.stdout.write(trimmed);
        lastLine = trimmed;
        lineOpen = true;
        return;
      }
      const normLast = normalizeStreamLine(lastLine);
      const normNext = normalizeStreamLine(trimmed);
      const normLastPrefix = normalizeStreamPrefix(lastLine);
      if (normNext === normLast) return;
      if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
        const suffix = trimmed.slice(lastLine.length);
        if (suffix) {
          process.stdout.write(suffix);
          lastLine = trimmed;
          lineOpen = true;
        }
        return;
      }
      if (lineOpen) process.stdout.write("\n");
      process.stdout.write(trimmed);
      lastLine = trimmed;
      lineOpen = true;
    },
    finish() {
      if (lineOpen) process.stdout.write("\n");
      lineOpen = false;
    }
  };
}

function startStreamStdoutTail(streamOutputPath, { onBlank, enabled = true } = {}) {
  if (!enabled) return () => {};
  const writer = makeStreamStdoutWriter();
  const stopTail = startFileTail({
    filename: streamOutputPath,
    onLine: (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (isBlankAudioLine(trimmed)) {
        if (onBlank) onBlank();
        return;
      }
      writer.write(trimmed);
    }
  });
  return () => {
    stopTail();
    writer.finish();
  };
}

function resolveStreamStdoutEnabled({ rememberFn } = {}) {
  if (process.env.PYA_STREAM_STDOUT === "1") return true;
  if (process.env.PYA_STREAM_STDOUT === "0") return false;
  const configured = rememberFn?.("stream stdout");
  if (configured?.be === "default" && typeof configured?.ob?.boolean === "boolean") {
    return configured.ob.boolean;
  }
  return process.stdout?.isTTY === true;
}

function maybeEnableStreamStdout(streamOutputPath, { onBlank, rememberFn } = {}) {
  return startStreamStdoutTail(streamOutputPath, {
    onBlank,
    enabled: resolveStreamStdoutEnabled({ rememberFn })
  });
}

function startStreamEndWatcher(streamOutputPath, { onBlank } = {}) {
  return startFileTail({
    filename: streamOutputPath,
    onLine: (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (isBlankAudioLine(trimmed)) {
        if (onBlank) onBlank();
      }
    }
  });
}

export async function hear(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "hear", caseKey: "vyah" });
  const aspectKey = aspect === "dweh" ? "timebox" : aspect;
  if (aspectKey === "cancel") {
    const targetName = sentence?.su?.name;
    if (!targetName) {
      throwErrorSentence({
        name: "hear cancel invalid",
        message: "hear cancel requires su name",
        from: { name: "hear" },
        raw: { sentence }
      });
    }
    const entry = hearStreamProcesses.get(targetName);
    if (entry) {
      const proc = entry.proc ?? entry;
      proc.kill("SIGINT");
      if (entry.stopWatcher) entry.stopWatcher();
      hearStreamProcesses.delete(targetName);
    }
    return { su: { name: targetName }, vyah: { ve: { type: "name", values: ["cancel", "sloh"] } }, be: "hear", mood: "ya" };
  }
  if (aspectKey !== "eval" && aspectKey !== "stream" && aspectKey !== "timebox") {
    throwErrorSentence({
      name: "hear aspect invalid",
      message: `hear does not support vyah ${aspect}`,
      from: { name: "hear" },
      raw: { aspect }
    });
  }

  const fixture = process.env.PYA_HEAR_FIXTURE;
  let transcript = "";
  let backend = "fixture";
  let model = null;
  const inputPath = sentence?.from?.filename;
  const outputPath = resolveOutputPath(sentence);
  const metadataPath = metadataPathForOutput(outputPath);
  if (aspectKey === "stream") {
    const streamName = sentence?.su?.name ?? "hear stream";
    if (fixture !== undefined) {
      const values = parseFixtureLines(fixture);
      if (resolveStreamStdoutEnabled({ rememberFn })) {
        for (const line of values) {
          const trimmed = String(line ?? "").trim();
          if (trimmed) process.stdout.write(`${trimmed}\n`);
        }
        transcript = values.join("\n");
        backend = "fixture";
      } else {
        return makeStream({
          name: streamName,
          state: "open",
          ob: { ve: { values }, index: 0, kind: "hear", final: true }
        });
      }
    } else {
      const whisperBin = resolveWhisperStreamBinary();
      const modelPath = resolveModelPath();
      const streamOutputPath = resolveStreamOutputPath(sentence);
      const captureId = process.env.PYA_HEAR_CAPTURE ?? "0";
      const language = resolveHearLanguage();
      const prompt = resolveHearPrompt(sentence);
      await fs.mkdir(path.dirname(streamOutputPath), { recursive: true });
      fsSync.writeFileSync(streamOutputPath, "");
      const args = ["-c", String(captureId), "-m", String(modelPath), "-l", String(language), "-f", String(streamOutputPath)];
      if (prompt) {
        args.push("--prompt", prompt);
      }
      const proc = spawn(String(whisperBin), args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      hearStreamProcesses.set(streamName, { proc });

      if (process.stdin?.isTTY !== false && resolveStreamStdoutEnabled({ rememberFn })) {
        let done = null;
        const waitForEnd = new Promise(resolve => { done = resolve; });
        const stopTail = maybeEnableStreamStdout(streamOutputPath, { onBlank: () => done?.(), rememberFn });
        const stopBlankWatcher = resolveStreamStdoutEnabled({ rememberFn })
          ? null
          : startStreamEndWatcher(streamOutputPath, { onBlank: () => done?.() });
        await new Promise(resolve => {
          process.stdin.resume();
          const finish = () => resolve();
          process.stdin.once("end", finish);
          process.stdin.once("close", finish);
          waitForEnd.then(finish);
        });
        if (process.stdin?.isTTY !== false) {
          process.stdin.pause();
        }
        proc.kill("SIGINT");
        hearStreamProcesses.delete(streamName);
        stopTail();
        if (stopBlankWatcher) stopBlankWatcher();
        try {
          transcript = buildStreamTranscript(await fs.readFile(streamOutputPath, "utf8"));
        } catch (err) {
          throwErrorSentence({
            name: "hear defective",
            message: "hear defective: missing transcript",
            from: { name: "hear" },
            raw: { outputPath: streamOutputPath, error: err?.message }
          });
        }
        backend = "whisper-stream";
        model = modelPath;
      } else {
        const stopWatcher = startStreamEndWatcher(streamOutputPath, {
          onBlank: () => {
            proc.kill("SIGINT");
            const current = hearStreamProcesses.get(streamName);
            if (current?.stopWatcher) current.stopWatcher();
            hearStreamProcesses.delete(streamName);
          }
        });
        const current = hearStreamProcesses.get(streamName);
        if (current) {
          current.stopWatcher = stopWatcher;
        }
        maybeEnableStreamStdout(streamOutputPath, { rememberFn });
        return makeStream({
          name: streamName,
          state: "open",
          ob: { filename: streamOutputPath, index: 0, kind: "hear", backend: "whisper-stream" }
        });
      }
    }
  }

  if (aspectKey === "timebox") {
    const durationMs = Number(sentence?.during?.num ?? sentence?.during);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throwErrorSentence({
        name: "hear timebox invalid",
        message: "hear timebox requires during num <ms>",
        from: { name: "hear" },
        raw: { during: sentence?.during }
      });
    }
    if (fixture !== undefined) {
      transcript = String(fixture ?? "");
    } else {
      const whisperBin = resolveWhisperStreamBinary();
      const modelPath = resolveModelPath();
      const captureId = process.env.PYA_HEAR_CAPTURE ?? "0";
      const language = resolveHearLanguage();
      const prompt = resolveHearPrompt(sentence);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      fsSync.writeFileSync(outputPath, "");
      let stopTail = null;
      const startedAt = Date.now();
      const res = await new Promise((resolve, reject) => {
        const args = ["-c", String(captureId), "-m", String(modelPath), "-l", String(language), "-f", String(outputPath)];
        if (prompt) {
          args.push("--prompt", prompt);
        }
        const proc = spawn(String(whisperBin), args, {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
        proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
        proc.on("error", reject);
        let done = null;
        const waitForBlank = new Promise(resolve => { done = resolve; });
        const writer = makeStreamStdoutWriter();
        let sawTranscript = false;
        stopTail = startFileTail({
          filename: outputPath,
          onLine: (line) => {
            const trimmed = String(line ?? "").trim();
            if (!trimmed) return;
            if (isBlankAudioLine(trimmed)) {
              if (sawTranscript && done) done();
              return;
            }
            sawTranscript = true;
            writer.write(trimmed);
          }
        });
        const timer = setTimeout(() => {
          proc.kill("SIGINT");
        }, durationMs);
        waitForBlank.then(() => proc.kill("SIGINT"));
        proc.on("close", status => {
          clearTimeout(timer);
          if (stopTail) stopTail();
          writer.finish();
          resolve({ status, stdout, stderr, elapsedMs: Date.now() - startedAt });
        });
      });
      if (res.status && res.status !== 0) {
        throwErrorSentence({
          name: "hear defective",
          message: `hear defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
          from: { name: "hear" },
          raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
        });
      }
      try {
        transcript = buildStreamTranscript(await fs.readFile(outputPath, "utf8"));
      } catch (err) {
        throwErrorSentence({
          name: "hear defective",
          message: "hear defective: missing transcript",
          from: { name: "hear" },
          raw: { outputPath, error: err?.message }
        });
      }
      if (!transcript.trim() && (res.elapsedMs ?? 0) < Math.min(1000, durationMs)) {
        throwErrorSentence({
          name: "hear defective",
          message: `hear defective: ended early after ${res.elapsedMs ?? 0}ms`,
          from: { name: "hear" },
          raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "", elapsedMs: res.elapsedMs ?? 0 }
        });
      }
      backend = "whisper-stream";
      model = modelPath;
    }
  } else if (aspectKey !== "stream") {
    if (fixture !== undefined) {
      transcript = sanitizeTranscript(fixture);
    } else {
      if (!inputPath) {
        throwErrorSentence({
          name: "hear input missing",
          message: "hear input missing",
          from: { name: "hear" },
          raw: { sentence }
        });
      }
      const whisperBin = resolveWhisperBinary();
      const modelPath = resolveModelPath();
      const prompt = resolveHearPrompt(sentence);
      backend = "whisper.cpp";
      model = modelPath;
      const outputBase = outputPath.replace(/\.txt$/, "");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const res = await new Promise((resolve, reject) => {
        const args = ["-m", String(modelPath), "-f", String(inputPath), "-nt", "-np", "-otxt", "-of", outputBase];
        if (prompt) {
          args.push("--prompt", prompt);
        }
        const proc = spawn(String(whisperBin), args, {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
        proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
        proc.on("error", reject);
        proc.on("close", status => resolve({ status, stdout, stderr }));
      });
      if (res.status) {
        throwErrorSentence({
          name: "hear defective",
          message: `hear defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
          from: { name: "hear" },
          raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
        });
      }
      try {
        transcript = sanitizeTranscript(await fs.readFile(outputPath, "utf8"));
      } catch (err) {
        throwErrorSentence({
          name: "hear defective",
          message: "hear defective: missing transcript",
          from: { name: "hear" },
          raw: { outputPath, error: err?.message }
        });
      }
    }
  }
  transcript = String(transcript ?? "");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, transcript, "utf8");

  const transcriptBytes = Buffer.from(transcript, "utf8");
  const inputBytes = await readInputBytes(sentence);

  const artifact = recordArtifact({
    locator: outputPath,
    producer: "hear",
    bytes: transcriptBytes,
    kind: "hear"
  });

  const metadata = {
    kind: "hear",
    backend,
    model: model ?? undefined,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(transcriptBytes),
    format: "text",
    streaming: false
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer: "hear",
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  if (artifact?.su?.name) {
    return { ob: { text: transcript }, be: "hear" };
  }
  return { ob: { text: transcript }, be: "hear" };
}

export default hear;

export const signatures = [
  { signatureWords: ["be", "hear"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "ob", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "from", "name", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "ob", "text"], handler: hear },
  { signatureWords: ["be", "hear", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "cancel"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "ob", "text", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "ob", "text", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "during", "num", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "during", "num", "vyah", "dweh"], handler: hear }
];
