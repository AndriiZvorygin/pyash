import fs from "node:fs/promises";
import path from "node:path";

import { ensureAndroidQueueDirs } from "../android_core/queue.mjs";

function quoteText(value) {
  return JSON.stringify(String(value ?? ""));
}

function parseQuoted(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function mapBlock(name, entries) {
  const lines = [`su name ${name} be map def`];
  for (const entry of entries) {
    lines.push(`  su name ${entry.key} ob ${entry.type} ${entry.value} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function parseMapEntries(body) {
  const entries = [];
  for (const raw of String(body ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^su name (.+?) ob (bool|num|text|filename) (.+?) ya$/i);
    if (!match) continue;
    entries.push({ key: String(match[1]).trim(), valueRaw: String(match[3]).trim() });
  }
  return entries;
}

function parseLeaseText(text = "") {
  const match = String(text ?? "").match(/su name android device lease be map def\n([\s\S]*?)\nprah/);
  if (!match) return null;
  const entries = parseMapEntries(match[1]);
  const out = {
    deviceId: "",
    owner: "",
    commandId: "",
    acquiredAt: "",
    heartbeatAt: ""
  };
  for (const entry of entries) {
    if (entry.key === "device id") out.deviceId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "owner") out.owner = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "command id") out.commandId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "acquired at") out.acquiredAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "heartbeat at") out.heartbeatAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
  }
  return out;
}

function toLeaseText(lease = {}) {
  const entries = [
    { key: "device id", type: "text", value: quoteText(lease.deviceId || "") },
    { key: "owner", type: "text", value: quoteText(lease.owner || "") },
    { key: "command id", type: "text", value: quoteText(lease.commandId || "") },
    { key: "acquired at", type: "text", value: quoteText(lease.acquiredAt || "") },
    { key: "heartbeat at", type: "text", value: quoteText(lease.heartbeatAt || "") }
  ];
  return `${mapBlock("android device lease", entries)}\n`;
}

function sanitizeDeviceId(raw = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "device";
}

function nowIso() {
  return new Date().toISOString();
}

function toMs(iso) {
  const value = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(value)) return 0;
  return value;
}

async function leaseDir(worldRoot) {
  const queue = await ensureAndroidQueueDirs(worldRoot);
  const dir = path.join(queue.runtimeDir, "lease");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function leasePath(worldRoot, deviceId) {
  const dir = await leaseDir(worldRoot);
  return path.join(dir, `${sanitizeDeviceId(deviceId)}.pya`);
}

async function readLease(worldRoot, deviceId) {
  const target = await leasePath(worldRoot, deviceId);
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = parseLeaseText(text);
    return parsed ? { ...parsed, path: target } : null;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function acquireAndroidDeviceLease(worldRoot, {
  deviceId,
  owner = "android-input",
  commandId = "",
  ttlMs = 30000
} = {}) {
  const selectedDevice = String(deviceId ?? "").trim();
  if (!selectedDevice) return { acquired: false, reason: "missing_device" };
  const selectedOwner = String(owner ?? "").trim() || "android-input";
  const selectedCommandId = String(commandId ?? "").trim();
  const ttl = Math.max(1000, Math.trunc(Number(ttlMs) || 30000));
  const target = await leasePath(worldRoot, selectedDevice);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(target, "wx");
      const now = nowIso();
      const lease = {
        deviceId: selectedDevice,
        owner: selectedOwner,
        commandId: selectedCommandId,
        acquiredAt: now,
        heartbeatAt: now
      };
      await handle.writeFile(toLeaseText(lease), "utf8");
      await handle.close();
      return { acquired: true, lease };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      const existing = await readLease(worldRoot, selectedDevice);
      if (!existing) continue;
      const heartbeatMs = toMs(existing.heartbeatAt || existing.acquiredAt);
      const stale = heartbeatMs <= 0 || (Date.now() - heartbeatMs) > ttl;
      if (!stale) {
        return { acquired: false, reason: "busy", lease: existing };
      }
      await fs.rm(target, { force: true }).catch(() => {});
    }
  }

  return { acquired: false, reason: "busy" };
}

export async function heartbeatAndroidDeviceLease(worldRoot, {
  deviceId,
  owner = "",
  commandId = ""
} = {}) {
  const selectedDevice = String(deviceId ?? "").trim();
  if (!selectedDevice) return null;
  const existing = await readLease(worldRoot, selectedDevice);
  if (!existing) return null;
  if (owner && existing.owner && owner !== existing.owner) return null;
  if (commandId && existing.commandId && commandId !== existing.commandId) return null;
  const next = {
    ...existing,
    heartbeatAt: nowIso()
  };
  const target = await leasePath(worldRoot, selectedDevice);
  await fs.writeFile(target, toLeaseText(next), "utf8");
  return next;
}

export async function releaseAndroidDeviceLease(worldRoot, {
  deviceId,
  owner = "",
  commandId = ""
} = {}) {
  const selectedDevice = String(deviceId ?? "").trim();
  if (!selectedDevice) return false;
  const existing = await readLease(worldRoot, selectedDevice);
  if (!existing) return false;
  if (owner && existing.owner && owner !== existing.owner) return false;
  if (commandId && existing.commandId && commandId !== existing.commandId) return false;
  const target = await leasePath(worldRoot, selectedDevice);
  await fs.rm(target, { force: true }).catch(() => {});
  return true;
}
