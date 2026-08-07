import { spawn } from "node:child_process";
import readline from "node:readline";

export class CodexAppServerError extends Error {
  constructor(message, { kind = "server", code = null, details = null } = {}) {
    super(String(message));
    this.name = "CodexAppServerError";
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export class CodexTurnError extends CodexAppServerError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "CodexTurnError";
  }
}

export class JsonlRpcClient {
  constructor(child, { requestTimeoutMs = 30000 } = {}) {
    this.child = child;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.closed = false;
    this.pending = new Map();
    this.waiters = [];
    this.notificationListeners = new Set();
    this.errorListeners = new Set();
    this.stderr = "";

    this.outRl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.errRl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
    this.outRl.on("line", (line) => this.handleStdoutLine(line));
    this.errRl.on("line", (line) => {
      this.stderr += `${line}\n`;
    });
    child.on("error", (err) => this.failAll(err));
    child.on("exit", (code, signal) => {
      if (this.closed) return;
      const reason = signal
        ? `codex app-server exited via signal ${signal}`
        : `codex app-server exited with code ${code ?? "unknown"}`;
      this.failAll(new CodexAppServerError(reason, { kind: "process-exit" }));
    });
  }

  send(message) {
    if (this.closed) throw new CodexAppServerError("rpc client closed", { kind: "closed" });
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs, id = null } = {}) {
    if (this.closed) return Promise.reject(new CodexAppServerError("rpc client closed", { kind: "closed" }));
    const requestId = id == null ? this.nextId++ : id;
    if (requestId >= this.nextId) this.nextId = requestId + 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new CodexAppServerError(`request timeout: ${method}`, { kind: "timeout" }));
      }, Math.max(1, timeoutMs));
      this.pending.set(requestId, { resolve, reject, timer, method });
      try {
        this.send({ jsonrpc: "2.0", id: requestId, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  waitForNotification(method, predicate = () => true, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(new CodexAppServerError("rpc client closed", { kind: "closed" }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new CodexAppServerError(`notification timeout: ${method}`, { kind: "timeout" }));
      }, Math.max(1, timeoutMs));
      const waiter = { method, predicate, resolve, reject, timer };
      this.waiters.push(waiter);
    });
  }

  handleStdoutLine(line) {
    if (!String(line).trim()) return;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      this.failAll(new CodexAppServerError("malformed JSON from codex app-server", { kind: "protocol" }));
      return;
    }
    if (!payload || typeof payload !== "object") {
      this.failAll(new CodexAppServerError("malformed response from codex app-server", { kind: "protocol" }));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "id")) {
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new CodexAppServerError(
          payload.error?.message || `request failed: ${pending.method}`,
          { kind: "server", code: payload.error?.code ?? null, details: payload.error }
        ));
      } else {
        pending.resolve(payload.result ?? {});
      }
      return;
    }
    if (!payload.method) return;
    const params = payload.params ?? {};
    for (const listener of [...this.notificationListeners]) {
      try {
        listener(payload.method, params, payload);
      } catch (err) {
        this.failAll(err);
        return;
      }
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== payload.method) continue;
      let matched = false;
      try {
        matched = Boolean(waiter.predicate(params));
      } catch {
        matched = false;
      }
      if (!matched) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((entry) => entry !== waiter);
      waiter.resolve(params);
    }
  }

  failAll(err) {
    if (this.closed) return;
    this.closed = true;
    const error = err instanceof Error ? err : new Error(String(err));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error);
      } catch {}
    }
    try {
      this.outRl.close();
    } catch {}
    try {
      this.errRl.close();
    } catch {}
  }

  async close() {
    if (!this.closed) this.failAll(new CodexAppServerError("rpc client closed", { kind: "closed" }));
    try {
      this.child.stdin.end();
    } catch {}
    if (this.child.exitCode == null && !this.child.killed && typeof this.child.kill === "function") {
      this.child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.child.exitCode == null && !this.child.killed) this.child.kill("SIGKILL");
    }
  }
}

export function threadIdFromResponse(response) {
  return String(response?.thread?.id || response?.threadId || response?.id || "").trim();
}

export function turnIdFromResponse(response) {
  return String(response?.turn?.id || response?.turnId || response?.id || "").trim();
}

function turnStatus(value) {
  if (value && typeof value === "object") return String(value.type || value.status || "").toLowerCase();
  return String(value ?? "").toLowerCase();
}

function appendText(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.text === "string") output.push(value.text);
  if (typeof value.delta === "string") output.push(value.delta);
  if (Array.isArray(value.content)) value.content.forEach((entry) => appendText(entry, output));
}

function itemText(item) {
  const output = [];
  appendText(item?.text, output);
  appendText(item?.content, output);
  return output.join("");
}

