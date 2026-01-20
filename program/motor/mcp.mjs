import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { canonicalJsonStringify } from "../verbs/exchange/write_json.mjs";
import { recordArtifact, emitExchangeSentence } from "../bridge/exchange.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

const mcpServers = new Map();
const mcpToolRegistry = new Map();

const TOOL_NON_CASE_FIELDS = new Set([
  "mood",
  "be",
  "su",
  "subj",
  "vyah",
  "exists",
  "signature",
  "signatureWords",
  "ret",
  "this",
  "consequence"
]);

function normalizeServerName(name) {
  return String(name ?? "").trim();
}

function sanitizeServerName(name) {
  return String(name ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "_") || "mcp";
}

function valueToJson(value) {
  if (!value || typeof value !== "object") return value;
  if (value.unspecified) return undefined;
  if (value.hollow) return null;
  if (value.text !== undefined) return value.text;
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.name !== undefined) return value.name;
  if (value.filename !== undefined) return value.filename;
  if (value.ve) {
    const type = value.ve.type || "text";
    const values = Array.isArray(value.ve.values) ? value.ve.values : [];
    if (type === "bool" || type === "boolean") {
      return values.map(v => v === "truth" || v === true || v === 1);
    }
    return values.slice();
  }
  return value;
}

function jsonToOb(value) {
  if (value === null) return { hollow: true };
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { num: value };
  if (typeof value === "boolean") return { boolean: value };
  if (Array.isArray(value)) {
    if (value.length === 0) return { ve: { type: "hollow", values: [] } };
    const types = new Set(value.map(v => typeof v));
    if (types.size === 1 && types.has("number")) {
      return { ve: { type: "num", values: value.slice() } };
    }
    if (types.size === 1 && types.has("boolean")) {
      return { ve: { type: "bool", values: value.map(v => (v ? "truth" : "lie")) } };
    }
    if (types.size === 1 && types.has("string")) {
      return { ve: { type: "text", values: value.slice() } };
    }
    return { text: JSON.stringify(value) };
  }
  if (value && typeof value === "object") {
    return { text: JSON.stringify(value) };
  }
  return { text: String(value ?? "") };
}

