import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { recordArtifact, getExchangeSentenceId } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";

let piperCounter = 0;

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

function resolveVoiceId({ rememberFn } = {}) {
  if (process.env.PYA_PIPER_VOICE) return process.env.PYA_PIPER_VOICE;
  const configured = rememberFn?.("vocalization");
  if (configured?.be === "default") {
    if (typeof configured?.ob?.text === "string") return configured.ob.text;
    if (typeof configured?.ob?.name === "string") return configured.ob.name;
  }
  return "en_US-lessac-medium";
}

function resolveVoicePath(voiceId) {
  if (!voiceId) return null;
  if (voiceId.includes("/") || voiceId.endsWith(".onnx")) return voiceId;
  return path.join("caterer", "say", "vocalization", "piper", voiceId, `${voiceId}.onnx`);
}

function resolvePiperBinary() {
  if (process.env.PYA_PIPER_BIN) return process.env.PYA_PIPER_BIN;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "say", "binary", computer, `piper${ext}`);
}

function resolveOutputPath(sentence, { ext } = {}) {
  if (sentence?.to?.filename) return sentence.to.filename;
  const base = getExchangeSentenceId() || sentence?.su?.name || `say-${piperCounter++}`;
  return path.join("artifacts", "say", `${base}${ext}`);
}

function metadataPathForOutput(outputPath) {
  if (outputPath.endsWith(".wav")) {
    return `${outputPath.slice(0, -4)}.metadata.json`;
  }
  return `${outputPath}.metadata.json`;
}

function resolveAudioPlayer() {
  if (process.env.PYA_AUDIO_PLAYER) return process.env.PYA_AUDIO_PLAYER;
  if (process.platform === "darwin") return "afplay";
  if (process.platform === "win32") return null;
  return "aplay";
}

async function playAudio(outputPath) {
  if (process.env.PYA_SAY_SILENT) return;
  const player = resolveAudioPlayer();
  if (!player) {
    throwErrorSentence({
      name: "piper say defective",
      message: "piper say defective: no audio player available",
      from: { name: "piper say" },
      raw: { outputPath }
    });
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(player, [outputPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code) {
        const detail = stderr.trim();
        reject(new Error(detail ? `player exited ${code}: ${detail}` : `player exited ${code}`));
      } else {
        resolve();
      }
    });
  });
}

export async function piperSay(sentence, { remember: rememberFn = remember } = {}) {
  const text = renderSayValue(sentence.ob ?? {}, { rememberFn });
  const outputPath = resolveOutputPath(sentence, { ext: ".wav" });
  const metadataPath = metadataPathForOutput(outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const fixture = process.env.PYA_PIPER_FIXTURE;
  let audioBytes;
  let voiceId = resolveVoiceId({ rememberFn });

  if (fixture !== undefined) {
    audioBytes = Buffer.from(String(fixture), "utf8");
    await fs.writeFile(outputPath, audioBytes);
  } else {
    const piperBin = resolvePiperBinary();
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
      await playAudio(outputPath);
    } catch (err) {
      if (process.env.PYA_SAY_STRICT_AUDIO) {
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
