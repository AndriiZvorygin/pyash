const DEFAULT_LEGACY_TIMEOUT_MS = 900000;

export const LEGACY_TIMEOUT_POLICY = Object.freeze({
  policyVersion: "fixed-wall-v1",
  activityAware: false,
  inactivityTimeoutMs: 0,
  hardTimeoutMs: DEFAULT_LEGACY_TIMEOUT_MS
});

export const CURRENT_TIMEOUT_POLICY_VERSION = "activity-aware-v1";
export const TIMEOUT_POLICY_MIGRATION_ID = "fixed-wall-v1-to-activity-aware-v1";

function text(value) {
  return String(value ?? "").trim();
}

function positive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

export function normalizeTimeoutPolicy(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const activityAware = source.activityAware === true
    || positive(source.inactivityTimeoutMs) > 0;
  return {
    policyVersion: text(source.policyVersion) || (activityAware ? CURRENT_TIMEOUT_POLICY_VERSION : "fixed-wall-v1"),
    activityAware,
    inactivityTimeoutMs: activityAware ? positive(source.inactivityTimeoutMs) : 0,
    hardTimeoutMs: positive(source.hardTimeoutMs) || (activityAware ? 0 : DEFAULT_LEGACY_TIMEOUT_MS)
  };
}

export function currentTimeoutPolicy({
  fallbackTimeoutMs = DEFAULT_LEGACY_TIMEOUT_MS,
  inactivityTimeoutMs = DEFAULT_LEGACY_TIMEOUT_MS,
  hardTimeoutMs = DEFAULT_LEGACY_TIMEOUT_MS * 2
} = {}) {
  const inactivity = positive(inactivityTimeoutMs);
  const fallback = positive(fallbackTimeoutMs, DEFAULT_LEGACY_TIMEOUT_MS);
  const hard = positive(hardTimeoutMs, inactivity ? fallback * 2 : fallback);
  if (!inactivity) {
    return {
      policyVersion: "fixed-wall-v1",
      activityAware: false,
      inactivityTimeoutMs: 0,
      hardTimeoutMs: hard
    };
  }
  return {
    policyVersion: CURRENT_TIMEOUT_POLICY_VERSION,
    activityAware: true,
    inactivityTimeoutMs: inactivity,
    hardTimeoutMs: hard
  };
}

export function inferTimeoutPolicy(checkpoint = {}) {
  const stored = normalizeTimeoutPolicy(checkpoint.timeoutPolicy);
  if (checkpoint.timeoutPolicy?.policyVersion) return stored;
  const active = checkpoint.activeTurn || {};
  const interrupted = checkpoint.interruption || {};
  const reason = `${text(checkpoint.blocker)} ${text(interrupted.reason)} ${text(active.ambiguity)}`;
  const oldShape = /turn timeout/iu.test(reason)
    && positive(active.inactivityTimeoutMs) === 0
    && positive(active.hardTimeoutMs) === 0
    && (positive(active.timeoutMs) === 0 || positive(active.timeoutMs) === DEFAULT_LEGACY_TIMEOUT_MS);
  return oldShape ? { ...LEGACY_TIMEOUT_POLICY } : null;
}

export function isMateriallyDifferentTimeoutPolicy(fromPolicy, toPolicy) {
  const from = normalizeTimeoutPolicy(fromPolicy);
  const to = normalizeTimeoutPolicy(toPolicy);
  return from.policyVersion !== to.policyVersion
    && (from.activityAware !== to.activityAware
      || from.inactivityTimeoutMs !== to.inactivityTimeoutMs
      || from.hardTimeoutMs !== to.hardTimeoutMs);
}
