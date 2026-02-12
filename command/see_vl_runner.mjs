import dns from "node:dns";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { attachImagesToMessages } from "./ollama_image_payload.mjs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    promptFile: null,
    promptText: null,
    promptStdin: false,
    images: [],
    model: null,
    host: null,
    maxTokens: null,
    fixtureText: null,
    fixtureFile: null
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--prompt-file":
        parsed.promptFile = args[i + 1] ?? null;
        i += 1;
        break;
      case "--prompt":
        parsed.promptText = args[i + 1] ?? null;
        i += 1;
        break;
      case "--prompt-stdin":
        parsed.promptStdin = true;
        break;
      case "--image":
        if (args[i + 1]) parsed.images.push(args[i + 1]);
        i += 1;
        break;
      case "--model":
        parsed.model = args[i + 1] ?? null;
        i += 1;
        break;
      case "--host":
        parsed.host = args[i + 1] ?? null;
        i += 1;
        break;
      case "--max-tokens":
        parsed.maxTokens = Number(args[i + 1]);
        i += 1;
        break;
      case "--fixture-text":
        parsed.fixtureText = args[i + 1] ?? null;
        i += 1;
        break;
      case "--fixture-file":
        parsed.fixtureFile = args[i + 1] ?? null;
        i += 1;
        break;
      default:
        break;
    }
  }
  return parsed;
}

function resolveHost(hostOption) {
  return hostOption ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
}

function resolveMimeType(filename) {
  const ext = String(path.extname(filename ?? "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  return "application/octet-stream";
}

async function resolvePrompt(promptFile) {
  if (!promptFile) return null;
  const text = await fs.readFile(promptFile, "utf8");
  return text;
}

async function collectImageParts(images) {
  const openAiParts = [];
  const ollamaImages = [];
  for (const filepath of images) {
    if (!filepath) continue;
    try {
      const bytes = await fs.readFile(filepath);
      const base64 = bytes.toString("base64");
      const mime = resolveMimeType(filepath);
      openAiParts.push({ type: "image_url", image_url: `data:${mime};base64,${base64}` });
      ollamaImages.push(base64);
    } catch (err) {
      throw new Error(`see_vl_runner: cannot read image ${filepath}: ${err?.message ?? err}`);
    }
  }
  return { openAiParts, ollamaImages };
}

function runCurl(endpoint, body) {
  const args = ["-sS", "-X", "POST", endpoint, "-H", "Content-Type: application/json", "-d", "@-"];
  const proc = spawnSync("curl", args, { input: JSON.stringify(body), encoding: "utf8" });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const errText = String(proc.stderr || "").trim();
    throw new Error(`see_vl_runner: curl failed: ${errText || `status=${proc.status}`}`);
  }
  return String(proc.stdout ?? "");
}

function parseOllamaResponseText(text, endpoint) {
  try {
    return JSON.parse(text);
  } catch {
    const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      throw new Error(`see_vl_runner: empty response from ${endpoint}`);
    }
    let combined = "";
    for (const line of lines) {
      try {
        const payload = JSON.parse(line);
        if (payload?.response) combined += payload.response;
        if (payload?.message?.content) combined += payload.message.content;
      } catch {
        // ignore malformed line
      }
    }
    if (!combined) {
      throw new Error(`see_vl_runner: unparseable response from ${endpoint}`);
    }
    return { response: combined };
  }
}

async function resolveIpv4Endpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.hostname !== "host.docker.internal") return null;
    const result = await dns.promises.lookup(url.hostname, { family: 4 });
    if (!result?.address) return null;
    url.hostname = result.address;
    return url.toString();
  } catch {
    return null;
  }
}

