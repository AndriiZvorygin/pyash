import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureWorkQueueDirs } from "./queue.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function safe(value, fallback = "latest") {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-|-$/g, "") || fallback;
}

function quote(value) {
  return JSON.stringify(text(value));
}

function notificationPath(worldRoot, id) {
  return path.join(worldRoot, "holding", "work", "artifacts", "notification", `${safe(id)}.pya`);
}

function mapBlock(entries) {
  return [
    "su name work notification status be map def",
    ...entries.map(([key, value]) => `  su name ${key} ob text ${quote(value)} ya`),
    "prah",
    ""
  ].join("\n");
}

function parseStatus(source) {
  const match = String(source ?? "").match(/su name work notification status be map def\n([\s\S]*?)\nprah/i);
  const result = {};
  for (const line of String(match?.[1] || "").split("\n")) {
    const found = line.trim().match(/^su name (.+?) ob text (.+?) ya$/i);
    if (!found) continue;
    try {
      result[found[1]] = JSON.parse(found[2]);
    } catch {
      result[found[1]] = found[2];
    }
  }
  return result;
}

function validAddress(value, label) {
  const address = text(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
    throw new Error(`${label} must be an email address`);
  }
  return address;
}

function encodedHeader(value) {
  const source = text(value);
  return /^[\x20-\x7e]*$/u.test(source)
    ? source
    : `=?UTF-8?B?${Buffer.from(source, "utf8").toString("base64")}?=`;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export function buildWorkReportEmail({
  task = null,
  title = "background work",
  status = "",
  report = "",
  recipient,
  from,
  subjectOverride = ""
} = {}) {
  const to = validAddress(recipient, "email recipient");
  const sender = validAddress(from, "email sender");
  const taskTitle = text(task?.title) || text(title) || "background work";
  const result = text(task?.status) || text(status) || "reported";
  const subject = text(subjectOverride) || `Pyash daily improvement: ${taskTitle} \u2014 ${result.toUpperCase()}`;
  const body = `${text(report).replace(/\r?\n/gu, "\r\n")}\r\n`;
  return {
    to,
    from: sender,
    subject,
    message: [
      `From: ${sender}`,
      `To: ${to}`,
      `Subject: ${encodedHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body
    ].join("\r\n")
  };
}

export async function resolveWorkMailTransport({
  transport = "auto",
  sendmailPath = "/usr/sbin/sendmail",
  access = fs.access
} = {}) {
  const requested = text(transport).toLowerCase() || "auto";
  if (["sendmail", "docker-sendmail"].includes(requested)) return requested;
  if (requested !== "auto") throw new Error(`unsupported work mail transport: ${requested}`);
  try {
    await access(sendmailPath);
    return "sendmail";
  } catch {
    return "docker-sendmail";
  }
}

function runProcess({ command, args, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function deliver({
  transport,
  message,
  sender,
  sendmailPath,
  dockerCommand,
  dockerContainer,
  commandRunner = runProcess
}) {
  const command = transport === "sendmail" ? sendmailPath : dockerCommand;
  const args = transport === "sendmail"
    ? ["-i", "-t", "-f", sender]
    : ["exec", "--interactive", dockerContainer, sendmailPath, "-i", "-t", "-f", sender];
  const result = await commandRunner({ command, args, input: message });
  if (Number(result?.code) !== 0) {
    const detail = text(result?.stderr || result?.stdout || result?.signal);
    throw new Error(`${transport} mail submission failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

export async function writeWorkNotificationStatus(worldRoot, status) {
  await ensureWorkQueueDirs(worldRoot);
  const target = notificationPath(worldRoot, status.taskId || "scheduler-latest");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const entries = [
    ["task id", status.taskId],
    ["title", status.title],
    ["status", status.status],
    ["recipient", status.recipient],
    ["transport", status.transport],
    ["subject", status.subject],
    ["attempted at", status.attemptedAt],
    ["submitted at", status.submittedAt],
    ["error", status.error]
  ];
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, mapBlock(entries), "utf8");
  await fs.rename(temporary, target);
  return status;
}

export async function readWorkNotificationStatus(worldRoot, taskId = "scheduler-latest") {
  try {
    return parseStatus(await fs.readFile(notificationPath(worldRoot, taskId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function sendWorkReportNotification({
  worldRoot,
  task = null,
  taskId = "",
  title = "background work",
  status = "",
  report,
  recipient,
  from,
  transport = "auto",
  sendmailPath = "/usr/sbin/sendmail",
  dockerCommand = "docker",
  dockerContainer = "mailserver",
  commandRunner,
  now = () => new Date(),
  subjectOverride = ""
} = {}) {
  const attemptedAt = nowIso(now);
  const identity = text(task?.taskId) || text(taskId) || "scheduler-latest";
  const requestedTitle = text(task?.title) || text(title);
  let email = null;
  let selectedTransport = text(transport) || "auto";
  const base = {
    taskId: identity === "scheduler-latest" ? "" : identity,
    title: requestedTitle,
    recipient: text(recipient),
    transport: selectedTransport,
    subject: text(subjectOverride) || `Pyash daily improvement: ${requestedTitle || "background work"} \u2014 ${text(task?.status) || text(status) || "REPORTED"}`,
    attemptedAt,
    submittedAt: "",
    error: ""
  };
  try {
    email = buildWorkReportEmail({ task, title, status, report, recipient, from, subjectOverride });
    selectedTransport = await resolveWorkMailTransport({ transport, sendmailPath });
    await deliver({
      transport: selectedTransport,
      message: email.message,
      sender: email.from,
      sendmailPath,
      dockerCommand,
      dockerContainer,
      commandRunner
    });
    return await writeWorkNotificationStatus(worldRoot, {
      ...base,
      recipient: email.to,
      transport: selectedTransport,
      subject: email.subject,
      status: "submitted",
      submittedAt: nowIso(now)
    });
  } catch (error) {
    return writeWorkNotificationStatus(worldRoot, {
      ...base,
      recipient: email?.to || base.recipient,
      transport: selectedTransport,
      subject: email?.subject || base.subject,
      status: "failed",
      error: text(error?.message || error)
    });
  }
}

export function defaultWorkEmailFrom(env = process.env) {
  return text(env.PYA_WORK_EMAIL_FROM || env.PYA_WORK_MAIL_FROM || `pyash@${os.hostname()}.local`);
}
