import fs from "node:fs";

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

async function requestJson(endpoint, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""}`.trim());
  }
  return res.json();
}

async function requestStream(endpoint, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""}`.trim());
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
