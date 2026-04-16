function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeSegment(raw = "", { allowColon = false, fallback = "" } = {}) {
  const pattern = allowColon ? /[^a-z0-9._:-]+/g : /[^a-z0-9._-]+/g;
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(pattern, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || String(fallback ?? "");
}

function normalizeIso(raw, fallbackIso = new Date().toISOString()) {
  const text = normalizeText(raw);
  const ms = Date.parse(text);
  if (text && Number.isFinite(ms)) return new Date(ms).toISOString();
  return String(fallbackIso);
}

function normalizeCount(raw, fallback = 0) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(value));
}

function normalizeBool(raw, fallback = false) {
  if (raw === true || raw === false) return raw;
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(value)) return true;
    if (["false", "no", "0", "off"].includes(value)) return false;
  }
  if (typeof raw === "number") return raw !== 0;
  return fallback;
}

function normalizeSpecValue(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  throw new Error("gpu queue envelope defective: spec must be map or text");
}

function assertNormalizedOptionalSegment(value, label) {
  const text = normalizeText(value);
  if (!text) return;
  if (normalizeSegment(text) !== text.toLowerCase()) {
    throw new Error(`gpu queue envelope defective: invalid ${label}`);
  }
}

export function normalizeGpuId(raw = "") {
  return normalizeSegment(raw, { allowColon: true, fallback: "" });
}

export function normalizeLane(raw = "", fallback = "durable") {
  const normalized = normalizeSegment(raw, { allowColon: false, fallback: "" });
  if (normalized) return normalized;
  const fallbackLane = normalizeSegment(fallback, { allowColon: false, fallback: "durable" });
  return fallbackLane || "durable";
}

export function normalizeHandleId(raw = "") {
  return normalizeSegment(raw, { allowColon: false, fallback: "" });
}

export function buildGpuQueueEnvelope(input = {}) {
  const payloadSentence = input?.payloadSentence && typeof input.payloadSentence === "object"
    ? input.payloadSentence
    : null;
  return {
    handleId: normalizeHandleId(input?.handleId ?? input?.payloadId ?? ""),
    agentName: normalizeText(input?.agentName),
    gpuId: normalizeGpuId(input?.gpuId),
    intent: normalizeText(input?.intent).toLowerCase(),
    lane: normalizeLane(input?.lane, "durable"),
    queuedAt: normalizeIso(input?.queuedAt),
    retryCount: normalizeCount(input?.retryCount, 0),
    payloadSentence,
    hostId: normalizeSegment(input?.hostId, { fallback: "" }),
    deviceId: normalizeSegment(input?.deviceId, { fallback: "" }),
    serviceName: normalizeSegment(input?.serviceName, { fallback: "" }),
    residencyName: normalizeSegment(input?.residencyName, { fallback: "" }),
    residencyRequired: normalizeBool(input?.residencyRequired, false),
    beginRequired: normalizeBool(input?.beginRequired, false),
    dischargeAllowed: normalizeBool(input?.dischargeAllowed, true),
    beginSpec: normalizeSpecValue(input?.beginSpec),
    jobSpec: normalizeSpecValue(input?.jobSpec),
    remoteJobId: normalizeText(input?.remoteJobId)
  };
}

export function assertGpuQueueEnvelope(value = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("gpu queue envelope defective: envelope must be object");
  }
  if (!normalizeHandleId(value.handleId)) {
    throw new Error("gpu queue envelope defective: missing handle id");
  }
  if (!normalizeText(value.agentName)) {
    throw new Error("gpu queue envelope defective: missing agent name");
  }
  if (!normalizeGpuId(value.gpuId)) {
    throw new Error("gpu queue envelope defective: missing gpu id");
  }
  if (!normalizeText(value.intent)) {
    throw new Error("gpu queue envelope defective: missing intent");
  }
  if (!normalizeLane(value.lane, "")) {
    throw new Error("gpu queue envelope defective: missing lane");
  }
  if (!normalizeText(value.queuedAt) || !Number.isFinite(Date.parse(String(value.queuedAt)))) {
    throw new Error("gpu queue envelope defective: invalid queued at");
  }
  const retryCount = Number(value.retryCount);
  if (!Number.isFinite(retryCount) || retryCount < 0 || Math.trunc(retryCount) !== retryCount) {
    throw new Error("gpu queue envelope defective: invalid retry count");
  }
  if (!value.payloadSentence || typeof value.payloadSentence !== "object") {
    throw new Error("gpu queue envelope defective: missing payload sentence");
  }

  assertNormalizedOptionalSegment(value.hostId, "host id");
  assertNormalizedOptionalSegment(value.deviceId, "device id");
  assertNormalizedOptionalSegment(value.serviceName, "service name");
  assertNormalizedOptionalSegment(value.residencyName, "residency name");

  if (typeof value.residencyRequired !== "boolean") {
    throw new Error("gpu queue envelope defective: invalid residency required");
  }
  if (typeof value.beginRequired !== "boolean") {
    throw new Error("gpu queue envelope defective: invalid begin required");
  }
  if (typeof value.dischargeAllowed !== "boolean") {
    throw new Error("gpu queue envelope defective: invalid discharge allowed");
  }

  if (!(typeof value.beginSpec === "string" || (value.beginSpec && typeof value.beginSpec === "object" && !Array.isArray(value.beginSpec)))) {
    throw new Error("gpu queue envelope defective: invalid begin spec");
  }
  if (!(typeof value.jobSpec === "string" || (value.jobSpec && typeof value.jobSpec === "object" && !Array.isArray(value.jobSpec)))) {
    throw new Error("gpu queue envelope defective: invalid job spec");
  }

  const remoteJobId = value.remoteJobId;
  if (!(remoteJobId == null || typeof remoteJobId === "string")) {
    throw new Error("gpu queue envelope defective: invalid remote job id");
  }
}