function buildToolIdentity({ server, tool }) {
  const record = {
    server,
    name: tool.name ?? "",
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null
  };
  const bytes = canonicalJsonStringify(record);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeTool(raw) {
  const name = String(raw?.name ?? raw?.tool?.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    description: raw?.description ?? raw?.tool?.description ?? "",
    inputSchema: raw?.inputSchema ?? raw?.input_schema ?? raw?.parameters ?? raw?.tool?.inputSchema ?? raw?.tool?.parameters ?? {},
    outputSchema: raw?.outputSchema ?? raw?.output_schema ?? raw?.tool?.outputSchema ?? null
  };
}

class McpClient {
  constructor({ command, args, serverName }) {
    this.serverName = serverName;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", (code, signal) => {
      const err = new Error(`mcp server exited: ${serverName} status=${code ?? 0} signal=${signal ?? ""}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const bytes = Buffer.from(payload, "utf8");
    const header = Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, "utf8");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(Buffer.concat([header, bytes]));
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerText = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = headerText.match(/content-length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);
      let message;
      try {
        message = JSON.parse(body.toString("utf8"));
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
      const args = params?.arguments ?? {};
      if (args?.ob !== undefined) return args.ob;
      return args;
    }
    return { ok: true };
  }
}

function resolveMcpConfig(serverName, { rememberFn = remember } = {}) {
  const key = `mcp ${serverName}`;
  const fact = rememberFn(key);
  if (!fact?.ob) {
    throwErrorSentence({
      name: "mcp config missing",
      message: `mcp config missing: ${serverName}`,
      from: { name: "mcp" },
      raw: { name: key }
    });
  }
  const command = fact.ob.text ?? fact.ob.name ?? fact.ob.filename;
  if (!command) {
    throwErrorSentence({
      name: "mcp config defective",
      message: `mcp config defective: missing command for ${serverName}`,
      from: { name: "mcp" },
      raw: { name: key }
    });
  }
  const args = Array.isArray(fact.by?.ve?.values) ? fact.by.ve.values.map(v => String(v ?? "")) : [];
  return { command: String(command), args };
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

function recordSnapshot({ serverName, tools }) {
  const snapshot = {
    server: serverName,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null,
      toolId: tool.toolId ?? ""
    }))
  };
  const snapshotJson = canonicalJsonStringify(snapshot);
  const snapshotSentence = {
    mood: "ya",
    su: { name: `mcp ${serverName}` },
    be: "tool snapshot",
    ob: { text: snapshotJson }
  };
  const snapshotText = `${sentenceToPyash(snapshotSentence)}\n`;
  recordArtifact({
    locator: `artifacts/mcp/${sanitizeServerName(serverName)}-tools.json`,
    producer: "mcp",
    bytes: Buffer.from(snapshotText, "utf8"),
    kind: "mcp snapshot"
  });
  emitExchangeSentence(snapshotSentence);
}

export async function ensureMcpServer(serverName, { rememberFn = remember, source = "mcp" } = {}) {
  const name = normalizeServerName(serverName);
  if (!name) {
    throwErrorSentence({
      name: "mcp server missing",
      message: "mcp server missing",
      from: { name: source }
    });
  }
  const existing = mcpServers.get(name);
  if (existing?.tools?.length) return existing;

  const config = resolveMcpConfig(name, { rememberFn });
  const client = existing?.client ?? (
    config.command === "inline"
      ? await buildInlineClient(config.args)
      : new McpClient({ command: config.command, args: config.args, serverName: name })
  );

  try {
    await client.send("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  } catch (err) {
    throwErrorSentence({
      name: "mcp defective",
      message: `mcp defective: initialize failed for ${name}`,
      from: { name: source },
      raw: { error: err?.message }
    });
  }

  let response;
  try {
    response = await client.send("tools/list", {});
  } catch (err) {
    throwErrorSentence({
      name: "mcp defective",
      message: `mcp defective: tool discovery failed for ${name}`,
      from: { name: source },
      raw: { error: err?.message }
    });
  }

  const toolList = Array.isArray(response?.tools) ? response.tools : Array.isArray(response) ? response : [];
  const tools = [];
  const toolByName = new Map();
  for (const raw of toolList) {
    const tool = normalizeTool(raw);
    if (!tool) continue;
    tool.toolId = buildToolIdentity({ server: name, tool });
    tools.push(tool);
    toolByName.set(tool.name, tool);
  }
  tools.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const record = {
    serverName: name,
    client,
    tools,
    toolByName
  };
  mcpServers.set(name, record);
  recordSnapshot({ serverName: name, tools });
  return record;
}

export function registerMcpToolAlias({ qualifiedName, serverName, toolName }) {
  if (!qualifiedName || !serverName || !toolName) return;
  mcpToolRegistry.set(qualifiedName, { serverName, toolName });
}

export function lookupMcpTool(verbName) {
  if (!verbName) return null;
  return mcpToolRegistry.get(verbName) ?? null;
}

export async function callMcpTool({ verbName, sentence, rememberFn = remember } = {}) {
  const entry = lookupMcpTool(verbName);
  if (!entry) {
    throwErrorSentence({
      name: "mcp tool missing",
      message: `mcp tool missing: ${verbName}`,
      from: { name: "mcp" }
    });
  }
  const server = await ensureMcpServer(entry.serverName, { rememberFn, source: "mcp" });
  const tool = server.toolByName.get(entry.toolName);
  if (!tool) {
    throwErrorSentence({
      name: "mcp tool missing",
      message: `mcp tool missing: ${entry.toolName}`,
      from: { name: "mcp" }
    });
  }

  const schema = tool.inputSchema ?? {};
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : null;
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const args = {};

  const caseKeys = Object.keys(sentence || {}).filter(k => !TOOL_NON_CASE_FIELDS.has(k));
  const candidateKeys = properties ? Object.keys(properties) : caseKeys;
  for (const key of candidateKeys) {
    const value = sentence?.[key];
    if (value === undefined) {
      if (required.has(key)) {
        throwErrorSentence({
          name: "mcp tool defective",
          message: `mcp tool defective: missing required ${key}`,
          from: { name: entry.toolName }
        });
      }
      continue;
    }
    const jsonValue = valueToJson(value);
    if (jsonValue !== undefined) args[key] = jsonValue;
  }

  let result;
  try {
    result = await server.client.send("tools/call", { name: entry.toolName, arguments: args });
  } catch (err) {
    throwErrorSentence({
      name: "mcp tool defective",
      message: `mcp tool defective: ${entry.toolName}`,
      from: { name: "mcp" },
      raw: { error: err?.message }
    });
  }

  const ob = jsonToOb(result);
  return { ob, be: verbName };
}

export function closeMcpServers() {
  for (const record of mcpServers.values()) {
    try {
      record?.client?.proc?.kill();
    } catch {}
  }
  mcpServers.clear();
  mcpToolRegistry.clear();
}

export function getMcpServerTools(serverName) {
  const record = mcpServers.get(serverName);
  return record?.tools ?? [];
}
