import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { recordArtifact, getExchangeSentenceId } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeStream } from "../library/runtimePrimitives.mjs";

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
  return path.join("caterer", "hear", "template", "whisper", "ggml-base.en.bin");
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
      const values = String(fixture ?? "").split(/\r?\n/).filter(line => line.length > 0);
      return makeStream({
        name: streamName,
        state: "open",
        ob: { ve: { values }, index: 0, kind: "hear", final: true }
      });
    }

    const whisperBin = resolveWhisperStreamBinary();
    const modelPath = resolveModelPath();
    const streamOutputPath = resolveStreamOutputPath(sentence);
    const captureId = process.env.PYA_HEAR_CAPTURE ?? "0";
    await fs.mkdir(path.dirname(streamOutputPath), { recursive: true });
    spawn(String(whisperBin), ["-c", String(captureId), "-m", String(modelPath), "-f", String(streamOutputPath)], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    return makeStream({
      name: streamName,
      state: "open",
      ob: { filename: streamOutputPath, index: 0, kind: "hear", backend: "whisper-stream" }
    });
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
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const res = await new Promise((resolve, reject) => {
        const proc = spawn(String(whisperBin), ["-c", String(captureId), "-m", String(modelPath), "-f", String(outputPath)], {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
        proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
        proc.on("error", reject);
        const timer = setTimeout(() => {
          proc.kill("SIGINT");
        }, durationMs);
        proc.on("close", status => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr });
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
        transcript = await fs.readFile(outputPath, "utf8");
      } catch (err) {
        throwErrorSentence({
          name: "hear defective",
          message: "hear defective: missing transcript",
          from: { name: "hear" },
          raw: { outputPath, error: err?.message }
        });
      }
      backend = "whisper-stream";
      model = modelPath;
    }
  } else {
    if (fixture !== undefined) {
      transcript = String(fixture ?? "");
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
      backend = "whisper.cpp";
      model = modelPath;
      const outputBase = outputPath.replace(/\.txt$/, "");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const res = await new Promise((resolve, reject) => {
        const proc = spawn(String(whisperBin), ["-m", String(modelPath), "-f", String(inputPath), "-nt", "-np", "-otxt", "-of", outputBase], {
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
        transcript = await fs.readFile(outputPath, "utf8");
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
  { signatureWords: ["be", "hear", "from", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename"], handler: hear },
  { signatureWords: ["be", "hear", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "to", "name", "text"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "stream"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "during", "num", "vyah", "timebox"], handler: hear },
  { signatureWords: ["be", "hear", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "during", "num", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "filename", "during", "num", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "vyah", "dweh"], handler: hear },
  { signatureWords: ["be", "hear", "from", "name", "filename", "during", "num", "vyah", "dweh"], handler: hear }
];
