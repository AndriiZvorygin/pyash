import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import { JSDOM } from "jsdom";

const JOB_STATES = new Map([
  [3, "pending"],
  [4, "held"],
  [5, "processing"],
  [6, "stopped"],
  [7, "cancelled"],
  [8, "aborted"],
  [9, "completed"]
]);

function parseScalar(element) {
  if (!element) return null;
  if (element.tagName === "string" || element.tagName === "date") return element.textContent || "";
  if (element.tagName === "integer" || element.tagName === "real") return Number(element.textContent || 0);
  if (element.tagName === "true") return true;
  if (element.tagName === "false") return false;
  if (element.tagName === "array") return [...element.children].map(parseScalar);
  if (element.tagName === "dict") return parseDict(element);
  return element.textContent || "";
}

function parseDict(dict) {
  const value = {};
  const children = [...dict.children];
  for (let index = 0; index < children.length; index += 2) {
    const key = children[index]?.textContent || "";
    value[key] = parseScalar(children[index + 1]);
  }
  return value;
}

export function parseIpptoolPlist(xml = "") {
  const document = new JSDOM(String(xml), { contentType: "text/xml" }).window.document;
  const root = document.querySelector("plist > dict");
  return root ? parseDict(root) : {};
}

function responseAttributes(payload = {}) {
  const tests = Array.isArray(payload.Tests) ? payload.Tests : [];
  const test = tests.find((entry) => entry?.Operation === "Get-Job-Attributes") || tests[0] || {};
  const groups = Array.isArray(test.ResponseAttributes) ? test.ResponseAttributes : [];
  return groups.reduce((merged, group) => ({ ...merged, ...(group || {}) }), {});
}

