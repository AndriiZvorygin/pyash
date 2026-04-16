import fs from "node:fs/promises";
import path from "node:path";

import { ensureGpuQueueDirs } from "./queue.mjs";
import { normalizeGpuId, normalizeHandleId } from "./contract.mjs";

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
  const match = String(text ?? "").match(/su name gpu lease be map def\n([\s\S]*?)\nprah/);
  if (!match) return null;
  const entries = parseMapEntries(match[1]);
  const out = {
    gpuId: "",
    owner: "",
    handleId: "",
    acquiredAt: "",
    heartbeatAt: "",
    ttlMs: 30000
  };
  for (const entry of entries) {
    if (entry.key === "gpu id") out.gpuId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "owner") out.owner = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "handle id") out.handleId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "acquired at") out.acquiredAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "heartbeat at") out.heartbeatAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "ttl ms") {
      const ttl = Number(entry.valueRaw);
      out.ttlMs = Number.isFinite(ttl) ? Math.max(1000, Math.trunc(ttl)) : 30000;
    }
  }
  return out;
}

function toLeaseText(lease = {}) {
  const entries = [
    { key: "gpu id", type: "text", value: quoteText(lease.gpuId || "") },
    { key: "owner", type: "text", value: quoteText(lease.owner || "") },
    { key: "handle id", type: "text", value: quoteText(lease.handleId || "") },
    { key: "acquired at", type: "text", value: quoteText(lease.acquiredAt || "") },
    { key: "heartbeat at", type: "text", value: quoteText(lease.heartbeatAt || "") },
    { key: "ttl ms", type: "num", value: Math.max(1000, Math.trunc(Number(lease.ttlMs) || 30000)) }
  ];
  return `${mapBlock("gpu lease", entries)}\n`;
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
  const queue = await ensureGpuQueueDirs(worldRoot);
  const dir = path.join(queue.runtimeDir, "lease");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function leasePath(worldRoot, gpuId) {
  const dir = await leaseDir(worldRoot);
  return path.join(dir, `${normalizeGpuId(gpuId) || "gpu"}.pya`);
}

async function readLeaseFile(worldRoot, gpuId) {
  const normalizedGpuId = normalizeGpuId(gpuId);
  if (!normalizedGpuId) return null;
  const target = await leasePath(worldRoot, normalizedGpuId);
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = parseLeaseText(text);
    return parsed ? { ...parsed, path: target } : null;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function readGpuLease(worldRoot, { gpuId = "" } = {}) {
  return readLeaseFile(worldRoot, gpuId);
}

export async function acquireGpuLease(worldRoot, {
  gpuId = "",
  owner = "gpu-worker",
  handleId = "",
  ttlMs = 30000
} = {}) {
  const selectedGpuId = normalizeGpuId(gpuId);
  if (!selectedGpuId) return { acquired: false, reason: "missing_gpu" };
  const selectedOwner = String(owner ?? "").trim() || "gpu-worker";
  const selectedHandleId = normalizeHandleId(handleId);
  const selectedTtlMs = Math.max(1000, Math.trunc(Number(ttlMs) || 30000));
  const target = await leasePath(worldRoot, selectedGpuId);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(target, "wx");
      const now = nowIso();
      const lease = {
        gpuId: selectedGpuId,
        owner: selectedOwner,
        handleId: selectedHandleId,
        acquiredAt: now,
        heartbeatAt: now,
        ttlMs: selectedTtlMs
      };
      await handle.writeFile(toLeaseText(lease), "utf8");
      await handle.close();
      return { acquired: true, lease };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      const existing = await readLeaseFile(worldRoot, selectedGpuId);
      if (!existing) continue;
      const existingTtl = Math.max(1000, Math.trunc(Number(existing.ttlMs) || selectedTtlMs));
      const heartbeatMs = toMs(existing.heartbeatAt || existing.acquiredAt);
      const stale = heartbeatMs <= 0 || (Date.now() - heartbeatMs) > existingTtl;
      if (!stale) {
        const sameOwner = existing.owner === selectedOwner;
        const sameHandle = !selectedHandleId || !existing.handleId || existing.handleId === selectedHandleId;
        if (sameOwner && sameHandle) {
          return { acquired: true, lease: existing };
        }
        return { acquired: false, reason: "busy", lease: existing };
      }
      await fs.rm(target, { force: true }).catch(() => {});
    }
  }

  return { acquired: false, reason: "busy" };
}

export async function heartbeatGpuLease(worldRoot, {
  gpuId = "",
  owner = "",
  handleId = ""
} = {}) {
  const selectedGpuId = normalizeGpuId(gpuId);
  const selectedOwner = String(owner ?? "").trim();
  const selectedHandleId = normalizeHandleId(handleId);
  if (!selectedGpuId || !selectedOwner) return null;
  const existing = await readLeaseFile(worldRoot, selectedGpuId);
  if (!existing) return null;
  if (existing.owner !== selectedOwner) return null;
  if (selectedHandleId && existing.handleId && selectedHandleId !== existing.handleId) return null;
  const next = {
    ...existing,
    heartbeatAt: nowIso()
  };
  const target = await leasePath(worldRoot, selectedGpuId);
  await fs.writeFile(target, toLeaseText(next), "utf8");
  return next;
}

export async function releaseGpuLease(worldRoot, {
  gpuId = "",
  owner = "",
  handleId = ""
} = {}) {
  const selectedGpuId = normalizeGpuId(gpuId);
  const selectedOwner = String(owner ?? "").trim();
  const selectedHandleId = normalizeHandleId(handleId);
  if (!selectedGpuId || !selectedOwner) return false;
  const existing = await readLeaseFile(worldRoot, selectedGpuId);
  if (!existing) return false;
  if (existing.owner !== selectedOwner) return false;
  if (selectedHandleId && existing.handleId && selectedHandleId !== existing.handleId) return false;
  const target = await leasePath(worldRoot, selectedGpuId);
  await fs.rm(target, { force: true }).catch(() => {});
  return true;
}
