import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { buildErrorSentence, throwErrorSentence } from "../error.mjs";
import { emitExchangeSentence, getExchangeRunRoot, getExchangeStrict } from "../bridge/exchange.mjs";
import { jsonToMapSentences } from "../verbs/exchange/json_map.mjs";
import { jsonObjectFromPyash } from "../verbs/exchange/write_json.mjs";
import { McpClient, HttpMcpClient, buildInlineClient } from "./mcp/clients.mjs";
import { normalizeServerName, sanitizeServerName, resolveMcpConfig, resolveMcpAllowlist, resolveMcpDenylist, restartPolicyDelayMs } from "./mcp/config.mjs";
import { valueToJson, jsonToOb, buildToolIdentity, normalizeTool, collectExistingNames, jsonArrayToVector, validateSchemaArgs } from "./mcp/tools.mjs";
import { recordSnapshot } from "./mcp/snapshot.mjs";

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

function scheduleMcpRestart(record, { code, signal }) {
  const policy = record?.restartPolicy;
  if (!policy || policy.policy !== "on crash") return false;
  if (!policy.max || !policy.windowMs) {
    recordRestartDenied({ serverName: record.serverName, policy });
    return false;
  }
  const now = Date.now();
  const state = record.restartState ?? { attempts: [], pending: false, timer: null };
  const attempts = state.attempts.filter(ts => now - ts <= policy.windowMs);
  state.attempts = attempts;
  if (attempts.length >= policy.max) {
    record.restartState = state;
    recordRestartDenied({ serverName: record.serverName, policy });
    return false;
  }
  const attemptNumber = attempts.length + 1;
  attempts.push(now);
  const delayMs = restartPolicyDelayMs(policy, attemptNumber);
  recordRestartEvent({ serverName: record.serverName, policy, delayMs });
  if (state.pending && state.timer) clearTimeout(state.timer);
  state.pending = true;
  state.timer = setTimeout(() => {
    state.pending = false;
    state.timer = null;
    startMcpClient({ record, source: "mcp restart" }).catch(() => {});
  }, delayMs);
  record.restartState = state;
  return true;
}

