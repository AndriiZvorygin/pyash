import { createGpuHousekeeperAdapter } from "./housekeeper_adapter.mjs";

export const MAX_GPU_WORKER_CONCURRENCY = 64;

function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function parseGpuWorkerConcurrencyOverride(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return Math.min(MAX_GPU_WORKER_CONCURRENCY, parsed);
}

export function resolveGpuWorkerConcurrency({ requested, discoveredDeviceSlots = 1 } = {}) {
  const override = parseGpuWorkerConcurrencyOverride(requested);
  if (override !== undefined) return override;
  const discovered = Number(discoveredDeviceSlots);
  const safeDiscovered = Number.isFinite(discovered) && discovered > 0
    ? Math.trunc(discovered)
    : 1;
  return Math.max(1, Math.min(MAX_GPU_WORKER_CONCURRENCY, safeDiscovered));
}

function devicesForSnapshot(snapshot) {
  if (Array.isArray(snapshot?.devices) && snapshot.devices.length) {
    return snapshot.devices
      .map((device) => normalizeText(device?.deviceId))
      .filter(Boolean);
  }
  if (Array.isArray(snapshot?.executionSlots)) {
    return snapshot.executionSlots
      .map((slot) => normalizeText(slot?.deviceId))
      .filter(Boolean);
  }
  return [];
}

export async function discoverGpuWorkerCapacity({
  housekeeperUrl = "",
  adapterFactory = createGpuHousekeeperAdapter,
  timeoutMs = 3000
} = {}) {
  const rootUrl = normalizeText(housekeeperUrl);
  if (!rootUrl) throw new Error("gpu worker capacity defective: housekeeperUrl is required");

  const rootSnapshot = await adapterFactory({ baseUrl: rootUrl }).getSnapshot({ timeoutMs });
  const peers = Array.isArray(rootSnapshot?.federation?.peers)
    ? rootSnapshot.federation.peers
    : [];
  const peerSnapshots = await Promise.all(peers.map(async (peer) => {
    const peerUrl = normalizeText(peer?.url);
    if (!peerUrl) return null;
    try {
      const snapshot = await adapterFactory({ baseUrl: peerUrl }).getSnapshot({ timeoutMs });
      return { snapshot, fallbackHostId: normalizeText(peer?.hostId) };
    } catch {
      return null;
    }
  }));

  const snapshots = [
    { snapshot: rootSnapshot, fallbackHostId: "entry" },
    ...peerSnapshots.filter(Boolean)
  ];
  const slots = new Set();
  const hosts = new Set();
  for (const { snapshot, fallbackHostId } of snapshots) {
    const hostId = normalizeText(snapshot?.hostId) || fallbackHostId;
    hosts.add(hostId);
    for (const deviceId of devicesForSnapshot(snapshot)) {
      slots.add(`${hostId}:${deviceId}`);
    }
  }

  return {
    deviceSlots: slots.size,
    hostCount: hosts.size,
    reachablePeerCount: snapshots.length - 1
  };
}
