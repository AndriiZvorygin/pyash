import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { resolveAgentCwd, resolveAgentPath } from "../../library/agent_cwd.mjs";
import { resolveConfigMapText } from "../../configure/env.mjs";
import { resolveUrl, resolveOutput, resolveExtraArgs, parseMonthWindow, isMultiDownload } from "./helpers.mjs";
import { missingBackend, recordDownloadArtifact, runCurl, runYtDlp } from "./runners.mjs";

function resolveWorldRoot({ rememberFn = remember } = {}) {
  const root = rememberFn("world root")?.ob?.filename;
  if (root) return path.resolve(String(root));
  return path.resolve("world");
}

function resolveFreshCacheRoot({ rememberFn = remember } = {}) {
  const configured = resolveConfigMapText("library configure", "fresh root", { rememberFn });
  if (configured) return path.resolve(String(configured));
  return path.join(resolveWorldRoot({ rememberFn }), "library", "fresh");
}

function isNoCache(sentence, { rememberFn = remember } = {}) {
  const marker = sentence?.with?.wo
    ?? sentence?.with?.text
    ?? sentence?.with?.name
    ?? sentence?.accordingto?.wo
    ?? sentence?.accordingto?.text
    ?? sentence?.accordingto?.name
    ?? "";
  if (String(marker).trim().toLowerCase() === "no cache") return true;
  const fact = rememberFn("download no cache");
  return fact?.ob?.boolean === true || String(fact?.ob?.text ?? "").toLowerCase() === "truth";
}

function cacheKey({ url, intent, scheme }) {
  const text = `${String(scheme ?? "")}|${String(intent ?? "")}|${String(url ?? "")}`;
  return crypto.createHash("sha256").update(text).digest("hex");
}

function dayStamp(now = new Date()) {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
}

function defaultArtifactDirectory(agentCwd) {
  return path.resolve(agentCwd ?? process.cwd(), "artifacts", dayStamp());
}

function inferHttpOutputFilename(url) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname || "");
    if (base && base !== "/") return base;
  } catch {
    // keep deterministic fallback for malformed URL text
  }
  return "download.bin";
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function looksLikeEscribePlayerUrl(urlText = "") {
  if (!urlText) return false;
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return false;
  }
  const host = String(parsed.hostname || "").toLowerCase();
  const path = String(parsed.pathname || "").toLowerCase();
  return host.endsWith("escribemeetings.com") && path.includes("/players/isistandaloneplayer.aspx");
}

function maybeDecodeUriComponent(text = "") {
  try {
    return decodeURIComponent(String(text));
  } catch {
    return String(text);
  }
}

async function resolveEscribePlayerMediaUrl(urlText) {
  const tmpLeaf = `escribe-player-${Date.now()}-${Math.random().toString(36).slice(2)}.html`;
  const tmpPath = path.join(os.tmpdir(), tmpLeaf);
  const { status } = await runCurl({ url: urlText, outputPath: tmpPath });
  if (status !== 0) return "";
  const html = await fs.readFile(tmpPath, "utf8").catch(() => "");
  await fs.unlink(tmpPath).catch(() => {});
  if (!html) return "";
  const clientMatch = html.match(/data-client_id=(["'])(.*?)\1/i);
  const fileMatch = html.match(/data-file_name=(["'])(.*?)\1/i);
  if (!clientMatch || !fileMatch) return "";
  const clientIdRaw = decodeHtmlEntities(clientMatch[2]).trim();
  const fileNameRaw = decodeHtmlEntities(fileMatch[2]).trim();
  if (!clientIdRaw || !fileNameRaw) return "";
  const clientId = encodeURIComponent(maybeDecodeUriComponent(clientIdRaw));
  const fileName = encodeURIComponent(maybeDecodeUriComponent(fileNameRaw));
  return `https://video.isilive.ca/${clientId}/${fileName}`;
}

export async function download_http(sentence, { scheme, intent, remember: rememberFn = remember } = {}) {
  const url = resolveUrl(sentence, { rememberFn });
  const dest = resolveOutput(sentence, { rememberFn });
  const noCache = isNoCache(sentence, { rememberFn });
  const cacheRoot = resolveFreshCacheRoot({ rememberFn });
  const key = cacheKey({ url, intent, scheme });
  const cachePath = path.join(cacheRoot, `${key}.bin`);
  const agentCwd = resolveAgentCwd({ rememberFn });
  if (!url) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing source url",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  const resolvedDest = dest
    ? (() => {
      const { resolved, outside, agentCwd: cwd } = resolveAgentPath(dest, { rememberFn });
      if (outside) {
        throwErrorSentence({
          name: "download defective",
          message: `download defective: outside agent cwd (${cwd})`,
          from: { name: "download" },
          raw: { dest }
        });
      }
      return resolved;
    })()
    : (() => {
      const outputDir = defaultArtifactDirectory(agentCwd);
      return path.join(outputDir, inferHttpOutputFilename(url));
    })();
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });

  const mock = process.env.PYA_DOWNLOAD_RESPONSE;
  if (mock !== undefined) {
    await fs.writeFile(resolvedDest, String(mock ?? ""), "utf8");
    await fs.writeFile(cachePath, String(mock ?? ""), "utf8");
    return { ob: { filename: resolvedDest }, be: "download" };
  }

  if (!noCache) {
    try {
      await fs.access(cachePath);
      if (resolvedDest !== cachePath) {
        await fs.copyFile(cachePath, resolvedDest);
      }
      await recordDownloadArtifact(resolvedDest);
      return { ob: { filename: resolvedDest }, be: "download" };
    } catch {}
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
  if (resolvedDest !== cachePath) {
    await fs.copyFile(resolvedDest, cachePath);
  }
  await recordDownloadArtifact(resolvedDest);
  return { ob: { filename: resolvedDest }, be: "download" };
}

export async function download_ytdlp(sentence, { scheme, intent, remember: rememberFn = remember } = {}) {
  const url = resolveUrl(sentence, { rememberFn });
  const dest = resolveOutput(sentence, { rememberFn });
  const agentCwd = resolveAgentCwd({ rememberFn });
  if (!url) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing source url",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  let mediaUrl = url;
  if (intent === "audio" && looksLikeEscribePlayerUrl(url)) {
    try {
      const resolvedMedia = await resolveEscribePlayerMediaUrl(url);
      if (resolvedMedia) mediaUrl = resolvedMedia;
    } catch {
      // fall through to original URL; downstream error remains deterministic if unresolved
    }
  }
  const multi = isMultiDownload(sentence);
  const monthWindow = parseMonthWindow(sentence);
  const cwd = process.cwd();
  let resolvedDest = "";
  if (dest) {
    const { resolved, outside, agentCwd: cwd } = resolveAgentPath(dest, { rememberFn });
    if (outside) {
      throwErrorSentence({
        name: "download defective",
        message: `download defective: outside agent cwd (${cwd})`,
        from: { name: "download" },
        raw: { dest }
      });
    }
    resolvedDest = resolved;
  }
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
    outputDir = defaultArtifactDirectory(agentCwd ?? cwd);
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
    url: mediaUrl,
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
      raw: { url: mediaUrl, scheme, intent }
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

export {
  looksLikeEscribePlayerUrl,
  resolveEscribePlayerMediaUrl
};
