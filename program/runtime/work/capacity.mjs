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

function usageShape(source = {}, fallback = {}) {
  let usedPercent = number(source.usedPercent ?? source.used_percentage ?? fallback.usedPercent);
  const explicitRemainingPercent = number(
    source.remainingPercent ?? source.remaining_percentage ?? fallback.remainingPercent
  );
  const limit = number(source.limit ?? source.max ?? fallback.limit);
  const remaining = number(source.remaining ?? source.remainingTokens ?? fallback.remaining);
  const remainingPercent = explicitRemainingPercent != null
    ? explicitRemainingPercent
    : usedPercent != null
      ? Math.max(0, 100 - usedPercent)
      : limit != null && remaining != null && limit > 0
        ? Math.max(0, Math.min(100, (remaining / limit) * 100))
        : null;
  if (usedPercent == null && remainingPercent != null) usedPercent = 100 - remainingPercent;
  return { usedPercent, remainingPercent, limit, remaining };
}

const WEEK_MINUTES = 7 * 24 * 60;
const WEEK_SECONDS = WEEK_MINUTES * 60;

function durationMinutes(source = {}) {
  const minutes = number(
    source.windowMinutes
      ?? source.window_minutes
      ?? source.windowDurationMins
      ?? source.window_duration_mins
  );
  if (minutes != null) return minutes;
  const seconds = number(
    source.windowDurationSeconds
      ?? source.window_duration_seconds
      ?? source.windowSeconds
      ?? source.window_seconds
  );
  return seconds == null ? null : seconds / 60;
}

function collectRateLimitBuckets(value, pathName = "", buckets = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return buckets;
  seen.add(value);
  if (!Array.isArray(value)) {
    const duration = durationMinutes(value);
    if (duration != null) buckets.push({ value, path: pathName, duration });
    for (const [key, child] of Object.entries(value)) {
      collectRateLimitBuckets(child, pathName ? `${pathName}.${key}` : key, buckets, seen);
    }
  } else {
    value.forEach((child, index) => collectRateLimitBuckets(child, `${pathName}[${index}]`, buckets, seen));
  }
  return buckets;
}

function isWeeklyDuration(minutes) {
  return Math.abs(Number(minutes) - WEEK_MINUTES) < 0.0001
    || Math.abs(Number(minutes) * 60 - WEEK_SECONDS) < 0.1;
}

function validPercentage(value) {
  return value == null || (Number.isFinite(value) && value >= 0 && value <= 100);
}

function validateWeeklyBucket(duration, usage, reset) {
  if (!isWeeklyDuration(duration)) return "weekly duration is not seven days";
  const resetMillis = Date.parse(reset);
  const startMillis = resetMillis - WEEK_MINUTES * 60000;
  if (!Number.isFinite(resetMillis) || resetMillis <= 0 || !Number.isFinite(startMillis) || startMillis >= resetMillis) {
    return "weekly reset timestamp is malformed";
  }
  if (usage.usedPercent == null && usage.remainingPercent == null) return "weekly usage percentages are missing";
  if (!validPercentage(usage.usedPercent) || !validPercentage(usage.remainingPercent)) {
    return "weekly usage percentages are malformed";
  }
  if (usage.usedPercent != null && usage.remainingPercent != null
    && Math.abs(usage.usedPercent + usage.remainingPercent - 100) > 1.0) {
    return "weekly usage percentages are inconsistent";
  }
  return "";
}

function resetAt(source) {
  const value = source.resetAt ?? source.resetsAt ?? source.reset_at ?? source.resetTime ?? source.reset_time;
  const numericValue = typeof value === "number"
    || (typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value.trim()));
  if (numericValue) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "";
    const millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function normalizeCodexCapacity(payload, { now = new Date() } = {}) {
  const outer = payload?.limits && typeof payload.limits === "object" ? payload.limits : payload;
  const raw = outer?.rateLimits && typeof outer.rateLimits === "object" ? outer.rateLimits : outer;
  const primary = firstObject(raw?.primary, raw?.hourly, raw?.current, raw?.rateLimit, raw);
  const primaryUsage = usageShape(primary, raw);
  const { usedPercent, remainingPercent, limit, remaining } = primaryUsage;
  const reset = resetAt(primary) || resetAt(raw);
  const windowMinutes = number(
    durationMinutes(primary) ?? durationMinutes(raw)
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
  // Identify the weekly allowance by its declared duration, independent of
  // provider bucket names or ordering.
  const weeklyCandidates = collectRateLimitBuckets(raw)
    .filter((candidate) => isWeeklyDuration(candidate.duration));
  const weeklyCandidate = weeklyCandidates.find((candidate) => {
    const candidateUsage = usageShape(candidate.value, {});
    return !validateWeeklyBucket(candidate.duration, candidateUsage, resetAt(candidate.value));
  }) || weeklyCandidates[0];
  const weeklySource = weeklyCandidate?.value || {};
  const weeklyWindowMinutes = weeklyCandidate?.duration ?? null;
  const weeklyUsage = usageShape(weeklySource, {});
  const weeklyResetAt = resetAt(weeklySource);
  const weeklyValidation = weeklyCandidate
    ? validateWeeklyBucket(weeklyWindowMinutes, weeklyUsage, weeklyResetAt)
    : "weekly bucket unavailable";
  const weeklyIdentified = Boolean(weeklyCandidate) && !weeklyValidation;
  const weeklyStartAt = weeklyIdentified
    ? new Date(Date.parse(weeklyResetAt) - WEEK_MINUTES * 60000).toISOString()
    : "";
  const weeklyLimited = limited || weeklyUsage.remainingPercent === 0;
  const weekly = {
    identified: weeklyIdentified,
    state: weeklyIdentified
      ? weeklyLimited ? "usage-limited" : weeklyUsage.remainingPercent != null ? "available" : "unknown"
      : weeklyLimited ? "usage-limited" : "unknown",
    available: weeklyIdentified
      ? weeklyLimited ? false : weeklyUsage.remainingPercent != null ? weeklyUsage.remainingPercent > 0 : null
      : null,
    usedPercent: weeklyIdentified ? weeklyUsage.usedPercent : null,
    remainingPercent: weeklyIdentified ? weeklyUsage.remainingPercent : null,
    resetAt: weeklyIdentified ? weeklyResetAt : "",
    observedAt,
    windowMinutes: weeklyIdentified ? WEEK_MINUTES : null,
    windowStartAt: weeklyIdentified ? weeklyStartAt : "",
    raw: weeklyIdentified ? weeklySource : {},
    bucketPath: weeklyIdentified ? weeklyCandidate.path : "",
    reason: weeklyIdentified ? "weekly bucket identified" : weeklyValidation
  };
  return { ...generic, weekly };
}

export function weeklyCapacity(capacity = {}) {
  const weekly = capacity?.weekly;
  return weekly && (weekly.identified === true || weekly.state === "usage-limited")
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
    const state = weekly.state === "usage-limited" ? "usage-limited" : "unknown";
    return {
      state,
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
  maxOperationalRecoveries: 2,
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
  if (pacing.state === "usage-limited") return { admit: false, reason: "provider usage-limited", pacing };
  if (pacing.state !== "available") return { admit: false, reason: "capacity telemetry unavailable", pacing };
  if (pacing.actualRemainingPercent <= pacing.reservePercent) {
    return { admit: false, reason: "weekly reserve", pacing };
  }
  if (pacing.headroomPercent < -pacing.deadbandPercent) {
    return { admit: false, reason: "weekly pacing limit", pacing };
  }
  return { admit: true, reason: "weekly pacing headroom", pacing };
}
