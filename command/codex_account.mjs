#!/usr/bin/env node
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { URL } from "node:url";

function parseArgValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function parseTruthy(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(truth|true|yes|1|y)$/i.test(String(value).trim());
}

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function usage() {
  return [
    "Usage:",
    "  node command/codex_account.mjs read [--json] [--refresh-token <truth|lie>] [--timeout-ms <n>] [--codex-bin <path>]",
    "  node command/codex_account.mjs login [--json] [--type <chatgpt|apikey|chatgptAuthTokens>] [--wait-ms <n>] [--timeout-ms <n>] [--codex-bin <path>]",
    "  node command/codex_account.mjs cancel --login-id <id> [--json] [--wait-ms <n>] [--timeout-ms <n>] [--codex-bin <path>]",
    "  node command/codex_account.mjs logout [--json] [--wait-ms <n>] [--timeout-ms <n>] [--codex-bin <path>]",
    "  node command/codex_account.mjs rate-limits [--json] [--timeout-ms <n>] [--codex-bin <path>]",
    "  node command/codex_account.mjs models [--json] [--limit <n>] [--timeout-ms <n>] [--codex-bin <path>]",
    "",
    "Notes:",
    "  - Spawns `codex app-server` and talks JSON-RPC over stdio.",
    "  - Override codex binary with --codex-bin or PYA_CODEX_BIN."
  ].join("\n");
}

class RpcClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.closed = false;
    this.pending = new Map();
    this.waiters = [];
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
      this.failAll(new Error(reason));
    });
  }

  send(message) {
    if (this.closed) throw new Error("rpc client closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, { timeoutMs = 30000, id = null } = {}) {
    if (this.closed) return Promise.reject(new Error("rpc client closed"));
    const requestId = id == null ? this.nextId++ : id;
    if (requestId >= this.nextId) this.nextId = requestId + 1;
    const message = { jsonrpc: "2.0", id: requestId, method, params };
    this.send(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`request timeout: ${method}`));
      }, Math.max(1, timeoutMs));
      this.pending.set(requestId, { resolve, reject, timer, method });
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  waitForNotification(method, predicate = () => true, { timeoutMs = 30000 } = {}) {
    if (this.closed) return Promise.reject(new Error("rpc client closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new Error(`notification timeout: ${method}`));
      }, Math.max(1, timeoutMs));
      const waiter = { method, predicate, resolve, reject, timer };
      this.waiters.push(waiter);
    });
  }

  handleStdoutLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "id")) {
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(payload.id);
      if (payload.error) {
        const msg = payload.error?.message || `request failed: ${pending.method}`;
        pending.reject(new Error(msg));
      } else {
        pending.resolve(payload.result ?? {});
      }
      return;
    }
    if (!payload?.method) return;
    const waiters = this.waiters.slice();
    for (const waiter of waiters) {
      if (waiter.method !== payload.method) continue;
      let matched = false;
      try {
        matched = Boolean(waiter.predicate(payload.params ?? {}));
      } catch {
        matched = false;
      }
      if (!matched) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((entry) => entry !== waiter);
      waiter.resolve(payload.params ?? {});
    }
  }

  failAll(err) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.waiters = [];
    try {
      this.outRl.close();
    } catch {}
    try {
      this.errRl.close();
    } catch {}
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("rpc client closed"));
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("rpc client closed"));
    }
    this.waiters = [];
    try {
      this.outRl.close();
    } catch {}
    try {
      this.errRl.close();
    } catch {}
    try {
      this.child.stdin.end();
    } catch {}
    if (this.child.exitCode == null && !this.child.killed) {
      this.child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.child.exitCode == null && !this.child.killed) this.child.kill("SIGKILL");
    }
  }
}

function parseLoginLocalPort(authUrl) {
  try {
    const url = new URL(String(authUrl ?? ""));
    const redirect = url.searchParams.get("redirect_uri");
    if (!redirect) return null;
    const redirectUrl = new URL(redirect);
    const host = String(redirectUrl.hostname ?? "").toLowerCase();
    if (!(host === "localhost" || host === "127.0.0.1")) return null;
    const port = Number(redirectUrl.port);
    if (!Number.isFinite(port) || port <= 0) return null;
    return port;
  } catch {
    return null;
  }
}

