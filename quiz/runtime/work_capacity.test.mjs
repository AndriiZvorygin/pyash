import test from "node:test";
import assert from "node:assert/strict";

import {
  admitBackgroundWork,
  calculateWeeklyPacing,
  normalizeCodexCapacity,
  readCodexCapacity
} from "../../program/runtime/work/capacity.mjs";
import { renderWorkDailyDigest } from "../../program/runtime/work/digest.mjs";

const resetAt = "2026-09-01T00:00:00.000Z";

function bucket(overrides = {}) {
  return {
    usedPercent: 10,
    remainingPercent: 90,
    windowDurationMins: 10080,
    resetsAt: resetAt,
    ...overrides
  };
}

function normalizeRateLimits(rateLimits, now = "2026-08-26T12:00:00.000Z") {
  return normalizeCodexCapacity({ rateLimits }, { now });
}

test("weekly capacity is selected by seven-day duration regardless of bucket name or order", () => {
  const namedWeekly = normalizeRateLimits({ weekly: bucket() });
  assert.equal(namedWeekly.weekly.identified, true);
  assert.equal(namedWeekly.weekly.bucketPath, "weekly");

  const namedSecondary = normalizeRateLimits({
    primary: bucket({ usedPercent: 40, remainingPercent: 60, windowDurationMins: 300 }),
    secondary: bucket({ usedPercent: 12, remainingPercent: 88 })
  });
  assert.equal(namedSecondary.weekly.identified, true);
  assert.equal(namedSecondary.weekly.bucketPath, "secondary");
  assert.equal(namedSecondary.weekly.usedPercent, 12);

  const nested = normalizeRateLimits({
    primary: bucket({ windowDurationMins: 300, usedPercent: 4, remainingPercent: 96 }),
    collections: {
      short: bucket({ windowDurationMins: 60 }),
      limits: [{ longWindow: bucket({ usedPercent: 22, remainingPercent: 78 }) }]
    }
  });
  assert.equal(nested.weekly.identified, true);
  assert.equal(nested.weekly.usedPercent, 22);
  assert.equal(nested.weekly.bucketPath, "collections.limits[0].longWindow");

  const reversed = normalizeRateLimits({
    first: bucket({ windowDurationMins: 300, usedPercent: 6, remainingPercent: 94 }),
    second: bucket({ usedPercent: 17, remainingPercent: 83 })
  });
  assert.equal(reversed.weekly.identified, true);
  assert.equal(reversed.weekly.bucketPath, "second");

  const seconds = normalizeRateLimits({ longWindow: bucket({
    windowDurationMins: undefined,
    windowDurationSeconds: 604800
  }) });
  assert.equal(seconds.weekly.identified, true);
  assert.equal(seconds.weekly.windowMinutes, 10080);
});

test("a five-hour bucket is never mistaken for weekly capacity", () => {
  const capacity = normalizeRateLimits({
    primary: bucket({ windowDurationMins: 300 }),
    secondary: bucket({ windowDurationMins: 240 })
  });
  assert.equal(capacity.weekly.identified, false);
  assert.equal(capacity.weekly.reason, "weekly bucket unavailable");
  assert.equal(calculateWeeklyPacing(capacity, { now: "2026-08-26T12:00:00.000Z" }).state, "unknown");
});

test("malformed weekly metadata fails closed instead of generating pacing numbers", () => {
  for (const invalid of [
    { windowDurationMins: undefined },
    { resetsAt: "not-a-date" },
    { usedPercent: undefined, remainingPercent: undefined },
    { usedPercent: 10, remainingPercent: 50 }
  ]) {
    const capacity = normalizeRateLimits({ weekly: bucket(invalid) });
    assert.equal(capacity.weekly.identified, false, JSON.stringify(invalid));
    assert.equal(calculateWeeklyPacing(capacity).state, "unknown");
  }
});

test("provider usage limits remain distinct from unknown weekly telemetry", () => {
  const limited = normalizeRateLimits({
    primary: bucket({ windowDurationMins: 300, usedPercent: 1, remainingPercent: 99 }),
    secondary: bucket({ usedPercent: 100, remainingPercent: 0 })
  });
  assert.equal(limited.weekly.state, "usage-limited");
  assert.equal(admitBackgroundWork({
    capacity: limited,
    policy: { enabled: true },
    hasEligibleWork: true,
    now: "2026-08-26T12:00:00.000Z"
  }).reason, "provider usage-limited");

  const unknown = normalizeRateLimits({ primary: bucket({ windowDurationMins: 300 }) });
  assert.equal(admitBackgroundWork({
    capacity: unknown,
    policy: { enabled: true },
    hasEligibleWork: true,
    now: "2026-08-26T12:00:00.000Z"
  }).reason, "capacity telemetry unavailable");
});

test("rate-limit request failure fails closed as capacity telemetry unavailable", async () => {
  let closed = false;
  const capacity = await readCodexCapacity({
    appServerFactory: async () => ({
      request: async () => { throw new Error("rate limit endpoint unavailable"); },
      close: async () => { closed = true; }
    })
  });
  assert.equal(closed, true);
  assert.equal(capacity.weekly.identified, false);
  assert.equal(admitBackgroundWork({
    capacity,
    policy: { enabled: true },
    hasEligibleWork: true
  }).reason, "capacity telemetry unavailable");
});

test("daily digest separates telemetry failure from pacing and provider limits", () => {
  const report = renderWorkDailyDigest({
    date: "2026-08-26",
    since: "2026-08-25T11:30:02.152Z",
    until: "2026-08-26T11:30:01.925Z",
    capacity: { weekly: { identified: false, state: "unknown" } },
    events: [
      { action: "deferred", reason: "capacity telemetry unavailable" },
      { action: "deferred", reason: "capacity unknown" },
      { action: "deferred", reason: "weekly pacing limit" },
      { action: "deferred", reason: "provider usage-limited" }
    ],
    health: {
      "weekly last good observed at": "2026-08-25T11:00:00.000Z",
      "weekly last good remaining percent": "81",
      "weekly last good reset at": "2026-08-31T11:00:00.000Z"
    }
  }).report;
  assert.match(report, /Current remaining: unavailable/u);
  assert.match(report, /Last good remaining: 81%/u);
  assert.match(report, /Pacing deferred: 1/u);
  assert.match(report, /Capacity telemetry unavailable: 2/u);
  assert.match(report, /Provider usage-limited: 1/u);
});
