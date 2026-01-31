import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { throwErrorSentence } from "../../error.mjs";

class McpClient {
  constructor({ command, args, serverName, onExit }) {
    this.serverName = serverName;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.onExit = typeof onExit === "function" ? onExit : null;
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", (code, signal) => {
      if (this.onExit) this.onExit({ code, signal, serverName });
      const err = new Error(`mcp server exited: ${serverName} status=${code ?? 0} signal=${signal ?? ""}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  sendNotification(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  onData(chunk) {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message?.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message?.error) reject(new Error(message.error?.message ?? "mcp response error"));
        else resolve(message?.result);
      }
    }
  }
}

class InlineMcpClient {
  constructor({ tools }) {
    this.tools = tools;
  }

  async send(method, params) {
    if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
    if (method === "tools/list") return { tools: this.tools };
    if (method === "tools/call") {
      const toolName = params?.name;
      const tool = this.tools.find(entry => entry?.name === toolName);
      if (tool && Object.prototype.hasOwnProperty.call(tool, "mockResult")) {
        const result = tool.mockResult;
        const delay = Number(tool.mockDelayMs ?? 0);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return result;
      }
      const args = params?.arguments ?? {};
      if (args?.ob !== undefined) return args.ob;
      return args;
    }
    return { ok: true };
  }

  sendNotification() {}
}

async function* readStreamChunks(stream) {
  if (!stream) return;
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (typeof stream[Symbol.asyncIterator] === "function") {
    for await (const chunk of stream) yield chunk;
  }
}

async function* parseSseStream(stream) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event = null;
  let id = null;
  let data = [];
  const normalizeFieldValue = (raw) => {
    if (!raw) return "";
    return raw.startsWith(" ") ? raw.slice(1) : raw;
  };
  const flushEvent = () => {
    if (!data.length && !event && !id) return null;
    const payload = { event, id, data: data.join("\n") };
    event = null;
    id = null;
    data = [];
    return payload;
  };
  for await (const chunk of readStreamChunks(stream)) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        const payload = flushEvent();
        if (payload) yield payload;
        continue;
      }
      if (line.startsWith("event:")) {
        event = normalizeFieldValue(line.slice(6));
        continue;
      }
      if (line.startsWith("id:")) {
        id = normalizeFieldValue(line.slice(3));
        continue;
      }
      if (line.startsWith("data:")) {
        data.push(normalizeFieldValue(line.slice(5)));
        continue;
      }
    }
  }
  const payload = flushEvent();
  if (payload) yield payload;
}

class HttpMcpClient {
  constructor({ endpoint, headers, protocolVersion = "2025-06-18", transport = "http" }) {
    this.endpoint = endpoint;
    this.headers = headers ?? {};
    this.protocolVersion = protocolVersion;
    this.transport = transport;
    this.sessionId = null;
    this.nextId = 1;
  }

  async send(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const response = await this.postJsonRpc(payload, { expectResponse: true });
    if (response?.json) {
      if (response.json?.error) throw new Error(response.json.error?.message ?? "mcp response error");
      return response.json?.result ?? response.json;
    }
    return response;
  }

  async sendNotification(method, params) {
    const payload = { jsonrpc: "2.0", method, params };
    await this.postJsonRpc(payload, { expectResponse: false });
  }

  async postJsonRpc(payload, { expectResponse }) {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": this.protocolVersion,
      ...this.headers
    });
    if (this.sessionId) headers.set("Mcp-Session-Id", this.sessionId);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (response.status === 202 && !expectResponse) return { status: 202 };

    if (!response.ok) {
      const isInit = payload?.method === "initialize";
      const shouldFallback = isInit && response.status >= 400 && response.status < 500;
      const fallback = shouldFallback ? await this.tryLegacyTransport({ payload }) : null;
      if (fallback) return fallback;
      throw new Error(`mcp http error: ${response.status}`);
    }

    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) this.sessionId = sessionHeader;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      return { json, response };
    }
    if (contentType.includes("text/event-stream")) {
      const json = await this.consumeSseResponse({ stream: response.body, id: payload.id });
      return { json, response };
    }
    if (expectResponse) {
      throw new Error("mcp http error: unsupported response");
    }
    return { status: response.status };
  }

  async consumeSseResponse({ stream, id }) {
    for await (const event of parseSseStream(stream)) {
      if (!event?.data) continue;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (message?.id !== undefined && message.id === id) return message;
    }
    throw new Error("mcp http error: missing response");
  }

  async tryLegacyTransport({ payload }) {
    const response = await this.getLegacyEndpoint();
    if (!response) return null;
    this.endpoint = response;
    const retry = await this.postJsonRpc(payload, { expectResponse: true });
    return retry;
  }

  async getLegacyEndpoint() {
    const headers = new Headers({
      Accept: "text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
      ...this.headers
    });
    if (this.sessionId) headers.set("Mcp-Session-Id", this.sessionId);

    const response = await fetch(this.endpoint, { method: "GET", headers });
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("text/event-stream")) return null;
    for await (const event of parseSseStream(response.body)) {
      if (event?.event === "endpoint" && event.data) {
        const endpoint = String(event.data).trim();
        if (response.body?.cancel) {
          try {
            await response.body.cancel();
          } catch {}
        }
        return endpoint;
      }
    }
    return null;
  }
}

async function buildInlineClient(args) {
  const [configPath] = Array.isArray(args) ? args : [];
  if (!configPath) {
    throwErrorSentence({
      name: "mcp config defective",
      message: "mcp config defective: inline requires a config path",
      from: { name: "mcp" }
    });
  }
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  const tools = Array.isArray(parsed?.tools) ? parsed.tools : [];
  return new InlineMcpClient({ tools });
}

export {
  McpClient,
  InlineMcpClient,
  HttpMcpClient,
  buildInlineClient,
  parseSseStream
};
