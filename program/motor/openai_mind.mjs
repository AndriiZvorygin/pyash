import fs from "node:fs/promises";

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function resolveHost(payload = {}) {
  return String(payload.host || process.env.AI_HOST || process.env.OPENAI_HOST || "https://api.openai.com").trim();
}

function normalizeHost(host) {
  const raw = String(host || "").trim();
  if (!raw) return "https://api.openai.com";
  return raw.replace(/\/$/, "");
}

function resolveApiKey({ host, payload = {} } = {}) {
  const explicit = String(payload.apiKey || "").trim();
  if (explicit) return explicit;
  const normalizedHost = String(host || "").toLowerCase();
  const openRouter = normalizedHost.includes("openrouter.ai");
  if (openRouter) {
    const routerKey = String(process.env.OPENROUTER_API_KEY || "").trim();
    if (routerKey) return routerKey;
  }
  const openAiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (openAiKey) return openAiKey;
  const generic = String(process.env.AI_API_KEY || "").trim();
  if (generic) return generic;
  return "";
}

function toDataUrl({ mimeType, base64 }) {
  const safeMime = String(mimeType || "image/png").trim() || "image/png";
  return `data:${safeMime};base64,${base64}`;
}

async function imagePartFromFile(entry = {}) {
  const filename = String(entry.filename || "").trim();
  if (!filename) return null;
  const mimeType = String(entry.mimeType || "image/png").trim() || "image/png";
  const bytes = await fs.readFile(filename);
  return {
    type: "image_url",
    image_url: { url: toDataUrl({ mimeType, base64: bytes.toString("base64") }) }
  };
}

function normalizeContentParts(content) {
  if (Array.isArray(content)) return content;
  const text = asText(content);
  if (!text) return [];
  return [{ type: "text", text }];
}

async function normalizeMessage(message = {}) {
  const role = String(message.role || "user").trim() || "user";
  const out = { role };

  const toolCallId = asText(message.tool_call_id);
  if (toolCallId) out.tool_call_id = toolCallId;

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    out.tool_calls = message.tool_calls.map((item) => {
      const id = asText(item?.id);
      const name = asText(item?.function?.name || item?.name);
      const argsRaw = item?.function?.arguments ?? item?.arguments ?? "{}";
      const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw || {});
      return {
        id,
        type: "function",
        function: {
          name,
          arguments: args
        }
      };
    });
  }

  const imageFiles = Array.isArray(message.imageFiles) ? message.imageFiles : [];
  if (imageFiles.length > 0) {
    const parts = normalizeContentParts(message.content);
    for (const entry of imageFiles) {
      const part = await imagePartFromFile(entry);
      if (part) parts.push(part);
    }
    out.content = parts;
  } else {
    out.content = message.content ?? "";
  }
  return out;
}

async function buildMessages(payload = {}) {
  const mode = String(payload.mode || "chat").toLowerCase();
  if (mode === "generate") {
    return [{ role: "user", content: asText(payload.prompt) }];
  }
  const input = Array.isArray(payload.messages) ? payload.messages : [];
  const out = [];
  for (const message of input) {
    out.push(await normalizeMessage(message || {}));
  }
  if (out.length === 0) {
    out.push({ role: "user", content: asText(payload.prompt) });
  }
  return out;
}

async function buildChatCompletionsRequest(payload = {}) {
  const body = {
    model: asText(payload.model),
    messages: await buildMessages(payload),
    stream: Boolean(payload.stream)
  };
  if (Array.isArray(payload.tools) && payload.tools.length > 0) body.tools = payload.tools;
  const reasoningEffort = asText(payload.reasoningEffort);
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (Number.isFinite(Number(payload.temperature))) body.temperature = Number(payload.temperature);
  if (Number.isFinite(Number(payload.topP))) body.top_p = Number(payload.topP);
  if (Number.isFinite(Number(payload.presencePenalty))) body.presence_penalty = Number(payload.presencePenalty);
  return body;
}

function parseMessageContent(message = {}) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => asText(part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((item) => ({
    id: asText(item?.id),
    type: "function",
    function: {
      name: asText(item?.function?.name),
      arguments: typeof item?.function?.arguments === "string"
        ? item.function.arguments
        : JSON.stringify(item?.function?.arguments || {})
    }
  }));
}

function parseChatCompletionsResponse(payload = {}) {
  const message = payload?.choices?.[0]?.message ?? {};
  const content = parseMessageContent(message);
  const toolCalls = normalizeToolCalls(message.tool_calls);
  const outMessage = { content };
  if (toolCalls.length > 0) outMessage.tool_calls = toolCalls;
  return {
    response: content,
    message: outMessage,
    usage: payload?.usage ?? null
  };
}

async function requestJson({ host, apiKey, body }) {
  const endpoint = `${normalizeHost(host)}/v1/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const code = asText(parsed?.error?.code);
    const msg = asText(parsed?.error?.message || res.statusText || "request failed");
    throw new Error(`openai request failed: status=${res.status}${code ? ` code=${code}` : ""} error=${msg}`);
  }
  return parseChatCompletionsResponse(parsed);
}

async function requestStream({ host, apiKey, body, onChunk }) {
  const endpoint = `${normalizeHost(host)}/v1/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    const code = asText(parsed?.error?.code);
    const msg = asText(parsed?.error?.message || res.statusText || "request failed");
    throw new Error(`openai request failed: status=${res.status}${code ? ` code=${code}` : ""} error=${msg}`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const rawChunk of res.body) {
    buffer += decoder.decode(rawChunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const lineRaw of lines) {
      const line = String(lineRaw || "").trim();
      if (!line || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = payload?.choices?.[0]?.delta ?? {};
      const text = asText(delta?.content);
      if (text && typeof onChunk === "function") onChunk(text);
    }
  }
}

export {
  resolveHost,
  resolveApiKey,
  buildChatCompletionsRequest,
  requestJson,
  requestStream
};
