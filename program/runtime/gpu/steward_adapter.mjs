function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeSegment(raw = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSpec(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  return String(raw);
}

function cloneValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  return {};
}

function createDefaultFakeTransport() {
  const activeServices = new Map();
  const jobs = new Map();

  return {
    async getSnapshot(payload = {}) {
      const hostId = normalizeSegment(payload.hostId);
      const services = [];
      for (const service of activeServices.values()) {
        if (service.hostId === hostId) services.push({ ...service });
      }
      const activeJobs = [];
      for (const job of jobs.values()) {
        if (job.hostId === hostId) activeJobs.push({ ...job });
      }
      return {
        hostId,
        telemetry: { ready: true },
        devices: [],
        activeServices: services,
        activeResidency: services.map((service) => ({
          hostId: service.hostId,
          deviceId: service.deviceId,
          serviceName: service.serviceName,
          residencyName: service.residencyName
        })),
        activeJobs
      };
    },

    async beginService(payload = {}) {
      const key = `${payload.hostId}:${payload.deviceId}:${payload.serviceName}`;
      const service = {
        hostId: payload.hostId,
        deviceId: payload.deviceId,
        serviceName: payload.serviceName,
        residencyName: payload.residencyName,
        beginSpec: cloneValue(payload.beginSpec),
        startedAt: new Date().toISOString()
      };
      activeServices.set(key, service);
      return {
        ok: true,
        hostId: payload.hostId,
        deviceId: payload.deviceId,
        serviceName: payload.serviceName,
        residencyName: payload.residencyName
      };
    },

    async dischargeService(payload = {}) {
      const key = `${payload.hostId}:${payload.deviceId}:${payload.serviceName}`;
      activeServices.delete(key);
      return {
        ok: true,
        hostId: payload.hostId,
        deviceId: payload.deviceId,
        serviceName: payload.serviceName,
        residencyName: payload.residencyName
      };
    },

    async submitJob(payload = {}) {
      const remoteJobId = normalizeText(payload.remoteJobId) || `${payload.handleId || "job"}-remote`;
      const job = {
        remoteJobId,
        hostId: payload.hostId,
        deviceId: payload.deviceId,
        serviceName: payload.serviceName,
        residencyName: payload.residencyName,
        handleId: payload.handleId,
        jobSpec: cloneValue(payload.jobSpec),
        status: "queued"
      };
      jobs.set(remoteJobId, job);
      return {
        ok: true,
        remoteJobId,
        status: "queued"
      };
    },

    async getJobStatus(payload = {}) {
      const remoteJobId = normalizeText(payload.remoteJobId);
      const job = jobs.get(remoteJobId);
      if (!job) {
        return {
          ok: false,
          remoteJobId,
          status: "unknown"
        };
      }
      return {
        ok: true,
        remoteJobId,
        status: job.status,
        hostId: job.hostId,
        deviceId: job.deviceId,
        serviceName: job.serviceName,
        residencyName: job.residencyName,
        handleId: job.handleId
      };
    }
  };
}

function resolveHostId(inputHostId = "", adapterHostId = "") {
  return normalizeSegment(inputHostId) || normalizeSegment(adapterHostId);
}

export function createGpuStewardAdapter({ hostId = "", transport = null } = {}) {
  const adapterHostId = normalizeSegment(hostId);
  const stewardTransport = transport ?? createDefaultFakeTransport();

  return {
    async getSnapshot({ hostId: callHostId = "" } = {}) {
      const payload = {
        hostId: resolveHostId(callHostId, adapterHostId)
      };
      return stewardTransport.getSnapshot(payload);
    },

    async beginService({
      hostId: callHostId = "",
      deviceId = "",
      serviceName = "",
      residencyName = "",
      beginSpec = {}
    } = {}) {
      const payload = {
        hostId: resolveHostId(callHostId, adapterHostId),
        deviceId: normalizeSegment(deviceId),
        serviceName: normalizeSegment(serviceName),
        residencyName: normalizeSegment(residencyName),
        beginSpec: normalizeSpec(beginSpec)
      };
      return stewardTransport.beginService(payload);
    },

    async dischargeService({
      hostId: callHostId = "",
      deviceId = "",
      serviceName = "",
      residencyName = ""
    } = {}) {
      const payload = {
        hostId: resolveHostId(callHostId, adapterHostId),
        deviceId: normalizeSegment(deviceId),
        serviceName: normalizeSegment(serviceName),
        residencyName: normalizeSegment(residencyName)
      };
      return stewardTransport.dischargeService(payload);
    },

    async submitJob({
      hostId: callHostId = "",
      deviceId = "",
      serviceName = "",
      residencyName = "",
      handleId = "",
      jobSpec = {}
    } = {}) {
      const payload = {
        hostId: resolveHostId(callHostId, adapterHostId),
        deviceId: normalizeSegment(deviceId),
        serviceName: normalizeSegment(serviceName),
        residencyName: normalizeSegment(residencyName),
        handleId: normalizeSegment(handleId),
        jobSpec: normalizeSpec(jobSpec)
      };
      return stewardTransport.submitJob(payload);
    },

    async getJobStatus({
      hostId: callHostId = "",
      deviceId = "",
      serviceName = "",
      remoteJobId = ""
    } = {}) {
      const payload = {
        hostId: resolveHostId(callHostId, adapterHostId),
        deviceId: normalizeSegment(deviceId),
        serviceName: normalizeSegment(serviceName),
        remoteJobId: normalizeText(remoteJobId)
      };
      return stewardTransport.getJobStatus(payload);
    }
  };
}
