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

export function resolveGpuWorkerConcurrency({ requested, discoveredDispatchSlots = 1 } = {}) {
  const override = parseGpuWorkerConcurrencyOverride(requested);
  if (override !== undefined) return override;
  const discovered = Number(discoveredDispatchSlots);
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
  const rootHostId = normalizeText(rootSnapshot?.hostId) || "entry";
  const localSlots = new Set(devicesForSnapshot(rootSnapshot).map((deviceId) => `${rootHostId}:${deviceId}`));
  const peerHostIds = new Set(peers
    .filter((peer) => normalizeText(peer?.url))
    .map((peer) => normalizeText(peer?.hostId))
    .filter((hostId) => hostId && hostId !== rootHostId));

  return {
    dispatchSlots: localSlots.size + peerHostIds.size,
    hostCount: 1 + peerHostIds.size,
    configuredPeerCount: peerHostIds.size,
    localDeviceSlots: localSlots.size
  };
}
