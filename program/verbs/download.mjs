import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { recordArtifact, recordExchange } from "../bridge/exchange.mjs";

function resolveText(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.name === "string") return fact.ob.name;
  }
  return "";
}

function resolveUrl(sentence, { rememberFn } = {}) {
  return resolveText(sentence?.from, { rememberFn });
}

function resolveOutput(sentence, { rememberFn } = {}) {
  return resolveText(sentence?.to, { rememberFn });
}

function missingBackend(sentence, { scheme, intent } = {}) {
  const note = [scheme, intent].filter(Boolean).join(" ");
  throwErrorSentence({
    name: "download defective",
    message: `download defective: backend missing${note ? ` (${note})` : ""}`,
    from: { name: "download" },
    raw: { sentence }
  });
}

async function recordDownloadArtifact(filename) {
  try {
    const bytes = await fs.readFile(filename);
    const artifact = recordArtifact({ locator: filename, producer: "exchange", bytes });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
    }
  } catch {}
}

async function runCurl({ url, outputPath }) {
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", ["-L", "-o", outputPath, url], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    proc.stderr.on("data", data => {
      stderr += data.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", status => resolve({ status, stderr }));
  });
}

async function runYtDlp({ url, outputPath, intent }) {
  return new Promise((resolve, reject) => {
    const args = ["-o", outputPath];
    if (intent === "audio") {
      args.unshift("-x", "--audio-format", "mp3");
    }
    args.push(url);
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => {
      stderr += data.toString("utf8");
    });
    proc.on("error", err => {
      if (err?.code === "ENOENT") {
        resolve({ status: 127, stderr: "yt-dlp missing" });
        return;
      }
      reject(err);
    });
    proc.on("close", status => resolve({ status, stderr }));
  });
}

export async function download_http(sentence, { scheme, intent, remember: rememberFn = remember } = {}) {
  const url = resolveUrl(sentence, { rememberFn });
  const dest = resolveOutput(sentence, { rememberFn });
  if (!url) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing source url",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  if (!dest) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing target filename",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  const resolvedDest = path.resolve(dest);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });

  const mock = process.env.PYA_DOWNLOAD_RESPONSE;
  if (mock !== undefined) {
    await fs.writeFile(resolvedDest, String(mock ?? ""), "utf8");
    return { ob: { filename: resolvedDest }, be: "download" };
  }

  const { status, stderr } = await runCurl({ url, outputPath: resolvedDest });
  if (status !== 0) {
    throwErrorSentence({
      name: "download defective",
      message: `download defective: curl failed${stderr ? ` (${stderr.trim()})` : ""}`,
      from: { name: "download" },
      raw: { url, scheme, intent }
    });
  }
  await recordDownloadArtifact(resolvedDest);
  return { ob: { filename: resolvedDest }, be: "download" };
}

export async function download_ytdlp(sentence, { scheme, intent, remember: rememberFn = remember } = {}) {
  const url = resolveUrl(sentence, { rememberFn });
  const dest = resolveOutput(sentence, { rememberFn });
  if (!url) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing source url",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  if (!dest) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing target filename",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  const resolvedDest = path.resolve(dest);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });

  const mock = process.env.PYA_DOWNLOAD_RESPONSE;
  if (mock !== undefined) {
    await fs.writeFile(resolvedDest, String(mock ?? ""), "utf8");
    return { ob: { filename: resolvedDest }, be: "download" };
  }

  const { status, stderr } = await runYtDlp({ url, outputPath: resolvedDest, intent });
  if (status !== 0) {
    const reason = String(stderr ?? "").trim();
    const msg = reason.includes("yt-dlp missing")
      ? "download defective: ytdlp missing"
      : `download defective: yt-dlp failed${reason ? ` (${reason})` : ""}`;
    throwErrorSentence({
      name: "download defective",
      message: msg,
      from: { name: "download" },
      raw: { url, scheme, intent }
    });
  }
  await recordDownloadArtifact(resolvedDest);
  return { ob: { filename: resolvedDest }, be: "download" };
}

export async function download_missing(sentence, { scheme, intent } = {}) {
  return missingBackend(sentence, { scheme, intent });
}

export default async function download(sentence, { remember: rememberFn = remember } = {}) {
  const scheme = sentence?.fromstate?.name;
  if (!scheme) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing fromstate",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  const intent = sentence?.as?.wo;
  if (scheme === "http" || scheme === "https") {
    if (intent === "web" || intent === "file") {
      return download_http(sentence, { scheme, intent, remember: rememberFn });
    }
    if (intent === "video" || intent === "audio") {
      return download_ytdlp(sentence, { scheme, intent, remember: rememberFn });
    }
    return missingBackend(sentence, { scheme, intent });
  }
  return missingBackend(sentence, { scheme, intent });
}

export const signatures = [
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "from", "filename", "fromstate", "name", "magnet", "to", "filename"], handler: (s) => download_missing(s, { scheme: "magnet" }) },
  { signatureWords: ["be", "download", "from", "filename", "fromstate", "name", "ipfs", "to", "filename"], handler: (s) => download_missing(s, { scheme: "ipfs" }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "name", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "name", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "name", "filename", "fromstate", "name", "http", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "name", "filename", "fromstate", "name", "https", "to", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "http", "to", "name", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "https", "to", "name", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "http", "to", "name", "filename"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "https", "to", "name", "filename"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) }
];
