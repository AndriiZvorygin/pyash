import path from "node:path";

function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function sanitizeName(raw, fallback = "log") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function worldRootFromAgentHouse(agentHouse) {
  const houseDir = path.dirname(String(agentHouse ?? ""));
  return path.dirname(houseDir);
}

export function worldNewspaperLogPath({ worldRoot, name, now = new Date() } = {}) {
  const stamp = dayStamp(now);
  const base = sanitizeName(name, "log");
  return path.join(String(worldRoot), "newspaper", `${stamp}-${base}.pya`);
}