async function withIpptoolFile(lines, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-print-"));
  const target = path.join(dir, "request.test");
  try {
    await fs.writeFile(target, `${lines.join("\n")}\n`, "utf8");
    return await callback(target);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function spawnCapture(binary, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function queryCupsJob(jobId, {
  ipptoolBinary = "/usr/bin/ipptool",
  server = "ipp://localhost"
} = {}) {
  const attributes = [
    "job-id", "job-name", "job-originating-user-name", "copies", "job-state",
    "job-state-reasons", "job-printer-uri", "sides", "media", "number-up",
    "print-color-mode", "job-impressions-completed",
    "job-media-sheets-completed", "job-impressions", "job-media-sheets",
    "date-time-at-creation", "date-time-at-completed"
  ];
  const lines = [
    "{",
    "  NAME \"Read print attributes\"",
    "  OPERATION Get-Job-Attributes",
    "  GROUP operation-attributes-tag",
    "  ATTR charset attributes-charset utf-8",
    "  ATTR language attributes-natural-language en",
    "  ATTR uri job-uri $uri",
    `  ATTR keyword requested-attributes ${attributes.join(",")}`,
    "  STATUS successful-ok",
    "}"
  ];
  return withIpptoolFile(lines, async (requestFile) => {
    const result = await spawnCapture(ipptoolBinary, ["-X", `${server}/jobs/${jobId}`, requestFile]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `ipptool exited ${result.code}`);
    return responseAttributes(parseIpptoolPlist(result.stdout));
  });
}

export async function createCupsSubscription({
  ipptoolBinary = "/usr/bin/ipptool",
  server = "ipp://localhost"
} = {}) {
  const lines = [
    "{",
    "  NAME \"Create print monitor subscription\"",
    "  OPERATION Create-Printer-Subscription",
    "  GROUP operation-attributes-tag",
    "  ATTR charset attributes-charset utf-8",
    "  ATTR language attributes-natural-language en",
    "  ATTR uri printer-uri $uri",
    "  GROUP subscription-attributes-tag",
    "  ATTR uri notify-recipient-uri dbus://",
    "  ATTR keyword notify-events job-created,job-state-changed,job-completed,job-stopped",
    "  ATTR integer notify-lease-duration 86400",
    "  STATUS successful-ok",
    "}"
  ];
  return withIpptoolFile(lines, async (requestFile) => {
    const result = await spawnCapture(ipptoolBinary, ["-X", `${server}/`, requestFile]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `ipptool exited ${result.code}`);
    return parseIpptoolPlist(result.stdout);
  });
}

function parseDbusString(line) {
  const raw = line.trim().replace(/^string\s+/u, "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"|"$/gu, "");
  }
}

export function parseDbusJobMessage(lines = []) {
  const header = String(lines[0] || "");
  const member = header.match(/member=([^\s]+)/u)?.[1] || "";
  const observedSeconds = Number(header.match(/time=([0-9.]+)/u)?.[1] || 0);
  if (!member.startsWith("Job")) return null;
  const values = [];
  for (const line of lines.slice(1)) {
    const trimmed = String(line).trim();
    if (trimmed.startsWith("string ")) values.push(parseDbusString(trimmed));
    else if (trimmed.startsWith("uint32 ")) values.push(Number(trimmed.slice(7)));
    else if (trimmed.startsWith("boolean ")) values.push(trimmed.slice(8) === "true");
  }
  if (values.length < 11) return null;
  const stateNumber = Number(values[7]);
  return {
    member,
    timestamp: observedSeconds ? new Date(observedSeconds * 1000).toISOString() : new Date().toISOString(),
    text: String(values[0] || ""),
    printerUri: String(values[1] || ""),
    printer: String(values[2] || ""),
    printerState: Number(values[3]) || 0,
    printerReasons: String(values[4] || ""),
    acceptingJobs: Boolean(values[5]),
    jobId: Number(values[6]) || 0,
    jobState: stateNumber,
    status: JOB_STATES.get(stateNumber)
      || (member === "JobCompleted" ? "completed"
      : member === "JobStopped" ? "stopped"
      : member === "JobCreated" ? "created"
      : "status"),
    jobReasons: String(values[8] || ""),
    title: String(values[9] || ""),
    impressions: Number(values[10]) || 0
  };
}

export function cupsStatusFromState(state) {
  return JOB_STATES.get(Number(state)) || "status";
}

export function parseLpstatJobs(text = "") {
  const jobs = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/u)) {
    const match = line.match(/^(\S+)-(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/u);
    if (!match) continue;
    const [, printer, id, user, size, dateText] = match;
    const key = `${printer}-${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const submittedAt = new Date(dateText);
    jobs.push({
      key,
      printer,
      jobId: Number(id),
      user,
      size: Number(size) || 0,
      timestamp: Number.isNaN(submittedAt.getTime()) ? "" : submittedAt.toISOString()
    });
  }
  return jobs;
}

export async function listCupsJobs({ lpstatBinary = "/usr/bin/lpstat" } = {}) {
  const result = await spawnCapture(lpstatBinary, ["-W", "all", "-o"], {
    env: { ...process.env, LC_ALL: "C" }
  });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `lpstat exited ${result.code}`);
  return parseLpstatJobs(result.stdout);
}

export function monitorDbusJobs(onEvent, {
  dbusMonitorBinary = "/usr/bin/dbus-monitor",
  stderr = process.stderr
} = {}) {
  const child = spawn(dbusMonitorBinary, [
    "--system",
    "type='signal',interface='org.cups.cupsd.Notifier',path='/org/cups/cupsd/Notifier'"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const reader = readline.createInterface({ input: child.stdout });
  let message = [];
  const flush = () => {
    if (!message.length) return;
    const event = parseDbusJobMessage(message);
    message = [];
    if (event) Promise.resolve(onEvent(event)).catch((err) => stderr.write(`Print monitor event failed: ${err?.message || err}\n`));
  };
  reader.on("line", (line) => {
    if (!line.trim()) {
      flush();
      return;
    }
    if (line.startsWith("signal ")) flush();
    message.push(line);
    if (message[0]?.includes("member=Job")) {
      const valueCount = message.slice(1).filter((value) => /^\s*(string|uint32|boolean)\s/u.test(value)).length;
      if (valueCount >= 11) flush();
    }
  });
  child.stdout.on("end", flush);
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  return child;
}

export function cupsEventDetails(event = {}, attributes = {}) {
  const printerUri = String(attributes["job-printer-uri"] || event.printerUri || "");
  const printer = event.printer || printerUri.split("/").pop() || "";
  const status = event.status || JOB_STATES.get(Number(attributes["job-state"])) || "status";
  const details = [
    `member=${event.member || ""}`,
    `state=${event.jobState ?? attributes["job-state"] ?? ""}`,
    `reasons=${event.jobReasons || attributes["job-state-reasons"] || ""}`,
    `impressions=${attributes["job-impressions-completed"] ?? event.impressions ?? 0}`,
    `sheets=${attributes["job-media-sheets-completed"] ?? 0}`,
    `sides=${attributes.sides || ""}`,
    `media=${attributes.media || ""}`,
    `number-up=${attributes["number-up"] ?? ""}`,
    `colour=${attributes["print-color-mode"] || ""}`
  ];
  const timestamp = String(event.timestamp || new Date().toISOString());
  const impressionsCompleted = Number(attributes["job-impressions-completed"] ?? event.impressions ?? 0);
  const sheetsCompleted = Number(attributes["job-media-sheets-completed"] ?? 0);
  const reliableZero = ["cancelled", "aborted", "stopped"].includes(status);
  return {
    status,
    printer,
    copies: Number(attributes.copies) || 0,
    title: String(attributes["job-name"] || event.title || ""),
    user: String(attributes["job-originating-user-name"] || event.user || ""),
    timestamp,
    ...(impressionsCompleted > 0 || reliableZero ? { printed_impressions_completed: impressionsCompleted } : {}),
    ...(sheetsCompleted > 0 || reliableZero ? { physical_sheets_completed: sheetsCompleted } : {}),
    details
  };
}