async function requestJson(endpoint, body) {
  const payload = JSON.stringify(body);
  const controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 3000);
  let res = null;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    const fallback = await resolveIpv4Endpoint(endpoint);
    if (fallback) {
      try {
        const retryController = new AbortController();
        timeout = setTimeout(() => retryController.abort(), 3000);
        res = await fetch(fallback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: retryController.signal
        });
        clearTimeout(timeout);
      } catch (retryErr) {
        clearTimeout(timeout);
        const text = runCurl(endpoint, body);
        return parseOllamaResponseText(text, endpoint);
      }
    } else {
      const text = runCurl(endpoint, body);
      return parseOllamaResponseText(text, endpoint);
    }
  }
  clearTimeout(timeout);
  if (!res?.ok) {
    const err = new Error(`see_vl_runner: request failed ${res?.status} ${res?.statusText ?? ""} (${endpoint})`.trim());
    err.status = res?.status;
    throw err;
  }
  const text = await res.text();
  return parseOllamaResponseText(text, endpoint);
}

function extractMessageText(response) {
  const choice = response?.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.text) return part.text;
      return "";
    }).join("");
  }
  return typeof choice?.message?.content === "string" ? choice.message.content : "";
}

async function main() {
  dns.setDefaultResultOrder("ipv4first");
  const args = parseArgs(process.argv);
  if (args.fixtureText) {
    fsSync.writeFileSync(1, args.fixtureText, "utf8");
    return;
  }
  if (args.fixtureFile) {
    try {
      const text = await fs.readFile(args.fixtureFile, "utf8");
      fsSync.writeFileSync(1, String(text), "utf8");
      return;
    } catch (err) {
      throw new Error(`see_vl_runner: fixture file missing (${err?.message ?? err})`);
    }
  }
  const fixture = process.env.PYA_SEE_VL_FIXTURE;
  if (fixture !== undefined) {
    fsSync.writeFileSync(1, String(fixture), "utf8");
    return;
  }
  const fixtureFile = process.env.PYA_SEE_VL_FIXTURE_FILE;
  if (fixtureFile) {
    try {
      const text = await fs.readFile(fixtureFile, "utf8");
      fsSync.writeFileSync(1, String(text), "utf8");
      return;
    } catch (err) {
      throw new Error(`see_vl_runner: fixture file missing (${err?.message ?? err})`);
    }
  }
  const prompt =
    args.promptText ??
    (args.promptFile ? await resolvePrompt(args.promptFile) : null) ??
    (args.promptStdin ? fsSync.readFileSync(0, "utf8") : null);
  const effectivePrompt = String(prompt ?? "").trim() || process.env.PYA_SEE_VL_DEFAULT_PROMPT || "Describe the image.";
  if (!Array.isArray(args.images) || args.images.length === 0) {
    throw new Error("see_vl_runner: at least one --image is required");
  }
  const { openAiParts, ollamaImages } = await collectImageParts(args.images);
  if (openAiParts.length === 0 || ollamaImages.length === 0) {
    throw new Error("see_vl_runner: failed to build image parts");
  }
  const host = resolveHost(args.host);
  const openAiEndpoint = `${host.replace(/\/$/, "")}/v1/chat/completions`;
  const openAiBody = {
    model: args.model ?? "qwen3-vl:8b",
    messages: [{ role: "user", content: [{ type: "text", text: effectivePrompt }, ...openAiParts] }],
    max_tokens: Number.isFinite(args.maxTokens) ? args.maxTokens : undefined
  };
  if (!Number.isFinite(openAiBody.max_tokens)) delete openAiBody.max_tokens;

  let response = null;
  let text = "";
  try {
    response = await requestJson(openAiEndpoint, openAiBody);
    text = extractMessageText(response);
  } catch (err) {
    const status = err?.status;
    if (status !== 404 && status !== 405) {
      throw err;
    }
  }

  if (!text) {
    const ollamaEndpoint = `${host.replace(/\/$/, "")}/api/chat`;
    const ollamaMessages = attachImagesToMessages(
      [{ role: "user", content: effectivePrompt }],
      ollamaImages
    );
    const ollamaBody = {
      model: args.model ?? "qwen3-vl:8b",
      messages: ollamaMessages
    };
    response = await requestJson(ollamaEndpoint, ollamaBody);
    text = response?.message?.content ?? response?.response ?? "";
  }

  if (!text) {
    throw new Error("see_vl_runner: empty message content");
  }
  fsSync.writeFileSync(1, text, "utf8");
}

main().catch((err) => {
  const message = err?.message ?? String(err ?? "unknown error");
  if (message) fsSync.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
