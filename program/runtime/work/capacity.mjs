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

const WEEK_MINUTES = 7 * 24 * 60;

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
  const generic = {
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
  const weeklySource = firstObject(raw?.weekly, raw?.week, raw?.primary);
  const weeklyWindowMinutes = number(
    weeklySource.windowMinutes ?? weeklySource.window_minutes ?? weeklySource.windowDurationMins
  );
  const weeklyIdentified = weeklySource === raw?.weekly
    || weeklySource === raw?.week
    || weeklyWindowMinutes === WEEK_MINUTES;
  const weeklyResetAt = resetAt(weeklySource);
  const weeklyStartAt = weeklyResetAt && weeklyWindowMinutes
    ? new Date(Date.parse(weeklyResetAt) - weeklyWindowMinutes * 60000).toISOString()
    : "";
  const weekly = {
    identified: weeklyIdentified,
    state: weeklyIdentified ? generic.state : "unknown",
    available: weeklyIdentified ? generic.available : null,
    usedPercent: weeklyIdentified ? usedPercent : null,
    remainingPercent: weeklyIdentified ? remainingPercent : null,
    resetAt: weeklyIdentified ? weeklyResetAt : "",
    observedAt,
    windowMinutes: weeklyIdentified ? weeklyWindowMinutes : null,
    windowStartAt: weeklyIdentified ? weeklyStartAt : "",
    raw: weeklyIdentified ? weeklySource : {},
    reason: weeklyIdentified ? "weekly bucket identified" : "weekly bucket unavailable"
  };
  return { ...generic, weekly };
}

export function weeklyCapacity(capacity = {}) {
  const weekly = capacity?.weekly;
  return weekly && weekly.identified === true
    ? weekly
    : {
      identified: false,
      state: "unknown",
      available: null,
      usedPercent: null,
      remainingPercent: null,
      resetAt: "",
      observedAt: "",
      windowMinutes: null,
      windowStartAt: "",
      raw: {},
      reason: "weekly bucket unavailable"
    };
}

export function calculateWeeklyPacing(capacity, {
  reservePercent = 15,
  deadbandPercent = 1,
  now = new Date()
} = {}) {
  const weekly = weeklyCapacity(capacity);
  const reserve = Math.min(100, Math.max(0, Number(reservePercent) || 0));
  const deadband = Math.max(0, Number(deadbandPercent) || 0);
  const nowDate = now instanceof Date ? now : new Date(now);
  const start = Date.parse(weekly.windowStartAt);
  const reset = Date.parse(weekly.resetAt);
  if (!weekly.identified || !Number.isFinite(start) || !Number.isFinite(reset) || reset <= start) {
    return {
      state: "unknown",
      reason: weekly.reason || "weekly window unknown",
      reservePercent: reserve,
      deadbandPercent: deadband,
      elapsedFraction: null,
      allowedUsedPercent: null,
      minimumRemainingPercent: null,
      actualUsedPercent: weekly.usedPercent,
      actualRemainingPercent: weekly.remainingPercent,
      headroomPercent: null,
      weekly
    };
  }
  const elapsedFraction = Math.min(1, Math.max(0, (nowDate.getTime() - start) / (reset - start)));
  const allowedUsedPercent = (100 - reserve) * elapsedFraction;
  const minimumRemainingPercent = 100 - allowedUsedPercent;
  const actualUsedPercent = weekly.usedPercent;
  const actualRemainingPercent = weekly.remainingPercent ?? (
    actualUsedPercent == null ? null : 100 - actualUsedPercent
  );
  const state = weekly.state === "usage-limited"
    ? "usage-limited"
    : actualUsedPercent == null || actualRemainingPercent == null
      ? "unknown"
      : "available";
  return {
    state,
    reason: state === "available" ? "weekly pacing calculated" : weekly.state,
    reservePercent: reserve,
    deadbandPercent: deadband,
    elapsedFraction,
    allowedUsedPercent,
    minimumRemainingPercent,
    actualUsedPercent,
    actualRemainingPercent,
    headroomPercent: actualUsedPercent == null ? null : allowedUsedPercent - actualUsedPercent,
    weekly
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
  reservePercent: 15,
  pacingDeadbandPercent: 1,
  pollIntervalMs: 60000,
  maxTasksPerWake: 1,
  staleOperationalTurnMs: 30 * 60 * 1000,
  maxOperationalRecoveries: 1,
  curationThreshold: 1,
  curationMaxTasks: 3
});

export function admitBackgroundWork({
  capacity,
  policy = {},
  foregroundActive = false,
  hasEligibleWork = true,
  now = new Date()
} = {}) {
  const settings = { ...DEFAULT_BACKGROUND_POLICY, ...policy };
  const pacing = calculateWeeklyPacing(capacity, {
    reservePercent: settings.reservePercent,
    deadbandPercent: settings.pacingDeadbandPercent,
    now
  });
  if (settings.enabled !== true) return { admit: false, reason: "background disabled", pacing };
  if (foregroundActive) return { admit: false, reason: "active task conflict", pacing };
  if (!hasEligibleWork) return { admit: false, reason: "no eligible work", pacing };
  if (pacing.state === "usage-limited") return { admit: false, reason: "usage limited", pacing };
  if (pacing.state !== "available") return { admit: false, reason: "capacity unknown", pacing };
  if (pacing.actualRemainingPercent <= pacing.reservePercent) {
    return { admit: false, reason: "weekly reserve", pacing };
  }
  if (pacing.headroomPercent < -pacing.deadbandPercent) {
    return { admit: false, reason: "weekly pacing limit", pacing };
  }
  return { admit: true, reason: "weekly pacing headroom", pacing };
}