export function buildGpuHandleStatus(input = {}) {
  const status = normalizeText(input?.status).toLowerCase() || "queued";
  return {
    handleId: normalizeHandleId(input?.handleId),
    agentName: normalizeText(input?.agentName),
    gpuId: normalizeGpuId(input?.gpuId),
    intent: normalizeText(input?.intent).toLowerCase(),
    lane: normalizeLane(input?.lane, "durable"),
    status,
    queuedAt: normalizeText(input?.queuedAt),
    startedAt: normalizeText(input?.startedAt),
    finishedAt: normalizeText(input?.finishedAt),
    retryCount: normalizeCount(input?.retryCount, 0),
    outcome: normalizeText(input?.outcome).toLowerCase(),
    message: normalizeText(input?.message)
  };
}

export function assertGpuHandleStatus(value = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("gpu handle status defective: value must be object");
  }
  if (!normalizeHandleId(value.handleId)) {
    throw new Error("gpu handle status defective: missing handle id");
  }
  const status = normalizeText(value.status).toLowerCase();
  if (!status) {
    throw new Error("gpu handle status defective: missing status");
  }
  if (!["queued", "running", "success", "fail"].includes(status)) {
    throw new Error("gpu handle status defective: invalid status");
  }
  if (!normalizeText(value.agentName)) {
    throw new Error("gpu handle status defective: missing agent name");
  }
  if (!normalizeGpuId(value.gpuId)) {
    throw new Error("gpu handle status defective: missing gpu id");
  }
  if (!normalizeText(value.intent)) {
    throw new Error("gpu handle status defective: missing intent");
  }
  if (!normalizeLane(value.lane, "")) {
    throw new Error("gpu handle status defective: missing lane");
  }
  if (!normalizeText(value.queuedAt) || !Number.isFinite(Date.parse(String(value.queuedAt)))) {
    throw new Error("gpu handle status defective: invalid queued at");
  }
  const startedAt = normalizeText(value.startedAt);
  const finishedAt = normalizeText(value.finishedAt);
  if (startedAt && !Number.isFinite(Date.parse(startedAt))) {
    throw new Error("gpu handle status defective: invalid started at");
  }
  if (finishedAt && !Number.isFinite(Date.parse(finishedAt))) {
    throw new Error("gpu handle status defective: invalid finished at");
  }
  const retryCount = Number(value.retryCount);
  if (!Number.isFinite(retryCount) || retryCount < 0 || Math.trunc(retryCount) !== retryCount) {
    throw new Error("gpu handle status defective: invalid retry count");
  }
  if (value.outcome == null || typeof value.outcome !== "string") {
    throw new Error("gpu handle status defective: invalid outcome");
  }
  if (value.message == null || typeof value.message !== "string") {
    throw new Error("gpu handle status defective: invalid message");
  }
}

export function buildGpuHealthSnapshot(input = {}) {
  return {
    healthy: input?.healthy !== false,
    statusText: normalizeText(input?.statusText) || "ready",
    queueDepth: normalizeCount(input?.queueDepth, 0),
    activeMode: normalizeText(input?.activeMode),
    leaseCount: normalizeCount(input?.leaseCount, 0),
    workerSeenAt: normalizeText(input?.workerSeenAt),
    updatedAt: normalizeIso(input?.updatedAt)
  };
}

export function assertGpuHealthSnapshot(value = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("gpu health defective: value must be object");
  }
  if (typeof value.healthy !== "boolean") {
    throw new Error("gpu health defective: healthy must be bool");
  }
  if (!normalizeText(value.statusText)) {
    throw new Error("gpu health defective: missing status text");
  }
  const queueDepth = Number(value.queueDepth);
  if (!Number.isFinite(queueDepth) || queueDepth < 0 || Math.trunc(queueDepth) !== queueDepth) {
    throw new Error("gpu health defective: invalid queue depth");
  }
  const leaseCount = Number(value.leaseCount);
  if (!Number.isFinite(leaseCount) || leaseCount < 0 || Math.trunc(leaseCount) !== leaseCount) {
    throw new Error("gpu health defective: invalid lease count");
  }
  if (!normalizeText(value.updatedAt) || !Number.isFinite(Date.parse(String(value.updatedAt)))) {
    throw new Error("gpu health defective: invalid updated at");
  }
}

export function buildGpuPhaseSentence({ phase = "all", result = {} } = {}) {
  const received = normalizeCount(result?.received, 0);
  const handled = normalizeCount(result?.handled, 0);
  const sent = normalizeCount(result?.sent, 0);
  const queue = normalizeCount(result?.queueDepth, 0);
  return {
    mood: "ya",
    su: { name: "gpu runtime" },
    be: "gpu command",
    vyah: { name: "status" },
    as: { name: normalizeText(phase).toLowerCase() || "all" },
    ob: { text: `received=${received} handled=${handled} sent=${sent} queue=${queue}` },
    to: { num: queue }
  };
}
