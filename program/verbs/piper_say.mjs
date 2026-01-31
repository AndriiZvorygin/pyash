import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { recordArtifact } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { resolveConfigBool, resolveConfigNum, resolveConfigText } from "../configure/env.mjs";
import { resolveVoiceId, resolvePiperBinary, resolveVoicePath, resolveStreamChunkPath, resolveStreamDelayMs, resolveOutputPath, metadataPathForOutput, canonicalJsonStringify, sha256 } from "./piper_utils.mjs";
import { ensureWholeWordSplit, splitAtWordBoundary, normalizeSpeechText, appendSpeechText, appendChunkText, appendWordChunkText, shouldFlushChunk } from "./piper_text.mjs";
import { startFileTail } from "./piper_tail.mjs";

export async function piperSay(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "say", caseKey: "vyah" });
  if (aspect === "stream") {
    const streamName = sentence?.from?.name ?? sentence?.from?.text;
    if (!streamName) {
      throwErrorSentence({
        name: "piper say stream invalid",
        message: "piper say stream requires from name <stream>",
        from: { name: "piper say" },
        raw: { sentence }
      });
    }
    const stream = rememberFn?.(streamName);
    if (!stream || stream.be !== "stream") {
      throwErrorSentence({
        name: "piper say stream missing",
        message: `stream not found: ${streamName}`,
        from: { name: "piper say" },
        raw: { streamName }
      });
    }
    const chunks = Array.isArray(stream.ob?.ve?.values) ? stream.ob.ve.values : [];
    let buffer = "";
    let fullText = "";
    let chunkIndex = 0;
    const voiceId = resolveVoiceId({ rememberFn });
    const fixture = resolveConfigText("piper fixture", { rememberFn });
    const piperBin = fixture !== undefined ? null : resolvePiperBinary({ rememberFn });
    const voicePath = fixture !== undefined ? null : resolveVoicePath(voiceId);
    const flushBuffer = async () => {
      const raw = buffer;
      const { speak, rest } = ensureWholeWordSplit(splitAtWordBoundary(raw));
      buffer = rest;
      const text = normalizeSpeechText(speak);
      if (!text || !/[A-Za-z0-9]/.test(text)) {
        return;
      }
      fullText = appendSpeechText(fullText, text);
      if (fixture !== undefined) return;
      const outputPath = resolveStreamChunkPath(sentence, chunkIndex++);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const res = await new Promise((resolve, reject) => {
        const proc = spawn(String(piperBin), ["--model", String(voicePath), "--output_file", outputPath], {
          stdio: ["pipe", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
        proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
        proc.on("error", reject);
        proc.on("close", status => resolve({ status, stdout, stderr }));
        proc.stdin.write(String(text ?? ""));
        proc.stdin.end();
      });
      if (res.status) {
        throwErrorSentence({
          name: "piper say defective",
          message: `piper say defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
          from: { name: "piper say" },
          raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
        });
      }
      try {
        await playAudio(outputPath, { rememberFn });
      } catch (err) {
        if (resolveConfigBool("say strict audio", { rememberFn })) {
          throwErrorSentence({
            name: "piper say defective",
            message: `piper say defective: ${err?.message ?? "audio playback failed"}`,
            from: { name: "piper say" },
            raw: { outputPath }
          });
        } else {
          // eslint-disable-next-line no-console
          console.error(`piper say warning: ${err?.message ?? "audio playback failed"}`);
        }
      }
    };

    if (stream.ob?.filename) {
      const filename = stream.ob.filename;
      let done = null;
      const waitForEnd = new Promise(resolve => { done = resolve; });
      let chain = Promise.resolve();
      const enqueue = (fn) => {
        chain = chain.then(fn).catch(() => {});
      };
      const delayMs = resolveStreamDelayMs({ rememberFn });
      let flushTimer = null;
      const scheduleFlush = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
          flushTimer = null;
          enqueue(flushBuffer);
        }, delayMs);
      };
      const stopTail = startFileTail({
        filename,
        onLine: (line) => {
          const raw = String(line ?? "");
          if (!raw.trim()) return;
          const trimmed = raw.trim();
          if (trimmed === "[PYA_STREAM_END]" || trimmed === "[STREAM_END]") {
            if (done) done();
            return;
          }
          let chunk = raw;
          if (raw.trim().startsWith("\"")) {
            try {
              chunk = JSON.parse(raw);
            } catch {
              chunk = raw;
            }
          }
          buffer = appendChunkText(buffer, chunk);
          if (shouldFlushChunk(buffer)) {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = null;
            }
            enqueue(flushBuffer);
          } else {
            scheduleFlush();
          }
        }
      });
      await waitForEnd;
      stopTail();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await chain;
      if (buffer.trim()) {
        await flushBuffer();
      }
      return { ob: { text: fullText }, be: "say" };
    }

    for (const chunk of chunks) {
      buffer = appendWordChunkText(buffer, chunk);
      if (!shouldFlushChunk(buffer)) continue;
      await flushBuffer();
    }
    if (buffer.trim()) {
      await flushBuffer();
    }
    return { ob: { text: fullText }, be: "say" };
  }

  const text = renderSayValue(sentence.ob ?? {}, { rememberFn });
  const outputPath = resolveOutputPath(sentence, { ext: ".wav" });
  const metadataPath = metadataPathForOutput(outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const fixture = resolveConfigText("piper fixture", { rememberFn });
  let audioBytes;
  let voiceId = resolveVoiceId({ rememberFn });

  if (fixture !== undefined) {
    audioBytes = Buffer.from(String(fixture), "utf8");
    await fs.writeFile(outputPath, audioBytes);
  } else {
    const piperBin = resolvePiperBinary({ rememberFn });
    const voicePath = resolveVoicePath(voiceId);
    const res = await new Promise((resolve, reject) => {
      const proc = spawn(String(piperBin), ["--model", String(voicePath), "--output_file", outputPath], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
      proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
      proc.on("error", reject);
      proc.on("close", status => resolve({ status, stdout, stderr }));
      proc.stdin.write(String(text ?? ""));
      proc.stdin.end();
    });
    if (res.status) {
      throwErrorSentence({
        name: "piper say defective",
        message: `piper say defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
        from: { name: "piper say" },
        raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
      });
    }
    audioBytes = await fs.readFile(outputPath);
  }

  if (!sentence?.to?.filename) {
    try {
      await playAudio(outputPath, { rememberFn });
    } catch (err) {
      if (resolveConfigBool("say strict audio", { rememberFn })) {
        throwErrorSentence({
          name: "piper say defective",
          message: `piper say defective: ${err?.message ?? "audio playback failed"}`,
          from: { name: "piper say" },
          raw: { outputPath }
        });
      } else {
        // eslint-disable-next-line no-console
        console.error(`piper say warning: ${err?.message ?? "audio playback failed"}`);
      }
    }
  }

  const artifact = recordArtifact({
    locator: outputPath,
    producer: "say",
    bytes: audioBytes,
    kind: "say"
  });

  const inputBytes = Buffer.from(String(text ?? ""), "utf8");
  const metadata = {
    kind: "say",
    backend: "piper",
    voice: voiceId,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(audioBytes),
    format: "wav",
    streaming: false
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer: "say",
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  if (artifact?.su?.name) {
    return { ob: { name: artifact.su.name }, be: "say" };
  }
  return { ob: { text: outputPath }, be: "say" };
}

export default piperSay;

export const signatures = [
  { signatureWords: ["be", "piper say", "from", "name", "stream", "vyah", "stream"], handler: piperSay },
  { signatureWords: ["be", "piper say", "from", "name", "text", "vyah", "stream"], handler: piperSay },
  { signatureWords: ["be", "piper say", "from", "name", "stream", "to", "name", "text", "vyah", "stream"], handler: piperSay },
  { signatureWords: ["be", "piper say", "from", "name", "text", "to", "name", "text", "vyah", "stream"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "num"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "bool"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "hollow"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "num"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "bool"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "hollow"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "text", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "num", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "bool", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "hollow", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "text", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "num", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "bool", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "hollow", "to", "name", "text"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "text", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "num", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "bool", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "hollow", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "text", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "num", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "bool", "to", "filename"], handler: piperSay },
  { signatureWords: ["be", "piper say", "ob", "name", "hollow", "to", "filename"], handler: piperSay }
];
