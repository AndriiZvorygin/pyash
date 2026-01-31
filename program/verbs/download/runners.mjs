import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { formatMonthWindow } from "./helpers.mjs";

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

export { missingBackend, recordDownloadArtifact, runCurl, runYtDlp };
