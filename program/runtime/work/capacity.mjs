import { spawnCodexAppServer } from "../codex/app_server.mjs";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function resetAt(source) {
  const value = source.resetAt ?? source.resetsAt ?? source.reset_at ?? source.resetTime ?? source.reset_time;
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function normalizeCodexCapacity(payload, { now = new Date() } = {}) {
  const outer = payload?.limits && typeof payload.limits === "object" ? payload.limits : payload;
  const raw = outer?.rateLimits && typeof outer.rateLimits === "object" ? outer.rateLimits : outer;
  const primary = firstObject(raw?.primary, raw?.hourly, raw?.current, raw?.rateLimit, raw);
  const usedPercent = number(primary.usedPercent ?? primary.used_percentage ?? raw?.usedPercent);
  const explicitRemainingPercent = number(
    primary.remainingPercent ?? primary.remaining_percentage ?? raw?.remainingPercent
  );
  const limit = number(primary.limit ?? primary.max ?? raw?.limit);
  const remaining = number(primary.remaining ?? primary.remainingTokens ?? raw?.remaining);
  const remainingPercent = explicitRemainingPercent != null
    ? explicitRemainingPercent
    : usedPercent != null
      ? Math.max(0, 100 - usedPercent)
      : limit != null && remaining != null && limit > 0
        ? Math.max(0, Math.min(100, (remaining / limit) * 100))
        : null;
  const reset = resetAt(primary) || resetAt(raw);
  const windowMinutes = number(
    primary.windowMinutes ?? primary.window_minutes ?? primary.windowDurationMins
      ?? raw?.windowMinutes ?? raw?.window_duration_mins
  );
  const limited = Boolean(
    raw?.usageLimited || raw?.usage_limited || raw?.limited || primary?.usageLimited
  ) || Boolean(raw?.rateLimitReachedType || raw?.spendControlReached) || remainingPercent === 0;
  const available = limited ? false : remainingPercent != null ? remainingPercent > 0 : null;
  const observedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    state: limited ? "usage-limited" : available === true ? "available" : "unknown",
    available,
    usedPercent,
    remainingPercent,
    remaining,
    limit,
    resetAt: reset,
    windowMinutes,
    observedAt,
    raw: raw && typeof raw === "object" ? raw : {}
  };
}

export async function readCodexCapacity({
  appServerFactory = ({}) => spawnCodexAppServer({}),
  now = new Date(),
  timeoutMs = 15000
} = {}) {
  let client;
  try {
    client = await appServerFactory({ role: "capacity" });
    const limits = await client.request("account/rateLimits/read", {}, { timeoutMs });
    return normalizeCodexCapacity(limits, { now });
  } catch (error) {
    return {
      ...normalizeCodexCapacity({}, { now }),
      state: "unknown",
      available: null,
      error: text(error?.message || error)
    };
  } finally {
    try {
      await client?.close?.();
    } catch {}
  }
}

export const DEFAULT_BACKGROUND_POLICY = Object.freeze({
  enabled: false,
  reservePercent: 20,
  nearResetWilling: false,
  nearResetMinutes: 15,
  pollIntervalMs: 60000,
  maxTasksPerWake: 1
});

function resetIsNear(capacity, now, minutes) {
  const reset = Date.parse(String(capacity?.resetAt || ""));
  if (!Number.isFinite(reset)) return false;
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return reset >= current && reset - current <= Math.max(0, Number(minutes) || 0) * 60000;
}

export function admitBackgroundWork({
  capacity,
  policy = {},
  foregroundActive = false,
  hasEligibleWork = true,
  now = new Date()
} = {}) {
  const settings = { ...DEFAULT_BACKGROUND_POLICY, ...policy };
  if (settings.enabled !== true) return { admit: false, reason: "background disabled" };
  if (foregroundActive) return { admit: false, reason: "active task conflict" };
  if (!hasEligibleWork) return { admit: false, reason: "no eligible work" };
  if (capacity?.state === "usage-limited") return { admit: false, reason: "usage limited" };
  if (capacity?.state !== "available") return { admit: false, reason: "capacity unknown" };
  if (resetIsNear(capacity, now, settings.nearResetMinutes)
    && settings.nearResetWilling === true
    && (capacity.remainingPercent == null || capacity.remainingPercent > 0)) {
    return { admit: true, reason: "capacity near reset" };
  }
  if (capacity.remainingPercent == null) return { admit: false, reason: "capacity unknown" };
  if (capacity.remainingPercent <= Number(settings.reservePercent)) {
    return { admit: false, reason: "foreground reserve" };
  }
  return { admit: true, reason: "capacity above reserve" };
}
