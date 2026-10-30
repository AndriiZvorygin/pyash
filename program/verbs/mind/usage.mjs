const USAGE_FIELDS = [
  ["input_tokens", "inputTokens"],
  ["inputTokens", "inputTokens"],
  ["prompt_tokens", "inputTokens"],
  ["cached_input_tokens", "cachedInputTokens"],
  ["cachedInputTokens", "cachedInputTokens"],
  ["cache_write_input_tokens", "cacheWriteInputTokens"],
  ["cacheWriteInputTokens", "cacheWriteInputTokens"],
  ["output_tokens", "outputTokens"],
  ["outputTokens", "outputTokens"],
  ["completion_tokens", "outputTokens"],
  ["reasoning_output_tokens", "reasoningOutputTokens"],
  ["reasoningOutputTokens", "reasoningOutputTokens"],
  ["total_tokens", "totalTokens"],
  ["totalTokens", "totalTokens"]
];

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

export function normalizeMindUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const values = {};
  let observed = false;
  for (const [sourceKey, targetKey] of USAGE_FIELDS) {
    const value = tokenCount(raw[sourceKey]);
    if (value === null) continue;
    observed = true;
    if (values[targetKey] === undefined) values[targetKey] = value;
  }
  if (!observed) return null;
  return {
    inputTokens: values.inputTokens ?? 0,
    cachedInputTokens: values.cachedInputTokens ?? 0,
    cacheWriteInputTokens: values.cacheWriteInputTokens ?? 0,
    outputTokens: values.outputTokens ?? 0,
    reasoningOutputTokens: values.reasoningOutputTokens ?? 0,
    totalTokens: values.totalTokens ?? (values.inputTokens ?? 0) + (values.outputTokens ?? 0)
  };
}

export function sumMindUsages(usages = []) {
  const values = (Array.isArray(usages) ? usages : [usages])
    .map((usage) => normalizeMindUsage(usage))
    .filter(Boolean);
  if (!values.length) return null;
  return values.reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    cacheWriteInputTokens: total.cacheWriteInputTokens + usage.cacheWriteInputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens + usage.reasoningOutputTokens,
    totalTokens: total.totalTokens + usage.totalTokens
  }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  });
}

function count(value) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

export function formatMindUsage(usage) {
  const normalized = normalizeMindUsage(usage);
  if (!normalized) return "usage: not reported";
  return [
    `input ${count(normalized.inputTokens)} (cached ${count(normalized.cachedInputTokens)}, cache write ${count(normalized.cacheWriteInputTokens)})`,
    `output ${count(normalized.outputTokens)} (reasoning ${count(normalized.reasoningOutputTokens)})`,
    `total ${count(normalized.totalTokens)}`
  ].join(" · ");
}
