import crypto from "node:crypto";

export function stableJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function stripThinking(value) {
  return String(value ?? "").replace(/<think>[\s\S]*?<\/think>/gi, " ").trim();
}

export function tokenize(value) {
  const text = normalizeText(value).toLowerCase();
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? [];
}

function countNgrams(tokens, size) {
  const counts = new Map();
  for (let i = 0; i <= tokens.length - size; i += 1) {
    const key = tokens.slice(i, i + size).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function f1(precision, recall) {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function rougeN(reference, candidate, size = 1) {
  const expected = countNgrams(tokenize(reference), size);
  const actual = countNgrams(tokenize(candidate), size);
  let overlap = 0;
  for (const [key, count] of actual) overlap += Math.min(count, expected.get(key) ?? 0);
  const actualTotal = [...actual.values()].reduce((sum, count) => sum + count, 0);
  const expectedTotal = [...expected.values()].reduce((sum, count) => sum + count, 0);
  const precision = actualTotal ? overlap / actualTotal : 0;
  const recall = expectedTotal ? overlap / expectedTotal : 0;
  return { precision, recall, f1: f1(precision, recall) };
}

function longestCommonSubsequence(left, right) {
  const row = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = left[i - 1] === right[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return row[right.length];
}

export function rougeL(reference, candidate) {
  const expected = tokenize(reference);
  const actual = tokenize(candidate);
  const overlap = longestCommonSubsequence(expected, actual);
  const precision = actual.length ? overlap / actual.length : 0;
  const recall = expected.length ? overlap / expected.length : 0;
  return { precision, recall, f1: f1(precision, recall) };
}

export function rougeScores(reference, candidate) {
  return {
    rouge1: rougeN(reference, candidate, 1).f1,
    rouge2: rougeN(reference, candidate, 2).f1,
    rougeL: rougeL(reference, candidate).f1
  };
}

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function contextLengthBucket(tokens) {
  const value = Number(tokens);
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value <= 8192) return "0-8K";
  if (value <= 16384) return "8K-16K";
  if (value <= 32768) return "16K-32K";
  if (value <= 65536) return "32K-64K";
  return ">64K";
}

export function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function ollamaTiming(payload = {}, startedAt = null, finishedAt = null) {
  const nsToMs = value => Number.isFinite(Number(value)) ? Number(value) / 1e6 : null;
  const nsToSeconds = value => Number.isFinite(Number(value)) ? Number(value) / 1e9 : null;
  const elapsedMs = nsToMs(payload.total_duration) ?? (
    startedAt && finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null
  );
  const promptSeconds = nsToSeconds(payload.prompt_eval_duration);
  const generationSeconds = nsToSeconds(payload.eval_duration);
  const promptTokens = Number.isFinite(Number(payload.prompt_eval_count)) ? Number(payload.prompt_eval_count) : null;
  const outputTokens = Number.isFinite(Number(payload.eval_count)) ? Number(payload.eval_count) : null;
  const thinking = payload.message?.thinking ?? payload.thinking ?? "";
  const reasoningTokens = thinking ? tokenize(thinking).length : null;
  return {
    promptTokens,
    outputTokens,
    reasoningTokens,
    promptTokensPerSecond: promptSeconds && promptSeconds > 0 && promptTokens !== null ? promptTokens / promptSeconds : null,
    generationTokensPerSecond: generationSeconds && generationSeconds > 0 && outputTokens !== null ? outputTokens / generationSeconds : null,
    totalElapsedMs: elapsedMs,
    promptEvaluationMs: nsToMs(payload.prompt_eval_duration),
    generationEvaluationMs: nsToMs(payload.eval_duration)
  };
}

export function parseJsonOutput(text) {
  const cleaned = stripThinking(text).trim();
  if (!cleaned) return { valid: false, value: null, error: "empty output" };
  try {
    return { valid: true, value: JSON.parse(cleaned), error: null };
  } catch (error) {
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) {
      try { return { valid: true, value: JSON.parse(fenced), error: null }; } catch { /* use the useful original error */ }
    }
    return { valid: false, value: null, error: error.message };
  }
}

export function scoreExactAnswer(expected, actual) {
  const left = normalizeText(expected).replace(/[.)]$/u, "").toUpperCase();
  const right = stripThinking(actual).trim().match(/\b([ABCD])\b/iu)?.[1]?.toUpperCase() ?? normalizeText(actual).toUpperCase();
  return left && left === right ? 1 : 0;
}

export function scoreInstruction(sample, output) {
  const text = stripThinking(output);
  const ids = sample.instructionIds ?? [];
  const checks = ids.map((id, index) => {
    const lower = String(id).toLowerCase();
    if (lower.includes("json")) return { id, pass: parseJsonOutput(text).valid };
    if (lower.includes("list")) return { id, pass: /^\s*(?:[-*]|\d+[.)])\s+/mu.test(text) };
    if (lower.includes("length") && sample.kwargs?.[index]?.num_words) {
      return { id, pass: tokenize(text).length <= Number(sample.kwargs[index].num_words) };
    }
    return { id, pass: text.trim().length > 0 };
  });
  const passed = checks.filter(check => check.pass).length;
  return {
    promptAccuracy: checks.length && passed === checks.length ? 1 : 0,
    instructionAccuracy: checks.length ? passed / checks.length : (text.trim() ? 1 : 0),
    instructionChecks: checks
  };
}

