import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { recordArtifact } from "../bridge/exchange.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { state } from "../bridge/state.mjs";
import { canonicalJsonStringify, sha256 } from "./hear/hash.mjs";
import { resolveWhisperBinary, resolveWhisperStreamBinary, resolveModelPath, resolveHearLanguage, resolveHearCapture, resolveHearPrompt, resolveHearInputPath, resolveHearBackend, resolveHearHost, resolveHearWhisperxModel } from "./hear/config.mjs";
import { resolveOutputPath, metadataPathForOutput, readInputBytes } from "./hear/paths.mjs";
import { isBlankAudioLine, buildStreamTranscript, sanitizeTranscript, makeStreamStdoutWriter, startFileTail } from "./hear/stream.mjs";
import { handleHearStream } from "./hear/run_stream.mjs";
import { resolveConfigBool, resolveConfigText } from "../configure/env.mjs";
import { transcribeWithWhisperx } from "./hear/whisperx.mjs";

const hearStreamProcesses = new Map();

export { resolveHearInputPath };

function formatSrtTimestamp(ms) {
  const totalMs = Math.max(0, Math.trunc(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function transcriptToSrt(transcript) {
  const lines = String(transcript ?? "")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const cues = lines.map((line, index) => {
    const startMs = index * 2000;
    const endMs = (index + 1) * 2000;
    return `${index + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${line}`;
  });
  return `${cues.join("\n\n")}\n`;
}

function classifyEvidentialFromSource(sentence) {
  const source = sentence?.from?.filename ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  const lower = String(source).toLowerCase();
  if (/\b(news|report|reported|article)\b/u.test(lower)) return "reported";
  return "direct";
}

function clipLogText(value, max = 1200) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return text.slice(-max);
}

function hearWhisperxLogStreamingEnabled(rememberFn) {
  const configured = resolveConfigBool("stream stdout", { rememberFn });
  if (configured !== undefined) return configured;
  return process?.stdout?.isTTY === true;
}

function resolveEvokeInputPath({ rememberFn } = {}) {
  const evoke = state.currentEvokeRef || state.currentEvoke;
  if (!evoke) return null;

  if (typeof evoke?.ob?.filename === "string") return evoke.ob.filename;
  if (typeof evoke?.to?.filename === "string") return evoke.to.filename;
  if (typeof evoke?.from?.filename === "string") return evoke.from.filename;

  const artifactName = evoke?.ob?.name;
  if (!artifactName || !rememberFn) return null;
  const artifactFact = rememberFn(artifactName);
  if (!artifactFact) return null;

  if (typeof artifactFact?.to?.filename === "string") return artifactFact.to.filename;
  if (typeof artifactFact?.ob?.filename === "string") return artifactFact.ob.filename;
  if (typeof artifactFact?.from?.filename === "string") return artifactFact.from.filename;
  if (typeof artifactFact?.ob?.text === "string") return artifactFact.ob.text;
  return null;
}

export async function hear(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "hear", caseKey: "vyah" });
  const aspectKey = aspect === "dweh" ? "timebox" : aspect;
  const wantsSrt = sentence?.become?.wo === "srt";
  const outputPath = resolveOutputPath(sentence, { defaultExt: wantsSrt ? ".srt" : ".txt" });
  const metadataPath = metadataPathForOutput(outputPath);
  const hearBackend = resolveHearBackend({ rememberFn });
  const wantsSpeakerDiarize = sentence?.as?.wo === "speaker";
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
    return { su: { name: targetName }, vyah: { ve: { type: "name", values: ["cancel", "success"] } }, be: "hear", mood: "ya" };
  }
  if (aspectKey !== "eval" && aspectKey !== "stream" && aspectKey !== "timebox") {
    throwErrorSentence({
      name: "hear aspect invalid",
      message: `hear does not support vyah ${aspect}`,
      from: { name: "hear" },
      raw: { aspect }
    });
  }
  if (wantsSrt && aspectKey === "stream") {
    throwErrorSentence({
      name: "hear defective",
      message: "hear defective: stream does not support srt",
      from: { name: "hear" },
      raw: { sentence }
    });
  }

  const fixture = resolveConfigText("hear fixture", { rememberFn });
  const defaultFact = rememberFn?.("hear");
  const defaultTarget = defaultFact?.be === "default" ? defaultFact?.ob?.name : null;
  if (!fixture && defaultTarget && defaultTarget !== "hear") {
    const hasInputPath = Boolean(resolveHearInputPath(sentence, { rememberFn }));
    const hasTarget = Boolean(sentence?.to?.name || sentence?.to?.filename);
    const canForward =
      !wantsSrt &&
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
  const inputPath = resolveHearInputPath(sentence, { rememberFn }) || resolveEvokeInputPath({ rememberFn });
  if (aspectKey === "stream") {
    const streamResult = await handleHearStream({ sentence, rememberFn, fixture, hearStreamProcesses });
    if (streamResult?.stream) return streamResult.stream;
    transcript = streamResult?.transcript ?? transcript;
    backend = streamResult?.backend ?? backend;
    model = streamResult?.model ?? model;
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
      if (wantsSrt) {
        const host = resolveHearHost({ rememberFn });
        const whisperxModel = resolveHearWhisperxModel({ rememberFn });
        const language = resolveHearLanguage({ rememberFn });
        backend = "whisperx";
        model = whisperxModel;
        const requestSentence = {
          mood: "do",
          su: { name: "hear request whisperx" },
          from: { filename: inputPath },
          to: { filename: outputPath },
          fromstate: { text: host },
          as: { text: whisperxModel },
          be: "hear"
        };
        if (wantsSpeakerDiarize) requestSentence.vyah = { ve: { type: "name", values: ["speaker"] } };
        emitExchangeSentence(requestSentence);
        try {
          const whisperxLogLines = [];
          const payload = await transcribeWithWhisperx({
            host,
            inputPath,
            outputPath,
            language,
            model: whisperxModel,
            diarize: wantsSpeakerDiarize,
            streamLogs: hearWhisperxLogStreamingEnabled(rememberFn),
            onLog: (line) => {
              const text = String(line ?? "").trim();
              if (!text) return;
              whisperxLogLines.push(text);
              if (whisperxLogLines.length > 200) whisperxLogLines.shift();
              emitExchangeSentence({
                mood: "ya",
                su: { name: "hear whisperx log" },
                ob: { text: clipLogText(text, 800) },
                fromstate: { text: host },
                as: { text: whisperxModel },
                be: "hear"
              });
            }
          });
          transcript = String(await fs.readFile(outputPath, "utf8"));
          const resultSentence = {
            mood: "ya",
            su: { name: "hear result whisperx" },
            from: { filename: inputPath },
            ob: { filename: outputPath },
            fromstate: { text: host },
            as: { text: whisperxModel },
            be: "hear"
          };
          const stdout = clipLogText(payload?.stdout ?? "");
          const stderrRaw = payload?.stderr ?? (whisperxLogLines.length ? whisperxLogLines.join("\n") : "");
          const stderr = clipLogText(stderrRaw);
          if (stdout) resultSentence.totext = { text: stdout };
          if (stderr) resultSentence.fromtext = { text: stderr };
          const statusNum = Number(payload?.status);
          if (Number.isFinite(statusNum)) resultSentence.by = { num: statusNum };
          emitExchangeSentence(resultSentence);
        } catch (err) {
          throwErrorSentence({
            name: "hear defective",
            message: `hear defective: ${err?.message ?? "whisperx failed"}`,
            from: { name: "hear" },
            raw: { host, inputPath, outputPath, error: err?.message ?? String(err) }
          });
        }
      } else {
        const whisperBin = resolveWhisperBinary({ rememberFn });
        const modelPath = resolveModelPath({ rememberFn });
        const prompt = resolveHearPrompt(sentence);
        backend = "whisper.cpp";
        model = modelPath;
        const outputBase = outputPath.replace(/\.[^.]+$/, "");
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        const res = await new Promise((resolve, reject) => {
          const formatFlag = wantsSrt ? "-osrt" : "-otxt";
          const args = ["-m", String(modelPath), "-f", String(inputPath), "-nt", "-np", formatFlag, "-of", outputBase];
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
          if (wantsSrt) {
            transcript = String(await fs.readFile(outputPath, "utf8"));
          } else {
            transcript = sanitizeTranscript(await fs.readFile(outputPath, "utf8"));
          }
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
  }
  if (wantsSrt) {
    if (!/-->/u.test(String(transcript ?? ""))) {
      transcript = transcriptToSrt(sanitizeTranscript(transcript));
    }
    if (!String(transcript ?? "").trim()) {
      throwErrorSentence({
        name: "hear defective",
        message: "hear defective: missing srt transcript",
        from: { name: "hear" },
        raw: { outputPath }
      });
    }
  } else {
    transcript = String(transcript ?? "");
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, transcript, "utf8");

  const transcriptBytes = Buffer.from(transcript, "utf8");
  const inputBytes = await readInputBytes(sentence);

  const producer = String(sentence?.su?.name ?? "hear");
  const artifact = recordArtifact({
    locator: outputPath,
    producer,
    bytes: transcriptBytes,
    kind: "hear"
  });

  const metadata = {
    kind: "hear",
    backend,
    model: model ?? undefined,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(transcriptBytes),
    format: wantsSrt ? "srt" : "text",
    streaming: false
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer,
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  const evidential = classifyEvidentialFromSource(sentence);
  const result = {
    ob: wantsSrt ? { filename: outputPath } : { text: transcript },
    be: "hear",
    fromstate: { wo: "audio" },
    accordingto: { wo: evidential }
  };
  if (artifact?.su?.name) return result;
  return result;
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
  { signatureWords: ["be", "hear", "from", "name", "filename", "during", "num", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "to", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "name", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "filename", "to", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "filename", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "name", "filename", "to", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "become", "wo", "srt", "from", "name", "text", "to", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "as", "wo", "speaker", "become", "wo", "srt"], handler: hear },
  { signatureWords: ["be", "hear", "as", "wo", "speaker", "become", "wo", "srt", "to", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "as", "wo", "speaker", "become", "wo", "srt", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "as", "wo", "speaker", "become", "wo", "srt", "from", "filename", "to", "filename"], handler: hear }
];