async function startMcpClient({ record, source }) {
  const config = record?.config;
  if (!config) {
    throwMcpError({
      name: "mcp server missing",
      message: "mcp server missing",
      from: { name: source }
    });
  }
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
    if (record) {
      record.client = null;
      scheduleMcpRestart(record, { code, signal });
    }
  };
  let client;
  if (config.transport !== "stdio") {
    if (!config.endpoint) {
      throwMcpError({
        name: "mcp config defective",
        message: `mcp config defective: missing endpoint for ${record.serverName}`,
        from: { name: source }
      });
    }
    if (config.transport === "ws") {
      throwMcpError({
        name: "mcp transport defective",
        message: `mcp transport defective: ws not supported for ${record.serverName}`,
        from: { name: source }
      });
    }
    client = new HttpMcpClient({
      endpoint: config.endpoint,
      headers: config.headers,
      protocolVersion: "2025-06-18",
      transport: config.transport
    });
  } else if (config.command === "inline") {
    client = await buildInlineClient(config.args);
  } else {
    client = new McpClient({ command: config.command, args: config.args, serverName: record.serverName, onExit: exitHandler });
  }

  record.client = client;

  const startTimeoutMs = Number(process.env.PYA_MCP_START_TIMEOUT_MS ?? 15000);
  const sendWithTimeout = async (method, params, label) => {
    if (!Number.isFinite(startTimeoutMs) || startTimeoutMs <= 0) {
      return client.send(method, params);
    }
    return await Promise.race([
      client.send(method, params),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error(`mcp ${label} timeout`));
        }, startTimeoutMs);
      })
    ]);
  };

  try {
    await sendWithTimeout("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pyash", version: "0.1.0" }
    }, "initialize");
    if (typeof client.sendNotification === "function") {
      client.sendNotification("notifications/initialized", {});
    }
  } catch (err) {
    throwMcpError({
      name: "mcp defective",
      message: `mcp defective: initialize failed for ${record.serverName}`,
      from: { name: source },
      raw: { error: err?.message }
    });
  }

  let response;
  try {
    response = await sendWithTimeout("tools/list", {}, "tools/list");
  } catch (err) {
    throwMcpError({
      name: "mcp defective",
      message: `mcp defective: tool discovery failed for ${record.serverName}`,
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
    tool.toolId = buildToolIdentity({ server: record.serverName, tool });
    tools.push(tool);
    toolByName.set(tool.name, tool);
  }
  tools.sort((a, b) => a.name.localeCompare(b.name, "en"));

  record.tools = tools;
  record.toolByName = toolByName;
  recordSnapshot({ serverName: record.serverName, tools });
  return record;
}
function recordRestartEvent({ serverName, policy, delayMs }) {
  emitExchangeSentence({
    mood: "ya",
    su: { name: "mcp server restart" },
    be: "mcp restart",
    ob: { name: serverName },
    by: { num: delayMs },
    with: policy?.name ? { name: policy.name } : undefined,
    from: { name: "mcp" }
  });
}

function recordRestartDenied({ serverName, policy }) {
  emitExchangeSentence({
    mood: "ya",
    su: { name: "mcp server restart denied" },
    be: "mcp restart denied",
    ob: { name: serverName },
    with: policy?.name ? { name: policy.name } : undefined,
    from: { name: "mcp" }
  });
  emitExchangeSentence(buildErrorSentence({
    name: "mcp server restart denied",
    message: `mcp server restart denied: ${serverName}`,
    from: { name: "mcp" }
  }));
}

function throwMcpError({ name, message, from, raw }) {
  const sentence = buildErrorSentence({ name, message, from, raw });
  emitExchangeSentence(sentence);
  const err = new Error(message || name || "error");
  err.sentence = sentence;
  throw err;
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
  const strictReplay = getExchangeStrict();
  if (existing?.tools?.length && (existing.client || strictReplay)) return existing;

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
    const capabilityEntries = snapshot?.capabilities && typeof snapshot.capabilities === "object" ? snapshot.capabilities : {};
    const tools = [];
    const toolByName = new Map();
    for (const [toolName, info] of Object.entries(toolEntries)) {
      const tool = {
        name: toolName,
        description: info?.description ?? "",
        inputSchema: info?.inputSchema ?? null,
        outputSchema: info?.outputSchema ?? null,
        toolId: info?.toolId ?? "",
        capabilities: info?.toolId ? capabilityEntries?.[info.toolId] ?? null : null
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
      toolByName,
      config: null,
      restartPolicy: null,
      restartState: { attempts: [], pending: false, timer: null }
    };
    mcpServers.set(name, record);
    return record;
  }

  const config = resolveMcpConfig(name, { rememberFn });
  const record = existing ?? {
    serverName: name,
    client: null,
    tools: [],
    toolByName: new Map(),
    config,
    restartPolicy: config.restartPolicy ?? null,
    restartState: { attempts: [], pending: false, timer: null }
  };
  record.config = config;
  record.restartPolicy = config.restartPolicy ?? null;
  if (!record.restartState) record.restartState = { attempts: [], pending: false, timer: null };
  mcpServers.set(name, record);
  return startMcpClient({ record, source });
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
  try {
    validateSchemaArgs(args, schema, { toolName: entry.toolName });
  } catch (err) {
    throwMcpError({
      name: "mcp tool defective",
      message: err?.message ?? `mcp tool defective: ${entry.toolName}`,
      from: { name: "mcp" }
    });
  }

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
  let closed = 0;
  for (const record of mcpServers.values()) {
    try {
      record?.client?.proc?.kill();
      closed += 1;
    } catch {}
    if (record?.restartState?.timer) {
      clearTimeout(record.restartState.timer);
    }
  }
  mcpServers.clear();
  mcpToolRegistry.clear();
  return closed;
}

export function closeMcpServer(serverName) {
  const name = normalizeServerName(serverName);
  if (!name) return;
  const record = mcpServers.get(name);
  if (record?.client?.proc) {
    try {
      record.client.proc.kill();
    } catch {}
  }
  if (record?.restartState?.timer) {
    clearTimeout(record.restartState.timer);
  }
  mcpServers.delete(name);
}

export function getMcpServerTools(serverName) {
  const record = mcpServers.get(serverName);
  return record?.tools ?? [];
}

export { parseSseStream } from "./mcp/clients.mjs";
