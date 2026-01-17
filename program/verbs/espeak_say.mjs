import { spawn } from "node:child_process";
import fsSync from "node:fs";

import { remember } from "../remember/index.mjs";
import { resolveConfigBool, resolveConfigNum, resolveConfigText } from "../configure/env.mjs";
import { renderSayValue } from "./say.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";

function resolveEspeakBinary({ rememberFn } = {}) {
  return resolveConfigText("espeak bin", { rememberFn }) || "espeak-ng";
}

function fixPunctuationSpacing(text) {
  if (!text) return text;
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ");
}

function normalizeSpeechText(text) {
  if (!text) return text;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return fixPunctuationSpacing(collapsed);
}

function appendSpeechText(buffer, chunk) {
  const text = normalizeSpeechText(String(chunk ?? ""));
  if (!text) return buffer;
  if (!buffer) return text;
  if (/[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(text)) {
    return normalizeSpeechText(`${buffer} ${text}`);
  }
  return normalizeSpeechText(buffer + text);
}

function splitAtWordBoundary(text) {
  const match = text.match(/[\s,.;:!?]+(?=[^\s,.;:!?]*$)/);
  if (!match) return { speak: "", rest: text };
  const idx = match.index + match[0].length;
  return { speak: text.slice(0, idx), rest: text.slice(idx) };
}

function ensureWholeWordSplit({ speak, rest }) {
  if (!speak || !rest) return { speak, rest };
  if (!/[A-Za-z0-9]$/.test(speak) || !/^[A-Za-z0-9]/.test(rest)) {
    return { speak, rest };
  }
  const match = speak.match(/^(.*?)([A-Za-z0-9]+)$/);
  if (!match) return { speak: "", rest: speak + rest };
  return { speak: match[1], rest: match[2] + rest };
}

function appendChunkText(buffer, chunk) {
  const text = String(chunk ?? "");
  if (!text) return buffer;
  if (!buffer) return text;
  if (/^\s/.test(text)) return buffer + text;
  return buffer + text;
}

function appendWordChunkText(buffer, chunk) {
  const text = String(chunk ?? "");
  if (!text) return buffer;
  if (!buffer) return text;
  if (/^\s/.test(text)) return buffer + text;
  if (/[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(text)) {
    return `${buffer} ${text}`;
  }
  return buffer + text;
}

function shouldFlushChunk(buffer) {
  const trimmed = buffer.trimEnd();
  if (!trimmed) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;
  if (/[.?!,;:]$/.test(trimmed)) return true;
  if (/\S\s$/.test(buffer)) return true;
  return trimmed.length >= 180;
}

function resolveStreamDelayMs({ rememberFn } = {}) {
  const raw = resolveConfigNum("say stream delay", { rememberFn });
  if (raw === undefined) return 150;
  if (!Number.isFinite(raw) || raw < 0) return 150;
  return raw;
}

function hasTailBoundary(buffer) {
  return /[\s,.;:!?]$/.test(buffer);
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

async function speakText(text, { rememberFn } = {}) {
  if (!text) return;
  if (resolveConfigBool("say silent", { rememberFn })) return;
  const bin = resolveEspeakBinary({ rememberFn });
  await new Promise((resolve, reject) => {
    const proc = spawn(bin, ["--stdin"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code && code !== 0) {
        const detail = stderr.trim();
        reject(new Error(detail ? `espeak exited ${code}: ${detail}` : `espeak exited ${code}`));
      } else {
        resolve();
      }
    });
    proc.stdin.write(String(text ?? ""));
    proc.stdin.end();
  });
}

export async function espeakSay(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "say", caseKey: "vyah" });
  if (aspect !== "eval" && aspect !== "stream") {
    throwErrorSentence({
      name: "espeak say aspect invalid",
      message: `espeak say does not support vyah ${aspect}`,
      from: { name: "espeak say" },
      raw: { aspect }
    });
  }

  if (aspect === "stream") {
    const streamName = sentence?.from?.name ?? sentence?.from?.text;
    if (!streamName) {
      throwErrorSentence({
        name: "espeak say stream invalid",
        message: "espeak say stream requires from name <stream>",
        from: { name: "espeak say" },
        raw: { sentence }
      });
    }
    const stream = rememberFn?.(streamName);
    if (!stream || stream.be !== "stream") {
      throwErrorSentence({
        name: "espeak say stream missing",
        message: `stream not found: ${streamName}`,
        from: { name: "espeak say" },
        raw: { streamName }
      });
    }
    const chunks = Array.isArray(stream.ob?.ve?.values) ? stream.ob.ve.values : [];
    let buffer = "";
    let fullText = "";
    const flushBuffer = async () => {
      const raw = buffer;
      const { speak, rest } = ensureWholeWordSplit(splitAtWordBoundary(raw));
      buffer = rest;
      const text = normalizeSpeechText(speak);
      if (!text || !/[A-Za-z0-9]/.test(text)) {
        return;
      }
      fullText = appendSpeechText(fullText, text);
      await speakText(text, { rememberFn });
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
          if (!hasTailBoundary(buffer)) {
            scheduleFlush();
            return;
          }
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
  try {
    await speakText(text, { rememberFn });
  } catch (err) {
    throwErrorSentence({
      name: "espeak say defective",
      message: `espeak say defective: ${err?.message ?? "audio playback failed"}`,
      from: { name: "espeak say" },
      raw: { error: err?.message ?? String(err ?? "") }
    });
  }
  return { ob: { text: String(text ?? "") }, be: "say" };
}

export default espeakSay;

export const signatures = [
  { signatureWords: ["be", "espeak say", "ob", "text"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "num"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "bool"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "hollow"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "name", "text"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "name", "num"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "name", "bool"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "ob", "name", "hollow"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "from", "name", "stream", "vyah", "stream"], handler: espeakSay },
  { signatureWords: ["be", "espeak say", "from", "name", "text", "vyah", "stream"], handler: espeakSay }
];
