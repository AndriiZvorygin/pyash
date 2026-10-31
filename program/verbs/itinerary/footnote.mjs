import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { throwErrorSentence } from "../../error.mjs";
import { remember } from "../../remember/index.mjs";
import { resolveAgentPath } from "../../library/agent_cwd.mjs";
import { emitExchangeSentence, recordArtifact } from "../../bridge/exchange.mjs";
import { resolveFilenameFromCase } from "./media.mjs";

function defaultFootnoteOutputFilename(inputVideo) {
  const ext = path.extname(inputVideo || ".mp4") || ".mp4";
  const stem = path.basename(inputVideo || "video", ext);
  return path.join(path.dirname(inputVideo || "."), `${stem}-footnote${ext}`);
}

async function runFootnoteVideo({ inputVideo, inputSrt, outputVideo, mode, startDelaySeconds = 0, marginRatio = null }) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/footnote_video.mjs");
  const args = [runner, inputVideo, inputSrt, outputVideo];
  if (mode) args.push("--mode", mode);
  if (Number.isFinite(marginRatio) && marginRatio >= 0 && marginRatio <= 1) {
    args.push("--margin-ratio", String(marginRatio));
  }
  if (Number.isFinite(startDelaySeconds) && startDelaySeconds > 0) {
    args.push("--start-delay-seconds", String(startDelaySeconds));
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || `footnote failed with status ${code}`));
    });
  });
}

export async function footnoteVideo(
  sentence,
  { remember: rememberFn = remember, runFootnoteVideoFn = runFootnoteVideo } = {}
) {
  const inputSrtRaw = (() => {
    const direct = resolveFilenameFromCase(sentence?.from, rememberFn);
    if (!direct) return "";
    if (String(sentence?.fromstate?.wo ?? "").trim() !== "srt") return direct;
    if (/\.srt$/iu.test(direct)) return direct;
    const fromValues = Array.isArray(sentence?.from?.ve?.values) ? sentence.from.ve.values : [];
    for (let i = 0; i < fromValues.length; i += 1) {
      const token = String(fromValues[i] ?? "").trim();
      if (!token || token === "name") continue;
      const maybe = resolveFilenameFromCase({ name: token }, rememberFn);
      if (/\.srt$/iu.test(maybe)) return maybe;
      const next = String(fromValues[i + 1] ?? "").trim();
      if (token !== "name" && next && next !== "name") {
        const paired = resolveFilenameFromCase({ name: `${token} ${next}` }, rememberFn);
        if (/\.srt$/iu.test(paired)) return paired;
      }
    }
    return direct;
  })();
  const inputVideoRaw = resolveFilenameFromCase(sentence?.with, rememberFn);
  const outputRaw = resolveFilenameFromCase(sentence?.to, rememberFn)
    || (inputVideoRaw ? defaultFootnoteOutputFilename(inputVideoRaw) : "");
  if (!inputSrtRaw || !inputVideoRaw || !outputRaw) {
    throwErrorSentence({
      name: "footnote defective",
      message: "footnote defective: requires from srt, with video, and to output",
      from: { name: "footnote" },
      raw: { sentence }
    });
  }
  const inputSrt = resolveAgentPath(inputSrtRaw, { rememberFn });
  const inputVideo = resolveAgentPath(inputVideoRaw, { rememberFn });
  const outputVideo = resolveAgentPath(outputRaw, { rememberFn });
  if (inputSrt.outside || inputVideo.outside || outputVideo.outside) {
    throwErrorSentence({
      name: "footnote defective",
      message: `footnote defective: outside agent cwd (${outputVideo.agentCwd || inputVideo.agentCwd || inputSrt.agentCwd})`,
      from: { name: "footnote" },
      raw: { sentence }
    });
  }
  await fs.mkdir(path.dirname(outputVideo.resolved), { recursive: true });
  const mode = String(sentence?.as?.wo ?? sentence?.as?.text ?? "").trim().toLowerCase();
  const marginRatio = (() => {
    const raw = Number(sentence?.by?.num);
    if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
    return null;
  })();
  const startDelaySeconds = (() => {
    const raw = Number(sentence?.during?.num);
    if (Number.isFinite(raw) && raw >= 0) return raw;
    return 0.05;
  })();
  const samePath = path.resolve(inputVideo.resolved) === path.resolve(outputVideo.resolved);
  const renderOutput = samePath
    ? path.join(path.dirname(outputVideo.resolved), `${path.basename(outputVideo.resolved, path.extname(outputVideo.resolved))}.footnote.tmp${path.extname(outputVideo.resolved) || ".mp4"}`)
    : outputVideo.resolved;
  await runFootnoteVideoFn({
    inputVideo: inputVideo.resolved,
    inputSrt: inputSrt.resolved,
    outputVideo: renderOutput,
    mode: mode || undefined,
    startDelaySeconds,
    marginRatio
  });
  if (samePath) {
    await fs.rename(renderOutput, outputVideo.resolved);
  }
  const bytes = await fs.readFile(outputVideo.resolved);
  const artifact = recordArtifact({
    locator: outputVideo.resolved,
    producer: String(sentence?.su?.name ?? "footnote"),
    bytes,
    kind: "video"
  });
  emitExchangeSentence({
    mood: "ya",
    su: { name: "footnote result" },
    ob: { filename: outputVideo.resolved },
    be: "footnote",
    by: { num: bytes.length },
    accordingto: artifact?.su?.name ? { name: artifact.su.name } : undefined
  });
  return { ob: { filename: outputVideo.resolved }, be: "footnote" };
}

export const footnote = footnoteVideo;

export const signatures = [
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "karaoke", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "by", "num", "from", "filename", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "filename"], handler: footnoteVideo },
  { signatureWords: ["be", "footnote", "as", "wo", "wordflow", "become", "wo", "video", "by", "num", "from", "vec", "name", "fromstate", "wo", "srt", "to", "filename", "with", "text"], handler: footnoteVideo }
];

