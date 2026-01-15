import fs from "node:fs";

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

async function runGenerate(payload) {
  const base = resolveHost(payload);
  const endpoint = `${base.replace(/\/$/, "")}/api/generate`;
  const body = { model: payload.model, prompt: payload.prompt, stream: false };
  return requestJson(endpoint, body);
}

async function runChat(payload) {
  const base = resolveHost(payload);
  const endpoint = `${base.replace(/\/$/, "")}/api/chat`;
  const body = { model: payload.model, messages: payload.messages, stream: false };
  if (Array.isArray(payload.tools) && payload.tools.length > 0) body.tools = payload.tools;
  return requestJson(endpoint, body);
}

async function main() {
  const stdin = await readStdin();
  if (!stdin.trim()) {
    throw new Error("mind_ollama_runner: missing request payload");
  }
  let payload = null;
  try {
    payload = JSON.parse(stdin);
  } catch (err) {
    throw new Error(`mind_ollama_runner: invalid JSON payload (${err?.message ?? err})`);
  }
  const mode = payload?.mode ?? "generate";
  const response = mode === "chat"
    ? await runChat(payload)
    : await runGenerate(payload);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main().catch(err => {
  const message = err?.message ?? String(err ?? "unknown error");
  if (message) fs.writeFileSync(2, `${message}\n`, "utf8");
  process.exit(1);
});
