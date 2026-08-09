const WORK_EVENT_TYPES = [
  "capacity",
  "deferred",
  "selected",
  "planning-started",
  "plan-completed",
  "implementation-started",
  "implementation-completed",
  "tests-reported",
  "diff-collected",
  "review-started",
  "review-completed",
  "revision-requested",
  "budget-paused",
  "blocked",
  "usage-limited",
  "accepted",
  "failed"
];

export const WORK_EVENT_NAMES = Object.freeze([...WORK_EVENT_TYPES]);

function isoNow(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}
export async function emitWorkEvent(observer, type, fields = {}, { now = () => new Date() } = {}) {
  if (typeof observer !== "function") return null;
  const event = {
    type,
    at: isoNow(now),
    ...fields
  };
  try {
    await observer(event);
  } catch {
    // Observation must never change durable work semantics.
  }
  return event;
}
