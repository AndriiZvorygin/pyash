import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { buildErrorSentence, throwErrorSentence } from "../error.mjs";
import { canonicalJsonStringify } from "../verbs/exchange/write_json.mjs";
import { recordArtifact, emitExchangeSentence, getExchangeRunRoot, getExchangeStrict } from "../bridge/exchange.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { jsonToMapSentences, jsonToPyashText } from "../verbs/exchange/json_map.mjs";
import { jsonObjectFromPyash } from "../verbs/exchange/write_json.mjs";

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

function resolveMcpAllowlist({ rememberFn = remember } = {}) {
  const fact = rememberFn("mcp allowlist");
  if (!fact?.ob?.ve?.values) return null;
  const values = fact.ob.ve.values.map(v => String(v ?? "")).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function resolveMcpDenylist({ rememberFn = remember } = {}) {
  const fact = rememberFn("mcp denylist");
  if (!fact?.ob?.ve?.values) return null;
  const values = fact.ob.ve.values.map(v => String(v ?? "")).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function collectExistingNames({ allRememberFn }) {
  const used = new Set();
  const entries = typeof allRememberFn === "function" ? allRememberFn() : [];
  for (const entry of entries) {
    if (entry?.su?.name) used.add(entry.su.name);
  }
  return used;
}

function throwMcpError({ name, message, from, raw }) {
  const sentence = buildErrorSentence({ name, message, from, raw });
  emitExchangeSentence(sentence);
  const err = new Error(message || name || "error");
  err.sentence = sentence;
  throw err;
}

function jsonArrayToVector(values, { rootName, doRememberFn, allRememberFn }) {
  if (values.length === 0) {
    return { be: "vector", ob: { ve: { type: "hollow", values: [] } } };
  }
  const typeSet = new Set(values.map((v) => (v === null ? "hollow" : Array.isArray(v) ? "array" : typeof v)));
  if (typeSet.has("object")) {
    const names = [];
    const existingNames = collectExistingNames({ allRememberFn });
    let index = 1;
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const childName = `${rootName} item ${index}`;
      index += 1;
      const { rootName: resolvedRoot, sentences } = jsonToMapSentences(value, childName, { existingNames });
      existingNames.add(resolvedRoot);
      for (const sentence of sentences) doRememberFn(sentence);
      names.push(resolvedRoot);
    }
    return { be: "vector", ob: { ve: { type: "name", values: names } } };
  }
  if (typeSet.has("array") || typeSet.has("hollow") || typeSet.size > 1) {
    return { be: "text", ob: { text: JSON.stringify(values) } };
  }
  if (typeSet.has("boolean")) {
    return { be: "vector", ob: { ve: { type: "bool", values: values.map(v => (v ? "truth" : "lie")) } } };
  }
  if (typeSet.has("number")) {
    return { be: "vector", ob: { ve: { type: "num", values: values.slice() } } };
  }
  return { be: "vector", ob: { ve: { type: "text", values: values.map(v => String(v ?? "")) } } };
}

function validateSchemaValue(value, schema) {
  if (!schema || typeof schema !== "object") return true;
  const type = schema.type;
  if (!type) return true;
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") {
    if (!(typeof value === "number" && Number.isFinite(value))) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  if (type === "integer") {
    if (!(typeof value === "number" && Number.isInteger(value))) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    return true;
  }
  if (type === "object") return value && typeof value === "object" && !Array.isArray(value);
  return true;
}

function validateSchemaArgs(args, schema, { toolName }) {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  if (type && type !== "object") {
    throwErrorSentence({
      name: "mcp tool defective",
      message: `mcp tool defective: ${toolName} expects ${type}`,
      from: { name: "mcp" }
    });
  }
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (args[key] === undefined && propSchema && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
      args[key] = propSchema.default;
    }
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      throwMcpError({
        name: "mcp tool defective",
        message: `mcp tool defective: missing required ${key}`,
        from: { name: "mcp" }
      });
    }
  }
  const additionalAllowed = schema.additionalProperties !== false;
  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties?.[key];
    if (!propSchema) {
      if (!additionalAllowed) {
        throwMcpError({
          name: "mcp tool defective",
          message: `mcp tool defective: additional properties not allowed (${key})`,
          from: { name: "mcp" }
        });
      }
      continue;
    }
    if (!validateSchemaValue(value, propSchema)) {
      throwMcpError({
        name: "mcp tool defective",
        message: `mcp tool defective: ${key} type mismatch`,
        from: { name: "mcp" }
      });
    }
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

