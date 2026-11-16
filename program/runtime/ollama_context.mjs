export const OLLAMA_CONTEXT_PRESETS = Object.freeze([
  4096,
  8192,
  16384,
  32768,
  65536,
  131072,
  262144,
  524288,
  1048576
]);

export function nextOllamaContextWindow({ minimumTokens = 0, currentContextLength = 0 } = {}) {
  const minimum = Number(minimumTokens);
  const current = Number(currentContextLength);
  if (!Number.isSafeInteger(minimum) || minimum <= 0) return null;
  const currentLimit = Number.isSafeInteger(current) && current > 0 ? current : 0;
  return OLLAMA_CONTEXT_PRESETS.find((tokens) => tokens > currentLimit && tokens >= minimum) ?? null;
}
