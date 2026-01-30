import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";
import { throwErrorSentence } from "../error.mjs";
import { recordArtifact, recordExchange } from "../bridge/exchange.mjs";

function resolveGenitive(genitive, { rememberFn } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;

  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state.currentEvokeRef || state.currentEvoke)
      : (typeof root === "string" && rememberFn ? rememberFn(root) : undefined);

  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name && rememberFn) {
      const fact = rememberFn(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
    } else {
      curr = curr?.[part];
    }
  }

  if (typeof curr === "string") return curr;
  if (typeof curr === "number") return String(curr);
  if (curr && typeof curr === "object") {
    if (typeof curr.filename === "string") return curr.filename;
    if (typeof curr.text === "string") return curr.text;
    if (typeof curr.name === "string") return curr.name;
  }
  return curr;
}

function resolveText(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.genitive) {
    const resolved = resolveGenitive(value.genitive, { rememberFn });
    if (typeof resolved === "string") return resolved;
  }
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

function resolveExtraArgs(sentence, { rememberFn } = {}) {
  if (!rememberFn) return [];
  const sourceName = sentence?.with?.name ?? sentence?.with?.text ?? null;
  if (!sourceName) return [];
  const fact = rememberFn(sourceName);
  const values = fact?.ob?.ve?.values;
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value)).filter(Boolean);
}

function parseMonthWindow(sentence) {
  const direct = sentence?.during?.month;
  if (direct !== undefined) {
    const count = Number(direct);
    if (!Number.isFinite(count) || count <= 0) return null;
    return count;
  }
  const raw = sentence?.during?.name ?? sentence?.during?.text;
  if (!raw || typeof raw !== "string") return null;
  const match = raw.trim().match(/^months?\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  return count;
}

function formatMonthWindow(count) {
  const unit = count === 1 ? "month" : "months";
  return `today-${count}${unit}`;
}

function isMultiDownload(sentence) {
  return sentence?.ob?.wo === "all";
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

async function runCurl({ url, outputPath, extraArgs = [] }) {
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", ["-L", "-o", outputPath, ...extraArgs, url], {
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

async function runYtDlp({ url, outputPath, intent, extraArgs = [], multi = false, monthWindow = null }) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (outputPath) {
      args.push("-o", outputPath);
    }
    if (intent === "audio") {
      args.push("-x", "--audio-format", "opus", "--audio-quality", "0");
    }
    if (multi) {
      args.push("--lazy-playlist", "--break-on-reject");
    }
    if (monthWindow) {
      args.push("--dateafter", formatMonthWindow(monthWindow));
    }
    if (extraArgs.length) {
      args.push(...extraArgs);
    }
    args.push(url);
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", data => {
      process.stdout.write(data);
    });
    let stderr = "";
    proc.stderr.on("data", data => {
      const chunk = data.toString("utf8");
      stderr += chunk;
      process.stderr.write(chunk);
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
  const resolvedDest = dest
    ? path.resolve(dest)
    : (() => {
      try {
        const parsed = new URL(url);
        const base = path.basename(parsed.pathname || "");
        const name = base && base !== "/" ? base : "download.bin";
        return path.resolve(process.cwd(), name);
      } catch {
        return path.resolve(process.cwd(), "download.bin");
      }
    })();
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });

  const mock = process.env.PYA_DOWNLOAD_RESPONSE;
  if (mock !== undefined) {
    await fs.writeFile(resolvedDest, String(mock ?? ""), "utf8");
    return { ob: { filename: resolvedDest }, be: "download" };
  }

  const extraArgs = resolveExtraArgs(sentence, { rememberFn });
  const { status, stderr } = await runCurl({ url, outputPath: resolvedDest, extraArgs });
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
  const multi = isMultiDownload(sentence);
  const monthWindow = parseMonthWindow(sentence);
  const cwd = process.cwd();
  let resolvedDest = dest ? path.resolve(dest) : "";
  let outputTemplate = "";
  let outputDir = "";
  if (dest) {
    let isDir = false;
    try {
      const stats = await fs.stat(resolvedDest);
      isDir = stats.isDirectory();
    } catch {}
    if (isDir || multi) {
      outputDir = resolvedDest;
      outputTemplate = path.join(outputDir, "%(upload_date)s - %(title)s [%(id)s].%(ext)s");
    } else {
      outputDir = path.dirname(resolvedDest);
      outputTemplate = resolvedDest;
    }
  } else {
    outputDir = cwd;
    outputTemplate = path.join(outputDir, "%(upload_date)s - %(title)s [%(id)s].%(ext)s");
  }
  await fs.mkdir(outputDir, { recursive: true });

  const mock = process.env.PYA_DOWNLOAD_RESPONSE;
  if (mock !== undefined) {
    const mockTarget = outputTemplate.includes("%(")
      ? path.join(outputDir, "download.mock")
      : outputTemplate;
    await fs.writeFile(mockTarget, String(mock ?? ""), "utf8");
    return { ob: { filename: outputTemplate.includes("%(") ? outputDir : mockTarget }, be: "download" };
  }

  const extraArgs = resolveExtraArgs(sentence, { rememberFn });
  const { status, stderr } = await runYtDlp({
    url,
    outputPath: outputTemplate,
    intent,
    extraArgs,
    multi,
    monthWindow
  });
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
  if (!outputTemplate.includes("%(")) {
    await recordDownloadArtifact(outputTemplate);
  }
  return { ob: { filename: outputTemplate.includes("%(") ? outputDir : outputTemplate }, be: "download" };
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
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "with", "text", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "with", "text", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "with", "text", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "with", "text", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
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
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "with", "text", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "with", "text", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "with", "text", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "with", "text", "to", "name", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "http"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "web", "from", "filename", "fromstate", "name", "https"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "web", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "http"], handler: (s, ctx) => download_http(s, { scheme: "http", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "file", "from", "filename", "fromstate", "name", "https"], handler: (s, ctx) => download_http(s, { scheme: "https", intent: "file", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "with", "text"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "with", "text"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "with", "text"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "with", "text"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "http", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "from", "filename", "fromstate", "name", "https", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "http", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "from", "filename", "fromstate", "name", "https", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "during", "month", "from", "filename", "fromstate", "name", "http", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "during", "month", "from", "filename", "fromstate", "name", "https", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "during", "month", "from", "filename", "fromstate", "name", "http", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "during", "month", "from", "filename", "fromstate", "name", "https", "ob", "wo"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "during", "month", "from", "filename", "fromstate", "name", "http", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "audio", "during", "month", "from", "filename", "fromstate", "name", "https", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "audio", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "during", "month", "from", "filename", "fromstate", "name", "http", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "http", intent: "video", ...ctx }) },
  { signatureWords: ["be", "download", "as", "wo", "video", "during", "month", "from", "filename", "fromstate", "name", "https", "ob", "wo", "to", "filename"], handler: (s, ctx) => download_ytdlp(s, { scheme: "https", intent: "video", ...ctx }) }
];
