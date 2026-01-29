import fs from "node:fs";
import dns from "node:dns";
import { spawn, spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = argv.slice(2);
  const stream = args.includes("--stream");
  const payloadIndex = args.indexOf("--payload");
  const payloadFileIndex = args.indexOf("--payload-file");
  const payload = payloadIndex !== -1 ? args[payloadIndex + 1] ?? "" : null;
  const payloadFile = payloadFileIndex !== -1 ? args[payloadFileIndex + 1] ?? "" : null;
  return { stream, payload, payloadFile };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function resolveHost(payload) {
  return payload?.host || process.env.OLLAMA_HOST || "http://localhost:11434";
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

function runCurl(endpoint, body, { stream } = {}) {
  const args = ["-sS", "-X", "POST", endpoint, "-H", "Content-Type: application/json"];
  if (stream) args.push("--no-buffer");
  args.push("-d", "@-");
  if (stream) {
    const proc = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin.end(JSON.stringify(body));
    return proc;
  }
  const proc = spawnSync("curl", args, { input: JSON.stringify(body), encoding: "utf8" });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const errText = String(proc.stderr || "").trim();
    throw new Error(`ollama curl failed: ${errText || `status=${proc.status}`}`);
  }
  return String(proc.stdout ?? "");
}

async function requestJson(endpoint, body) {
  let res;
  const payload = JSON.stringify(body);
  const controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 3000);
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
        try {
          const text = runCurl(endpoint, body, { stream: false });
          return parseOllamaResponseText(text, endpoint);
        } catch (curlErr) {
          throw new Error(`ollama fetch failed: ${endpoint} (${curlErr?.message ?? retryErr})`);
        }
      }
    } else {
      try {
        const text = runCurl(endpoint, body, { stream: false });
        return parseOllamaResponseText(text, endpoint);
      } catch (curlErr) {
        throw new Error(`ollama fetch failed: ${endpoint} (${curlErr?.message ?? err})`);
      }
    }
  }
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""} (${endpoint})`.trim());
  }
  const text = await res.text();
  return parseOllamaResponseText(text, endpoint);
}

async function requestStream(endpoint, body) {
  let res;
  const payload = JSON.stringify(body);
  const controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 3000);
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
        const proc = runCurl(endpoint, body, { stream: true });
        return streamFromProcess(proc);
      }
    } else {
      const proc = runCurl(endpoint, body, { stream: true });
      return streamFromProcess(proc);
    }
  }
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""} (${endpoint})`.trim());
  }
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      const payload = JSON.parse(part);
      if (payload.error) {
        throw new Error(`ollama request error: ${payload.error}`);
      }
      const textChunk = payload.response ?? payload.message?.content ?? "";
      if (textChunk) {
        process.stdout.write(`${JSON.stringify(String(textChunk))}\n`);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const payload = JSON.parse(buffer);
    if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
    const textChunk = payload.response ?? payload.message?.content ?? "";
    if (textChunk) {
      process.stdout.write(`${JSON.stringify(String(textChunk))}\n`);
    }
  }
  process.stdout.write("[STREAM_END]\n");
}

function streamFromProcess(proc) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        try {
          const payload = JSON.parse(part);
          if (payload.error) {
            reject(new Error(`ollama request error: ${payload.error}`));
            return;
          }
          const textChunk = payload.response ?? payload.message?.content ?? "";
          if (textChunk) {
            process.stdout.write(`${JSON.stringify(String(textChunk))}\n`);
          }
        } catch {
          // ignore malformed chunk lines
        }
      }
    });
    proc.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) reject(new Error(message));
    });
    proc.on("error", reject);
    proc.on("close", (status) => {
      if (status && status !== 0) {
        reject(new Error(`ollama curl failed: status=${status}`));
        return;
      }
      if (buffer.trim()) {
        try {
          const payload = JSON.parse(buffer);
          if (payload.error) {
            reject(new Error(`ollama request error: ${payload.error}`));
            return;
          }
          const textChunk = payload.response ?? payload.message?.content ?? "";
          if (textChunk) {
            process.stdout.write(`${JSON.stringify(String(textChunk))}\n`);
          }
        } catch {
          // ignore trailing partial
        }
      }
      process.stdout.write("[STREAM_END]\n");
      resolve();
    });
  });
}

function parseOllamaResponseText(text, endpoint) {
  try {
    return JSON.parse(text);
  } catch {
    const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      throw new Error(`ollama request failed: empty response (${endpoint})`);
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
      throw new Error(`ollama request failed: unparseable response (${endpoint})`);
    }
    return { response: combined };
  }
}

async function runGenerate(payload) {
  const base = resolveHost(payload);
  const endpoint = `${base.replace(/\/$/, "")}/api/generate`;
  const body = { model: payload.model, prompt: payload.prompt, stream: !!payload.stream };
  if (payload.keep_alive !== undefined) body.keep_alive = payload.keep_alive;
  if (payload.stream) {
    await requestStream(endpoint, body);
    return null;
  }
  return requestJson(endpoint, body);
}

async function runChat(payload) {
  const base = resolveHost(payload);
  const endpoint = `${base.replace(/\/$/, "")}/api/chat`;
  const body = { model: payload.model, messages: payload.messages, stream: !!payload.stream };
  if (Array.isArray(payload.tools) && payload.tools.length > 0) body.tools = payload.tools;
  if (payload.keep_alive !== undefined) body.keep_alive = payload.keep_alive;
  if (payload.stream) {
    await requestStream(endpoint, body);
    return null;
  }
  return requestJson(endpoint, body);
}

async function main() {
  dns.setDefaultResultOrder("ipv4first");
  const args = parseArgs(process.argv);
  let stdin = await readStdin();
  if ((!stdin || !stdin.trim()) && args.payloadFile) {
    stdin = fs.readFileSync(args.payloadFile, "utf8");
  }
  if ((!stdin || !stdin.trim()) && args.payload) {
    stdin = args.payload;
  }
  if (!stdin || !stdin.trim()) {
    throw new Error("mind_ollama_runner: missing request payload");
  }
  let payload = null;
  try {
    payload = JSON.parse(stdin);
  } catch (err) {
    throw new Error(`mind_ollama_runner: invalid JSON payload (${err?.message ?? err})`);
  }
  if (payload.stream === undefined) payload.stream = false;
  if (args.stream && !payload.stream) payload.stream = true;
  const mode = payload?.mode ?? "generate";
  const response = mode === "chat"
    ? await runChat(payload)
    : await runGenerate(payload);
  if (payload?.stream) return;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main().catch(err => {
  const message = err?.message ?? String(err ?? "unknown error");
  if (message) fs.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
