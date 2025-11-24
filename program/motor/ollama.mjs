// pyash/engines/ollama.mjs
// Streams responses from an Ollama HTTP server instead of spawning a local binary.

async function generate(model, prompt) {
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

  if (!res.body) return output;

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
      output += payload.response ?? "";
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const payload = JSON.parse(buffer);
    if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
    output += payload.response ?? "";
  }

  return output.trim();
}

export default { generate };