export function compareExpectedFacts(expectedFacts = [], output = "") {
  const text = normalizeText(output).toLowerCase();
  const checks = expectedFacts.map(fact => {
    const value = typeof fact === "string" ? fact : fact.value ?? fact.claim ?? fact.text ?? "";
    return { fact, pass: value ? text.includes(String(value).toLowerCase()) : false };
  });
  const passed = checks.filter(check => check.pass).length;
  return { factualAccuracy: checks.length ? passed / checks.length : null, factChecks: checks };
}

function aggregateCore(results) {
  const successful = results.filter(row => row.status === "ok");
  const latencies = successful.map(row => row.metrics?.totalElapsedMs).filter(Number.isFinite);
  const aggregateMetric = key => mean(successful.map(row => Number(row.scores?.[key])).filter(Number.isFinite));
  const qualityPerSecond = mean(successful.map(row => {
    const quality = Number(row.scores?.rougeL ?? row.scores?.accuracy ?? row.scores?.factualAccuracy ?? row.scores?.instructionAccuracy);
    const elapsed = Number(row.metrics?.totalElapsedMs);
    return Number.isFinite(quality) && elapsed > 0 ? quality / (elapsed / 1000) : null;
  }).filter(Number.isFinite));
  return {
    sampleCount: results.length,
    successfulCount: successful.length,
    skippedCount: results.filter(row => row.status === "skipped").length,
    failureCount: results.filter(row => row.status === "error").length,
    malformedCount: results.filter(row => row.malformedOutput).length,
    passCount: results.filter(row => row.pass === true).length,
    passEvaluatedCount: results.filter(row => row.pass !== null && row.pass !== undefined).length,
    rouge1: aggregateMetric("rouge1"),
    rouge2: aggregateMetric("rouge2"),
    rougeL: aggregateMetric("rougeL"),
    accuracy: aggregateMetric("accuracy"),
    promptAccuracy: aggregateMetric("promptAccuracy"),
    instructionAccuracy: aggregateMetric("instructionAccuracy"),
    queryRelevance: aggregateMetric("queryRelevance"),
    answerLength: aggregateMetric("answerLength"),
    schemaValidity: aggregateMetric("schemaValidity"),
    provenanceValidity: aggregateMetric("provenanceValidity"),
    factualAccuracy: aggregateMetric("factualAccuracy"),
    unsupportedClaimCount: successful.reduce((sum, row) => sum + Number(row.scores?.unsupportedClaimCount ?? 0), 0),
    averageOutputTokens: mean(successful.map(row => row.metrics?.outputTokens).filter(Number.isFinite)),
    averageInputTokens: mean(successful.map(row => row.metrics?.promptTokens ?? row.inputTokens).filter(Number.isFinite)),
    promptTokensPerSecond: mean(successful.map(row => row.metrics?.promptTokensPerSecond).filter(Number.isFinite)),
    generationTokensPerSecond: mean(successful.map(row => row.metrics?.generationTokensPerSecond).filter(Number.isFinite)),
    averageLatencyMs: mean(latencies),
    p50LatencyMs: percentile(latencies, 0.5),
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    qualityPerSecond
  };
}

export function aggregateSampleResults(results) {
  const aggregate = aggregateCore(results);
  const buckets = new Map();
  for (const row of results) {
    const bucket = row.contextLengthBucket ?? contextLengthBucket(row.inputTokens);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(row);
  }
  aggregate.contextBuckets = Object.fromEntries([...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([bucket, rows]) => [bucket, aggregateCore(rows)]));
  return aggregate;
}
