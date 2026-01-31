import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { recordArtifact, getExchangeSentenceId } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeStream } from "../library/runtimePrimitives.mjs";
import { state } from "../bridge/state.mjs";
import { canonicalJsonStringify, sha256 } from "./hear/hash.mjs";
import { resolveWhisperBinary, resolveWhisperStreamBinary, resolveModelPath, resolveHearLanguage, resolveHearCapture, resolveHearPrompt, resolveHearInputPath } from "./hear/config.mjs";
import { parseFixtureLines, isBlankAudioLine, buildStreamTranscript, sanitizeTranscript, makeStreamStdoutWriter, startFileTail, resolveStreamStdoutEnabled, maybeEnableStreamStdout, startStreamEndWatcher } from "./hear/stream.mjs";
import { resolveConfigText } from "../configure/env.mjs";

const hearStreamProcesses = new Map();

let hearCounter = 0;

export { resolveHearInputPath } from "./hear/config.mjs";

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

async function readInputBytes(sentence) {
  const filename = sentence?.from?.filename;
  if (!filename) return Buffer.alloc(0);
  try {
    return await fs.readFile(filename);
  } catch {
    return Buffer.alloc(0);
  }
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

  const fixture = resolveConfigText("hear fixture", { rememberFn });
  const defaultFact = rememberFn?.("hear");
  const defaultTarget = defaultFact?.be === "default" ? defaultFact?.ob?.name : null;
  if (!fixture && defaultTarget && defaultTarget !== "hear") {
    const hasInputPath = Boolean(resolveHearInputPath(sentence, { rememberFn }));
    const hasTarget = Boolean(sentence?.to?.name || sentence?.to?.filename);
    const canForward =
      !hasTarget &&
      ((aspectKey === "timebox" && Number.isFinite(Number(sentence?.during?.num ?? sentence?.during))) ||
      (aspectKey === "eval" && hasInputPath));
    if (canForward) {
      const { interpret } = await import("../bridge/index.mjs");
      const spec = defaultFact?.from?.filename ?? defaultFact?.from?.name;
      if (spec) {
        const moduleSpec = path.resolve(process.cwd(), spec);
        await interpret({
          mood: "do",
          be: "import",
          from: { name: moduleSpec },
          ob: { name: "hear" },
          to: { name: defaultTarget }
        });
      }
      const forwarded = { ...sentence, be: defaultTarget };
      for (const key of Object.keys(forwarded)) {
        if (forwarded[key] === undefined) delete forwarded[key];
      }
      const prevSource = state.currentSourceSentence;
      state.currentSourceSentence = forwarded;
      try {
        return await interpret(forwarded);
      } finally {
        state.currentSourceSentence = prevSource;
      }
    }
  }
  let transcript = "";
  let backend = "fixture";
  let model = null;
  const inputPath = resolveHearInputPath(sentence, { rememberFn });
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
      const whisperBin = resolveWhisperStreamBinary({ rememberFn });
      const modelPath = resolveModelPath({ rememberFn });
      const streamOutputPath = resolveStreamOutputPath(sentence);
      const captureId = resolveHearCapture({ rememberFn });
      const language = resolveHearLanguage({ rememberFn });
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
    const durationSeconds = Number(sentence?.during?.num ?? sentence?.during);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throwErrorSentence({
        name: "hear timebox invalid",
        message: "hear timebox requires during num <s>",
        from: { name: "hear" },
        raw: { during: sentence?.during }
      });
    }
    const durationMs = Math.max(1, Math.round(durationSeconds * 1000));
    if (fixture !== undefined) {
      transcript = String(fixture ?? "");
    } else {
      const whisperBin = resolveWhisperStreamBinary({ rememberFn });
      const modelPath = resolveModelPath({ rememberFn });
      const captureId = resolveHearCapture({ rememberFn });
      const language = resolveHearLanguage({ rememberFn });
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
      const whisperBin = resolveWhisperBinary({ rememberFn });
      const modelPath = resolveModelPath({ rememberFn });
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
  { signatureWords: ["be", "hear", "from", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "ob", "text", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "ob", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "text", "to", "name", "text"], handler: hear },
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
