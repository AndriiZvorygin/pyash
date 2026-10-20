import { hostname, userInfo } from "node:os";

function text(value) {
  return String(value ?? "").trim();
}

function operatingUsername() {
  try {
    const username = text(userInfo().username);
    if (username) return username;
  } catch {
    // Fall back to the conventional environment variables in restricted runtimes.
  }
  return text(process.env.USER || process.env.LOGNAME);
}

export function resolveGpuSourceIdentity({ hostId = "", username = "" } = {}) {
  const resolvedHostId = text(hostId || process.env.PYA_GPU_HOST_ID) || hostname();
  const resolvedUsername = text(username || process.env.PYA_GPU_USERNAME) || operatingUsername();
  return {
    hostId: resolvedHostId,
    ...(resolvedUsername ? { username: resolvedUsername } : {}),
  };
}
