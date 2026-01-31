import fs from "node:fs/promises";
import path from "node:path";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { resolveUrl, resolveOutput, resolveExtraArgs, parseMonthWindow, isMultiDownload } from "./helpers.mjs";
import { missingBackend, recordDownloadArtifact, runCurl, runYtDlp } from "./runners.mjs";

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
