#!/usr/bin/env node
import process from "node:process";
import { URL } from "node:url";

import { spawnCodexAppServer } from "../program/runtime/codex/app_server.mjs";

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
  return spawnCodexAppServer({
    codexBin: String(codexBin || process.env.PYA_CODEX_BIN || "codex").trim() || "codex"
  });
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
  const directReasoning = Array.isArray(entry?.reasoningEffort) ? entry.reasoningEffort : [];
  const supportedReasoning = Array.isArray(entry?.supportedReasoningEfforts)
    ? entry.supportedReasoningEfforts.map((item) => item?.reasoningEffort)
    : [];
  const reasoningEffort = Array.from(new Set(
    [...directReasoning, ...supportedReasoning]
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
  ));
  const inputModalities = rawModalities.length > 0
    ? Array.from(new Set(rawModalities.map((item) => String(item ?? "").trim()).filter(Boolean)))
    : ["text", "image"];
  return {
    id,
    displayName,
    isDefault: Boolean(entry?.isDefault),
    supportsPersonality: Boolean(entry?.supportsPersonality),
    defaultReasoningEffort: entry?.defaultReasoningEffort ?? null,
    reasoningEffort,
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