function changesFromParams(params) {
  if (Array.isArray(params?.changes)) return params.changes;
  if (Array.isArray(params?.fileChanges)) return params.fileChanges;
  if (params?.diff) return [{ kind: "update", diff: String(params.diff) }];
  return [];
}

function classifyTurnFailure(turn, fallback = "turn failed") {
  const status = turnStatus(turn?.status);
  const message = String(turn?.error?.message || turn?.error || fallback);
  if (/usage|quota|rate.?limit|limit.?exceeded/i.test(`${status} ${message}`)) {
    return new CodexTurnError(message, { kind: "usage-limited", details: turn });
  }
  if (/interrupt|cancel/i.test(`${status} ${message}`)) {
    return new CodexTurnError(message, { kind: "interrupted", details: turn });
  }
  return new CodexTurnError(message, { kind: "failed", details: turn });
}

export async function runCodexTurn(client, {
  threadId,
  input,
  cwd = null,
  model = null,
  reasoningEffort = null,
  sandboxPolicy = null,
  approvalPolicy = null,
  requestIdentity = "",
  timeoutMs = 300000
} = {}) {
  const events = [];
  const deltas = [];
  const completedMessages = [];
  const fileChanges = [];
  let diff = "";
  let turnId = "";
  let completedTurn = null;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const timer = setTimeout(() => {
    rejectCompletion(new CodexTurnError("turn timeout", { kind: "timeout" }));
  }, Math.max(1, timeoutMs));
  const unsubscribe = client.onNotification((method, params) => {
    const eventThreadId = String(params?.threadId || "");
    const eventTurnId = String(params?.turnId || params?.turn?.id || "");
    if (eventThreadId && eventThreadId !== String(threadId)) return;
    if (turnId && eventTurnId && eventTurnId !== turnId) return;
    events.push({ method, params });
    if (method === "item/agentMessage/delta") {
      if (typeof params?.delta === "string") deltas.push(params.delta);
    } else if (method === "item/completed") {
      const item = params?.item;
      if (String(item?.type || "").toLowerCase().includes("agentmessage")) completedMessages.push(itemText(item));
      if (String(item?.type || "").toLowerCase().includes("filechange")) fileChanges.push(...changesFromParams(item));
    } else if (method === "turn/diff/updated") {
      diff = String(params?.diff || diff);
      fileChanges.push(...changesFromParams(params));
    } else if (method === "item/fileChange/patchUpdated") {
      fileChanges.push(...changesFromParams(params));
    } else if (method === "turn/completed") {
      completedTurn = params?.turn || params;
      resolveCompletion(completedTurn);
    }
  });
  const unsubscribeError = client.onError((err) => rejectCompletion(err));
  try {
    const started = await client.request("turn/start", {
      threadId,
      input: Array.isArray(input) ? input : [{ type: "text", text: String(input ?? "") }],
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      ...(requestIdentity ? { clientUserMessageId: requestIdentity } : {}),
      ...(sandboxPolicy ? { sandboxPolicy } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {})
    });
    turnId = turnIdFromResponse(started);
    const turn = await completion;
    clearTimeout(timer);
    const status = turnStatus(turn?.status);
    if (!/(completed|success|succeeded)/.test(status)) throw classifyTurnFailure(turn);
    return {
      status: status || "completed",
      turnId,
      requestIdentity: String(requestIdentity || ""),
      text: deltas.length ? deltas.join("") : completedMessages.join(""),
      diff,
      fileChanges,
      events,
      turn
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  } finally {
    unsubscribe?.();
    unsubscribeError?.();
  }
}

export async function spawnCodexAppServer({
  codexBin = process.env.PYA_CODEX_BIN || "codex",
  env = process.env,
  clientInfo = { name: "pyash", title: "Pyash", version: "0.1.0" },
  requestTimeoutMs = 30000,
  initializeTimeoutMs = 10000
} = {}) {
  const child = spawn(String(codexBin), ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env
  });
  const client = new JsonlRpcClient(child, { requestTimeoutMs });
  await client.request("initialize", { clientInfo }, {
    id: 0,
    timeoutMs: initializeTimeoutMs
  });
  client.notify("initialized", {});
  return client;
}

export async function startCodexThread(client, {
  cwd,
  model,
  reasoningEffort = null,
  approvalPolicy = null,
  sandbox = "workspace-write",
  developerInstructions = null
} = {}) {
  return client.request("thread/start", {
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { config: { reasoningEffort } } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(developerInstructions ? { developerInstructions } : {})
  });
}

export async function resumeCodexThread(client, threadId, {
  cwd,
  model,
  reasoningEffort = null,
  approvalPolicy = null,
  sandbox = "workspace-write"
} = {}) {
  return client.request("thread/resume", {
    threadId,
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { config: { reasoningEffort } } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandbox ? { sandbox } : {})
  });
}

export async function interruptCodexTurn(client, { threadId, turnId } = {}) {
  return client.request("turn/interrupt", { threadId, turnId });
}