function makeSshHint(authUrl) {
  const port = parseLoginLocalPort(authUrl);
  if (!port) return "";
  return `ssh -L ${port}:127.0.0.1:${port} <user>@<server>`;
}

async function openRpcClient({ codexBin }) {
  const bin = String(codexBin || process.env.PYA_CODEX_BIN || "codex").trim() || "codex";
  const child = spawn(bin, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });
  const rpc = new RpcClient(child);
  await rpc.request("initialize", {
    clientInfo: {
      name: "pyash",
      title: "Pyash",
      version: "0.1.0"
    }
  }, { id: 0, timeoutMs: 10000 });
  rpc.notify("initialized", {});
  return rpc;
}

async function runRead({ rpc, timeoutMs, refreshToken }) {
  const account = await rpc.request("account/read", { refreshToken }, { timeoutMs });
  return { ok: true, account };
}

async function runLogin({ rpc, timeoutMs, waitMs, type, onStart }) {
  const pre = await rpc.request("account/read", { refreshToken: false }, { timeoutMs });
  if (pre?.requiresOpenaiAuth === false) {
    return { ok: true, alreadyAuthenticated: true, reason: "server reports auth not required", account: pre };
  }
  if (pre?.account) {
    return { ok: true, alreadyAuthenticated: true, reason: "existing account present", account: pre };
  }

  const started = await rpc.request("account/login/start", { type }, { timeoutMs });
  if (typeof onStart === "function") onStart(started);
  const sshHint = makeSshHint(started?.authUrl);

  const completedPromise = rpc.waitForNotification(
    "account/login/completed",
    (params) => String(params?.loginId ?? "") === String(started?.loginId ?? ""),
    { timeoutMs: waitMs }
  );
  const updatedPromise = rpc.waitForNotification(
    "account/updated",
    () => true,
    { timeoutMs: waitMs }
  ).catch(() => null);

  const completed = await completedPromise;
  const updated = await updatedPromise;
  if (!completed?.success) {
    const errorText = String(completed?.error || "login did not complete");
    throw new Error(errorText);
  }

  const post = await rpc.request("account/read", { refreshToken: false }, { timeoutMs });
  return { ok: true, started, sshHint, completed, updated, account: post };
}

async function runCancel({ rpc, timeoutMs, waitMs, loginId }) {
  await rpc.request("account/login/cancel", { loginId }, { timeoutMs });
  const completed = await rpc.waitForNotification(
    "account/login/completed",
    (params) => String(params?.loginId ?? "") === String(loginId),
    { timeoutMs: waitMs }
  );
  return { ok: true, completed };
}

async function runLogout({ rpc, timeoutMs, waitMs }) {
  await rpc.request("account/logout", {}, { timeoutMs });
  const updated = await rpc.waitForNotification(
    "account/updated",
    (params) => params?.authMode == null,
    { timeoutMs: waitMs }
  ).catch(() => null);
  const post = await rpc.request("account/read", { refreshToken: false }, { timeoutMs });
  return { ok: true, updated, account: post };
}

async function runRateLimits({ rpc, timeoutMs }) {
  const limits = await rpc.request("account/rateLimits/read", {}, { timeoutMs });
  return { ok: true, limits };
}

function normalizeModelEntry(entry) {
  const id = String(entry?.id ?? entry?.model ?? "").trim();
  if (!id) return null;
  const displayName = String(entry?.displayName ?? "").trim();
  const rawModalities = Array.isArray(entry?.inputModalities) ? entry.inputModalities : [];
  const inputModalities = rawModalities.length > 0
    ? Array.from(new Set(rawModalities.map((item) => String(item ?? "").trim()).filter(Boolean)))
    : ["text", "image"];
  return {
    id,
    displayName,
    isDefault: Boolean(entry?.isDefault),
    supportsPersonality: Boolean(entry?.supportsPersonality),
    defaultReasoningEffort: entry?.defaultReasoningEffort ?? null,
    reasoningEffort: Array.isArray(entry?.reasoningEffort) ? entry.reasoningEffort : [],
    upgrade: entry?.upgrade ?? null,
    inputModalities
  };
}

