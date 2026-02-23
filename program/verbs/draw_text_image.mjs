import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { recordArtifact } from "../bridge/exchange.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { getExchangeRunId } from "../bridge/exchange.mjs";

function resolvePromptPart(value, { rememberFn = remember } = {}) {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.name === "string") {
    const fact = rememberFn(value.name);
    return String(fact?.ob?.text ?? "");
  }
  return "";
}

function combinePrompt({ systemPrompt = "", userPrompt = "" } = {}) {
  const system = String(systemPrompt ?? "").trim();
  const user = String(userPrompt ?? "").trim();
  if (system && user) return `${system}\n\n${user}`;
  return system || user;
}

function resolveWorkflowName(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.as?.text === "string" && sentence.as.text.trim()) return sentence.as.text.trim();
  return resolveConfigText("draw workflow default", { rememberFn }) || "Z-Image-TSV";
}

function resolveHost({ rememberFn = remember } = {}) {
  return resolveConfigText("draw host", { rememberFn }) || "http://localhost:8188";
}

function defaultOutputPath() {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
    return path.join("artifacts", runId, `draw-${stamp}-${rand}.png`);
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return path.join("artifacts", "draw", `draw-${stamp}-${rand}.png`);
}

function resolveNumericFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const direct = Number(entry?.num);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const obNum = Number(entry?.ob?.num);
  if (Number.isFinite(obNum) && obNum > 0) return Math.floor(obNum);
  return null;
}

function resolveTextFromMapEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry?.text === "string") return entry.text;
  if (typeof entry?.ob?.text === "string") return entry.ob.text;
  return "";
}

function resolveDrawSizeFromMap(sentence, { rememberFn = remember } = {}) {
  const withName = String(sentence?.with?.name ?? "").trim();
  if (!withName) return { width: null, height: null, negativePrompt: "" };
  const fact = rememberFn?.(withName);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") {
    throwErrorSentence({
      name: "draw defective",
      message: "draw defective: with name map missing",
      from: { name: "draw" },
      raw: { withName }
    });
  }
  const width = resolveNumericFromMapEntry(map.width);
  const height = resolveNumericFromMapEntry(map.height);
  const negativePrompt = resolveTextFromMapEntry(map["negative prompt"]) || resolveTextFromMapEntry(map.negativePrompt);
  return { width, height, negativePrompt };
}

async function runDraw({ prompt, workflowName, host, output, width = null, height = null, negativePrompt = "" }) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/draw_comfyui_runner.mjs");
  const args = [runner, "--prompt", prompt, "--workflow-name", workflowName, "--host", host, "--output", output];
  if (Number.isFinite(width) && width > 0) args.push("--width", String(Math.floor(width)));
  if (Number.isFinite(height) && height > 0) args.push("--height", String(Math.floor(height)));
  if (typeof negativePrompt === "string" && negativePrompt.trim()) {
    args.push("--negative-prompt", negativePrompt.trim());
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim() });
      else reject(new Error(stderr.trim() || `draw defective: status=${code}`));
    });
  });
}

export async function drawTextImage(sentence, { remember: rememberFn = remember } = {}) {
  await enforceAutoDischarge({ activatingClass: "draw", rememberFn });
  const systemPrompt = resolvePromptPart(sentence?.fromtext, { rememberFn });
  const userPrompt = resolvePromptPart(sentence?.ob, { rememberFn });
  const prompt = combinePrompt({ systemPrompt, userPrompt });
  if (!prompt.trim()) {
    throwErrorSentence({
      name: "draw defective",
      message: "draw defective: missing prompt",
      from: { name: "draw" },
      raw: { sentence }
    });
  }
  const workflowName = resolveWorkflowName(sentence, { rememberFn });
  const host = resolveHost({ rememberFn });
  const output = String(sentence?.to?.filename ?? "").trim() || defaultOutputPath();
  const { width, height, negativePrompt } = resolveDrawSizeFromMap(sentence, { rememberFn });
  await runDraw({ prompt, workflowName, host, output, width, height, negativePrompt });
  const bytes = await fs.readFile(path.resolve(output));
  recordArtifact({ locator: output, producer: "draw", bytes, kind: "image" });
  if (sentence?.to?.filename) return { ob: { filename: output }, be: "draw" };
  return { result: { text: output }, ob: { text: output }, be: "draw" };
}

export const signatures = [
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: drawTextImage },

  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "image", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text"], handler: drawTextImage },
  { signatureWords: ["be", "draw", "as", "text", "become", "wo", "photograph", "fromstate", "wo", "text", "fromtext", "text", "ob", "name", "text", "with", "name", "map"], handler: drawTextImage }
];

export default drawTextImage;
