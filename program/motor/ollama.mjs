// pyash/engines/ollama.mjs
// Streams responses from an Ollama HTTP server instead of spawning a local binary.

async function generateStream({ model, prompt }) {
  const base = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const endpoint = `${base.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true })
  });

  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""}`.trim());
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  const chunks = [];
  const payloads = [];

  if (!res.body) return { text: output, chunks, payloads };

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
      payloads.push(payload);
      if (payload.response) chunks.push(payload.response);
      output += payload.response ?? "";
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const payload = JSON.parse(buffer);
    if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
    payloads.push(payload);
    if (payload.response) chunks.push(payload.response);
    output += payload.response ?? "";
  }

  return { text: output.trim(), chunks, payloads };
}

async function generate(model, prompt) {
  const { text } = await generateStream({ model, prompt });
  return text;
}

async function chat({ model, messages, tools = [], stream = false }) {
  const base = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const endpoint = `${base.replace(/\/$/, "")}/api/chat`;
  const body = { model, messages, stream: !!stream };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`ollama request failed: ${res.status} ${res.statusText ?? ""}`.trim());
  }

  if (stream) {
    const decoder = new TextDecoder();
    let buffer = "";
    let final = null;
    if (!res.body) return final;
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        const payload = JSON.parse(part);
        if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
        final = payload;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const payload = JSON.parse(buffer);
      if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
      final = payload;
    }
    return final;
  }

  return res.json();
}

export default { generate, chat };
export { generateStream, chat };
