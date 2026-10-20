export function orderModelsByRecency(models, recentValues = []) {
  const rank = new Map(recentValues.map((value, index) => [value, index]));
  return models
    .map((model, index) => ({ model, index, rank: rank.get(model.value) }))
    .sort((left, right) => {
      if (left.rank !== undefined || right.rank !== undefined) {
        if (left.rank === undefined) return 1;
        if (right.rank === undefined) return -1;
        if (left.rank !== right.rank) return left.rank - right.rank;
      }
      return left.index - right.index;
    })
    .map(({ model }) => model);
}

export function rememberRecentModel(recentValues, modelValue, limit = 100) {
  const value = String(modelValue ?? "").trim();
  if (!value) return recentValues.filter((entry) => typeof entry === "string");
  return [
    value,
    ...recentValues.filter((entry) => typeof entry === "string" && entry !== value)
  ].slice(0, Math.max(1, limit));
}
