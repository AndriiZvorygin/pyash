export const DEFAULT_MAX_MIND_TOOL_CALLS = 65_535;
export const DEFAULT_MAX_MIND_TOOL_TURNS = 65_535;

export function normalizeMindToolCallLimit(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_MIND_TOOL_CALLS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_MAX_MIND_TOOL_CALLS;
  return Math.min(DEFAULT_MAX_MIND_TOOL_CALLS, Math.trunc(numeric));
}