function recordSnapshot({ serverName, tools }) {
  const toolMap = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? null,
        outputSchema: tool.outputSchema ?? null,
        toolId: tool.toolId ?? ""
      }
    ])
  );
  const snapshot = { server: serverName, tools: toolMap };
  const { text: snapshotText } = jsonToPyashText(snapshot, `mcp ${serverName} tools snapshot`, { existingNames: [] });
  const snapshotSentence = {
    mood: "ya",
    su: { name: `mcp ${serverName}` },
    be: "tool snapshot",
    ob: { text: snapshotText }
  };
  const locator = `artifacts/mcp/${sanitizeServerName(serverName)}-tools.json`;
  const runRoot = getExchangeRunRoot() ?? process.cwd();
  const absPath = path.resolve(runRoot, locator);
  try {
    fsSync.mkdirSync(path.dirname(absPath), { recursive: true });
    fsSync.writeFileSync(absPath, snapshotText, "utf8");
  } catch {}
  recordArtifact({
    locator,
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

  const strictReplay = getExchangeStrict();
  if (strictReplay) {
    const locator = `artifacts/mcp/${sanitizeServerName(name)}-tools.json`;
    const runRoot = getExchangeRunRoot() ?? process.cwd();
    const absPath = path.resolve(runRoot, locator);
    let snapshotText = null;
    try {
      snapshotText = await fs.readFile(absPath, "utf8");
    } catch {
      throwMcpError({
        name: "mcp snapshot missing",
        message: `mcp snapshot missing: ${name}`,
        from: { name: source }
      });
    }
    let snapshot;
    try {
      snapshot = jsonObjectFromPyash(snapshotText, { rootName: `mcp ${name} tools snapshot` });
    } catch (err) {
      throwMcpError({
        name: "mcp snapshot defective",
        message: `mcp snapshot defective: ${name}`,
        from: { name: source },
        raw: { error: err?.message }
      });
    }
    const toolEntries = snapshot?.tools && typeof snapshot.tools === "object" ? snapshot.tools : {};
    const tools = [];
    const toolByName = new Map();
    for (const [toolName, info] of Object.entries(toolEntries)) {
      const tool = {
        name: toolName,
        description: info?.description ?? "",
        inputSchema: info?.inputSchema ?? null,
        outputSchema: info?.outputSchema ?? null,
        toolId: info?.toolId ?? ""
      };
      const expectedId = buildToolIdentity({ server: name, tool });
      if (tool.toolId && tool.toolId !== expectedId) {
        throwMcpError({
          name: "mcp snapshot mismatch",
          message: `mcp snapshot mismatch: ${toolName}`,
          from: { name: source }
        });
      }
      if (!tool.toolId) tool.toolId = expectedId;
      tools.push(tool);
      toolByName.set(tool.name, tool);
    }
    tools.sort((a, b) => a.name.localeCompare(b.name, "en"));
    const record = {
      serverName: name,
      client: null,
      tools,
      toolByName
    };
    mcpServers.set(name, record);
    return record;
  }

  const config = resolveMcpConfig(name, { rememberFn });
  const exitHandler = ({ code, signal, serverName: exitName }) => {
    if (code === 0 && !signal) {
      emitExchangeSentence({
        mood: "ya",
        su: { name: "mcp server exit" },
        be: "mcp exit",
        ob: { text: `mcp server exit: ${exitName}` },
        from: { name: "mcp" }
      });
      return;
    }
    const errSentence = buildErrorSentence({
      name: "mcp server crash",
      message: `mcp server crash: ${exitName}`,
      from: { name: "mcp" },
      raw: { code, signal }
    });
    emitExchangeSentence(errSentence);
  };
  const client = existing?.client ?? (
    config.command === "inline"
      ? await buildInlineClient(config.args)
      : new McpClient({ command: config.command, args: config.args, serverName: name, onExit: exitHandler })
  );

  try {
    await client.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pyash", version: "0.1.0" }
    });
    if (typeof client.sendNotification === "function") {
      client.sendNotification("notifications/initialized", {});
    }
  } catch (err) {
    throwMcpError({
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
    throwMcpError({
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

export async function callMcpTool({ verbName, sentence, rememberFn = remember, doRememberFn, allRememberFn } = {}) {
  const entry = lookupMcpTool(verbName);
  if (!entry) {
    throwMcpError({
      name: "mcp tool missing",
      message: `mcp tool missing: ${verbName}`,
      from: { name: "mcp" }
    });
  }
  const denylist = resolveMcpDenylist({ rememberFn });
  if (denylist && denylist.has(verbName)) {
    throwMcpError({
      name: "mcp tool denied",
      message: `mcp tool denied: ${verbName}`,
      from: { name: "mcp" }
    });
  }
  const allowlist = resolveMcpAllowlist({ rememberFn });
  if (allowlist && !allowlist.has(verbName)) {
    throwMcpError({
      name: "mcp tool denied",
      message: `mcp tool denied: ${verbName}`,
      from: { name: "mcp" }
    });
  }
  const server = await ensureMcpServer(entry.serverName, { rememberFn, source: "mcp" });
  const tool = server.toolByName.get(entry.toolName);
  if (!tool) {
    throwMcpError({
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
    if (value === undefined) continue;
    const jsonValue = valueToJson(value);
    if (jsonValue !== undefined) args[key] = jsonValue;
  }
  if (properties && Object.keys(properties).length === 1) {
    const onlyKey = Object.keys(properties)[0];
    if (args[onlyKey] === undefined && sentence?.ob !== undefined) {
      const jsonValue = valueToJson(sentence.ob);
      if (jsonValue !== undefined) args[onlyKey] = jsonValue;
    }
  }
  validateSchemaArgs(args, schema, { toolName: entry.toolName });

  if (!server.client) {
    throwMcpError({
      name: "mcp tool unavailable",
      message: `mcp tool unavailable: ${entry.toolName}`,
      from: { name: "mcp" }
    });
  }

  const timeoutSeconds = sentence?.by?.num ?? sentence?.by?.quantity?.num ?? null;
  const timeoutMs = timeoutSeconds != null ? Math.max(0, Number(timeoutSeconds) * 1000) : null;

  let result;
  try {
    const callPromise = server.client.send("tools/call", { name: entry.toolName, arguments: args });
    if (timeoutMs != null) {
      result = await Promise.race([
        callPromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("mcp tool timeout")), timeoutMs);
        })
      ]);
    } else {
      result = await callPromise;
    }
  } catch (err) {
    if (err?.message === "mcp tool timeout") {
      if (typeof server.client.sendNotification === "function") {
        server.client.sendNotification("notifications/cancelled", { reason: "timeout" });
      }
      throwMcpError({
        name: "mcp tool timeout",
        message: `mcp tool timeout: ${entry.toolName}`,
        from: { name: "mcp" }
      });
    }
    throwMcpError({
      name: "mcp tool defective",
      message: `mcp tool defective: ${entry.toolName}`,
      from: { name: "mcp" },
      raw: { error: err?.message }
    });
  }

  if (result && typeof result === "object" && !Array.isArray(result)) {
    if (typeof doRememberFn === "function") {
      const existingNames = collectExistingNames({ allRememberFn });
      const rootName = sentence?.to?.name ?? sentence?.su?.name ?? `mcp ${entry.toolName} result`;
      const { rootName: resolvedRoot, sentences } = jsonToMapSentences(result, rootName, { existingNames });
      for (const s of sentences) doRememberFn(s);
      return { ob: { name: resolvedRoot }, be: "json map" };
    }
    return { ob: jsonToOb(result), be: verbName };
  }
  if (Array.isArray(result) && typeof doRememberFn === "function") {
    const rootName = sentence?.to?.name ?? sentence?.su?.name ?? `mcp ${entry.toolName} result`;
    return jsonArrayToVector(result, { rootName, doRememberFn, allRememberFn });
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
