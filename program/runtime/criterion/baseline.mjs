import { tokenize } from "./metrics.mjs";

const KNOWN_SPEAKER_PREFIX = /^(?:#?(?:speaker|spk|person|participant|chair|clerk|host|moderator)\b[^:]{0,40}|<[^>]+>)\s*:\s*/iu;
const TIMESTAMP_PREFIX = /^\s*(?:\[[0-9:. -]+\]|\(?[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:[.,][0-9]+)?\)?)\s*/u;
const LINE_LABEL = /^\s*(?:#?([\p{L}][\p{L}\d _-]{0,39})|<([^>]+)>)\s*:\s*/u;

function linePrefix(line) {
  const timestamp = line.match(TIMESTAMP_PREFIX);
  const withoutTimestamp = timestamp ? line.slice(timestamp[0].length) : line;
  const label = withoutTimestamp.match(LINE_LABEL);
  return { timestampLength: timestamp?.[0].length ?? 0, label: label?.[1] ?? label?.[2] ?? null, labelLength: label?.[0].length ?? 0 };
}

function normalizeTranscript(source) {
  const lines = String(source ?? "").split(/\r?\n/u);
  const prefixes = lines.map(linePrefix);
  const counts = new Map();
  for (const prefix of prefixes) if (prefix.label) counts.set(prefix.label.toLowerCase(), (counts.get(prefix.label.toLowerCase()) ?? 0) + 1);
  return lines.map((line, index) => {
    const prefix = prefixes[index];
    let value = line.slice(prefix.timestampLength);
    const repeatedLabel = prefix.label && (counts.get(prefix.label.toLowerCase()) ?? 0) > 1;
    if (prefix.label && (KNOWN_SPEAKER_PREFIX.test(value) || repeatedLabel)) value = value.slice(prefix.labelLength);
    return value.trim();
  }).filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
}

function fallbackSentences(text) {
  return text.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
}

export function extractSentences(source) {
  const text = normalizeTranscript(source);
  if (!text) return [];
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return [...segmenter.segment(text)].map(item => item.segment.trim()).filter(Boolean);
  }
  return fallbackSentences(text);
}

export function extractLead3(source) {
  return extractSentences(source).slice(0, 3).join(" ");
}

export function runLead3({ sample, now = () => Date.now() } = {}) {
  const startedAt = now();
  const text = extractLead3(sample?.input ?? sample?.transcript ?? "");
  const finishedAt = now();
  return {
    text,
    effectiveThink: false,
    reasoningMode: "deterministic",
    metadata: { engine: "baseline", baseline: "lead-3", generation: "first three sentences" },
    timing: {
      promptTokens: null,
      outputTokens: tokenize(text).length,
      reasoningTokens: null,
      promptTokensPerSecond: null,
      generationTokensPerSecond: null,
      totalElapsedMs: Math.max(0, finishedAt - startedAt),
      processingLatencyMs: Math.max(0, finishedAt - startedAt)
    }
  };
}

export function baselineMetadata({ model = "baseline:lead-3" } = {}) {
  return {
    model,
    engine: "baseline",
    baseline: "lead-3",
    modelDigest: null,
    quantization: null,
    ollamaVersion: null,
    generationTokensPerSecond: null,
    note: "deterministic baseline; no Ollama request"
  };
}
