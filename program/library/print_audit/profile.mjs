import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { parseIpptoolPlist } from "./cups.mjs";

export const DEFAULT_PRINTER_PROFILE_PATH = path.join(os.homedir(), ".config", "pyash", "printer-profiles.json");

function capture(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function sanitizeDeviceUri(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const uri = new URL(text);
    uri.username = "";
    uri.password = "";
    uri.search = "";
    uri.hash = "";
    return uri.toString().replace(/\/$/u, text.endsWith("/") ? "/" : "");
  } catch {
    return text.replace(/\/\/[^/@\s]+@/u, "//").replace(/[?#].*$/u, "");
  }
}

export function cupsServerHost(server = "ipp://localhost") {
  try { return new URL(server).host || "localhost"; } catch { return String(server || "localhost"); }
}

export async function loadPrinterProfiles(filePath = process.env.PYA_PRINTER_PROFILE_PATH || DEFAULT_PRINTER_PROFILE_PATH) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return { path: filePath, profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [] };
  } catch (err) {
    if (err?.code === "ENOENT") return { path: filePath, profiles: [] };
    throw err;
  }
}

function profileScore(profile, identity) {
  const match = profile.match || {};
  let score = 0;
  if (match.printer_uuid && match.printer_uuid === identity.printer_uuid) score += 1000;
  if (match.printer_serial && match.printer_serial === identity.printer_serial) score += 1000;
  if (match.device_uri_pattern && new RegExp(match.device_uri_pattern, "iu").test(identity.device_uri || "")) score += 500;
  if (match.make_model_pattern && new RegExp(match.make_model_pattern, "iu").test(identity.printer_make_model || "")) score += 100;
  if ((profile.queues || []).includes(identity.cups_queue)) score += 10;
  return score;
}

export function resolvePrinterProfile(profiles = [], identity = {}, timestamp = new Date().toISOString()) {
  const when = Date.parse(timestamp) || Date.now();
  return profiles
    .filter((profile) => !profile.effective_date || Date.parse(profile.effective_date) <= when)
    .map((profile) => ({ profile, score: profileScore(profile, identity) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.profile.effective_date || 0) - Date.parse(a.profile.effective_date || 0))[0]?.profile || null;
}

function responseAttributes(payload = {}) {
  const test = (payload.Tests || []).find((item) => item?.Operation === "Get-Printer-Attributes") || payload.Tests?.[0] || {};
  return (test.ResponseAttributes || []).reduce((all, group) => ({ ...all, ...(group || {}) }), {});
}

async function queryPrinterAttributes(queue, server, ipptoolBinary) {
  const request = [
    "{", " NAME \"Read printer identity\"", " OPERATION Get-Printer-Attributes",
    " GROUP operation-attributes-tag", " ATTR charset attributes-charset utf-8",
    " ATTR language attributes-natural-language en", " ATTR uri printer-uri $uri",
    " ATTR keyword requested-attributes printer-make-and-model,printer-uuid,printer-serial-number,printer-device-id,printer-uri-supported",
    " STATUS successful-ok", "}"
  ].join("\n");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-printer-"));
  const requestFile = path.join(dir, "identity.test");
  try {
    await fs.writeFile(requestFile, `${request}\n`, "utf8");
    const result = await capture(ipptoolBinary, ["-X", `${server}/printers/${encodeURIComponent(queue)}`, requestFile]);
    if (result.code !== 0) return {};
    return responseAttributes(parseIpptoolPlist(result.stdout));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function queueDeviceUri(queue, lpstatBinary) {
  const result = await capture(lpstatBinary, ["-v", queue]);
  return String(result.stdout.match(/:\s+(.+)$/mu)?.[1] || "").trim();
}

export async function defaultCupsQueue(lpstatBinary = "/usr/bin/lpstat") {
  const result = await capture(lpstatBinary, ["-d"]);
  return result.stdout.match(/:\s*(\S+)/u)?.[1] || "";
}

export async function discoverPrinterIdentity(queue = "", {
  server = process.env.PYA_CUPS_SERVER || "ipp://localhost",
  ipptoolBinary = "/usr/bin/ipptool",
  lpstatBinary = "/usr/bin/lpstat"
} = {}) {
  const cupsQueue = queue || await defaultCupsQueue(lpstatBinary);
  if (!cupsQueue) return { cups_queue: "", cups_server: cupsServerHost(server) };
  const [attributes, rawDeviceUri] = await Promise.all([
    queryPrinterAttributes(cupsQueue, server, ipptoolBinary).catch(() => ({})),
    queueDeviceUri(cupsQueue, lpstatBinary).catch(() => "")
  ]);
  const deviceUri = sanitizeDeviceUri(rawDeviceUri);
  const deviceId = String(attributes["printer-device-id"] || "");
  const serialFromDevice = deviceId.match(/(?:SERIALNUMBER|SN):([^;]+)/iu)?.[1] || "";
  const serialFromUri = (() => { try { return new URL(rawDeviceUri).searchParams.get("serial") || ""; } catch { return ""; } })();
  return {
    cups_queue: cupsQueue,
    printer_make_model: String(attributes["printer-make-and-model"] || ""),
    printer_uuid: String(attributes["printer-uuid"] || ""),
    printer_serial: String(attributes["printer-serial-number"] || serialFromDevice || serialFromUri),
    device_uri: deviceUri,
    cups_server: cupsServerHost(server)
  };
}

export function profileSnapshot(profile = null) {
  if (!profile) return null;
  return JSON.parse(JSON.stringify(profile));
}