function getModelArray(payload) {
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function runModels({ rpc, timeoutMs, limit }) {
  const models = [];
  let cursor = null;
  let pages = 0;
  while (true) {
    const params = { limit };
    if (cursor) params.cursor = cursor;
    const result = await rpc.request("model/list", params, { timeoutMs });
    pages += 1;
    for (const rawModel of getModelArray(result)) {
      const normalized = normalizeModelEntry(rawModel);
      if (normalized) models.push(normalized);
    }
    const nextCursor = String(result?.nextCursor ?? "").trim();
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return { ok: true, models, pages };
}

async function main() {
  const args = process.argv.slice(2);
  const action = String(args[0] || "").trim();
  if (!action || action === "--help" || action === "-h" || action === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const json = hasFlag(args, "--json");
  const codexBin = parseArgValue(args, "--codex-bin") ?? "";
  const timeoutMs = parsePositiveInt(parseArgValue(args, "--timeout-ms"), 15000);
  const waitMs = parsePositiveInt(parseArgValue(args, "--wait-ms"), 180000);
  const limit = parsePositiveInt(parseArgValue(args, "--limit"), 50);
  const refreshToken = parseTruthy(parseArgValue(args, "--refresh-token"), false);
  const type = String(parseArgValue(args, "--type") || "chatgpt").trim();
  const loginId = String(parseArgValue(args, "--login-id") || "").trim();

  let rpc;
  try {
    rpc = await openRpcClient({ codexBin });
    let result;
    if (action === "read") {
      result = await runRead({ rpc, timeoutMs, refreshToken });
    } else if (action === "login") {
      result = await runLogin({
        rpc,
        timeoutMs,
        waitMs,
        type,
        onStart: (started) => {
          if (json) return;
          const authUrl = String(started?.authUrl || "");
          const sshHint = makeSshHint(authUrl);
          process.stdout.write("Open this URL in a browser:\n");
          process.stdout.write(`${authUrl}\n`);
          process.stdout.write("Keep this terminal open; sign-in completes after callback.\n");
          if (sshHint) {
            process.stdout.write("If this is a remote shell, run this locally first:\n");
            process.stdout.write(`${sshHint}\n`);
          }
        }
      });
    } else if (action === "cancel") {
      if (!loginId) throw new Error("missing --login-id");
      result = await runCancel({ rpc, timeoutMs, waitMs, loginId });
    } else if (action === "logout") {
      result = await runLogout({ rpc, timeoutMs, waitMs });
    } else if (action === "rate-limits") {
      result = await runRateLimits({ rpc, timeoutMs });
    } else if (action === "models") {
      result = await runModels({ rpc, timeoutMs, limit });
    } else {
      throw new Error(`unknown action: ${action}`);
    }

    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, action, ...result }, null, 2)}\n`);
    } else {
      process.stdout.write(`codex account ${action} complete\n`);
      if (action === "read") {
        process.stdout.write(`- requires auth ${result?.account?.requiresOpenaiAuth ? "truth" : "lie"}\n`);
        process.stdout.write(`- auth mode ${result?.account?.authMode ?? "none"}\n`);
      } else if (action === "login") {
        if (result?.alreadyAuthenticated) {
          process.stdout.write("- already authenticated\n");
        } else {
          process.stdout.write(`- login id ${result?.started?.loginId ?? ""}\n`);
          process.stdout.write(`- auth mode ${result?.account?.authMode ?? result?.updated?.authMode ?? "chatgpt"}\n`);
        }
      } else if (action === "cancel") {
        process.stdout.write(`- cancelled ${result?.completed?.loginId ?? loginId}\n`);
      } else if (action === "logout") {
        process.stdout.write("- logged out\n");
      } else if (action === "rate-limits") {
        process.stdout.write(`- rate limits ${JSON.stringify(result?.limits ?? {})}\n`);
      } else if (action === "models") {
        const models = Array.isArray(result?.models) ? result.models : [];
        process.stdout.write(`- models ${models.length}\n`);
        for (const model of models) {
          const defaultMark = model?.isDefault ? " (default)" : "";
          process.stdout.write(`  ${model?.id ?? ""}${defaultMark}\n`);
        }
      }
    }
  } catch (err) {
    const message = String(err?.message ?? err);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, action, error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`codex account ${action} failed: ${message}\n`);
    }
    process.exit(1);
  } finally {
    if (rpc) await rpc.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
