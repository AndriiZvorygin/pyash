import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { formatMindUsage, normalizeMindUsage, sumMindUsages } from "../verbs/mind/usage.mjs";

const USAGE_NAME_PREFIX = "coding saddle usage";
const USAGE_FILE_SUFFIX = "-coding-saddle-usage.pya";
const FIELD_READERS = {
  "turn id": (record, sentence) => { record.turnId = String(sentence.ob?.text ?? sentence.ob?.name ?? ""); },
  "mind name": (record, sentence) => { record.mindName = String(sentence.ob?.name ?? sentence.ob?.text ?? ""); },
  backend: (record, sentence) => { record.backend = String(sentence.ob?.text ?? ""); },
  model: (record, sentence) => { record.model = String(sentence.ob?.name ?? sentence.ob?.text ?? ""); },
  "input tokens": (record, sentence) => { record.usage.inputTokens = Number(sentence.ob?.num ?? 0); },
  "cached input tokens": (record, sentence) => { record.usage.cachedInputTokens = Number(sentence.ob?.num ?? 0); },
  "cache write input tokens": (record, sentence) => { record.usage.cacheWriteInputTokens = Number(sentence.ob?.num ?? 0); },
  "output tokens": (record, sentence) => { record.usage.outputTokens = Number(sentence.ob?.num ?? 0); },
  "reasoning output tokens": (record, sentence) => { record.usage.reasoningOutputTokens = Number(sentence.ob?.num ?? 0); },
  "total tokens": (record, sentence) => { record.usage.totalTokens = Number(sentence.ob?.num ?? 0); },
  "recorded during": (record, sentence) => { record.recordedAt = String(sentence.ob?.text ?? sentence.during?.date ?? ""); }
};

function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function stableRecordToken(value = "") {
  const text = String(value ?? "").trim();
  return text
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "unidentified";
}

function usageRecordName(turnId = "") {
  return `${USAGE_NAME_PREFIX} ${stableRecordToken(turnId)}`;
}

function usageLogPath(worldRoot, now = new Date()) {
  return path.join(path.resolve(String(worldRoot || ".")), "newspaper", `${dayStamp(now)}-coding-saddle-usage.pya`);
}

function parseSentence(line) {
  try {
    return parse(line);
  } catch {
    return null;
  }
}

function recordsFromText(text) {
  const records = [];
  let current = null;
  for (const line of splitSentences(String(text ?? ""))) {
    const sentence = parseSentence(line);
    if (!sentence) continue;
    if (sentence.mood === "def" && sentence.be === "json map" && sentence.su?.name?.startsWith(`${USAGE_NAME_PREFIX} `)) {
      current = {
        recordName: sentence.su.name,
        turnId: "",
        mindName: "mind",
        backend: "",
        model: "",
        recordedAt: "",
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0
        }
      };
      records.push(current);
      continue;
    }
    if (sentence.mood === "prah") {
      current = null;
      continue;
    }
    if (!current || sentence.mood !== "ya") continue;
    const reader = FIELD_READERS[sentence.su?.name ?? ""];
    if (reader) reader(current, sentence);
  }
  return records.filter((record) => normalizeMindUsage(record.usage));
}

async function usageRecordsFromFile(file) {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return recordsFromText(text);
}

function usageMapBlock({ recordName, turnId, mindName, backend, model, usage, now = new Date() }) {
  const lines = [
    sentenceToPyash({ mood: "def", su: { name: recordName }, be: "json map" }),
    sentenceToPyash({ mood: "ya", su: { name: "backend" }, ob: { text: String(backend ?? "") } }),
    sentenceToPyash({ mood: "ya", su: { name: "cache write input tokens" }, ob: { num: usage.cacheWriteInputTokens } }),
    sentenceToPyash({ mood: "ya", su: { name: "cached input tokens" }, ob: { num: usage.cachedInputTokens } }),
    sentenceToPyash({ mood: "ya", su: { name: "input tokens" }, ob: { num: usage.inputTokens } }),
    sentenceToPyash({ mood: "ya", su: { name: "mind name" }, ob: { name: String(mindName || "mind") } }),
    sentenceToPyash({ mood: "ya", su: { name: "model" }, ob: { name: String(model ?? "") } }),
    sentenceToPyash({ mood: "ya", su: { name: "output tokens" }, ob: { num: usage.outputTokens } }),
    sentenceToPyash({ mood: "ya", su: { name: "reasoning output tokens" }, ob: { num: usage.reasoningOutputTokens } }),
    sentenceToPyash({
      mood: "ya",
      su: { name: "recorded during" },
      ob: { text: now.toISOString() },
      during: { date: now.toISOString() }
    }),
    sentenceToPyash({ mood: "ya", su: { name: "total tokens" }, ob: { num: usage.totalTokens } }),
    sentenceToPyash({ mood: "ya", su: { name: "turn id" }, ob: { text: String(turnId ?? "") } }),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export async function appendSaddleUsage({
  worldRoot,
  turnId = "",
  mindName = "mind",
  backend = "",
  model = "",
  usage,
  now = new Date()
} = {}) {
  const normalized = normalizeMindUsage(usage);
  if (!normalized) return null;
  const resolvedTurnId = String(turnId ?? "").trim() || `unidentified-${now.getTime()}`;
  const recordName = usageRecordName(resolvedTurnId);
  const file = usageLogPath(worldRoot, now);
  const existing = await readSaddleUsageRecords({ worldRoot });
  const existingRecord = existing.find((record) => record.recordName === recordName);
  if (existingRecord) return { file, recordName, record: existingRecord, appended: false };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, usageMapBlock({
    recordName,
    turnId: resolvedTurnId,
    mindName,
    backend,
    model,
    usage: normalized,
    now
  }), "utf8");
  return {
    file,
    recordName,
    appended: true,
    record: {
      recordName,
      turnId: resolvedTurnId,
      mindName: String(mindName || "mind"),
      backend: String(backend ?? ""),
      model: String(model ?? ""),
      recordedAt: now.toISOString(),
      usage: normalized
    }
  };
}

export async function readSaddleUsageRecords({ worldRoot } = {}) {
  const newspaperRoot = path.join(path.resolve(String(worldRoot || ".")), "newspaper");
  let files = [];
  try {
    files = (await fs.readdir(newspaperRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(USAGE_FILE_SUFFIX))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const batches = await Promise.all(files.map((name) => usageRecordsFromFile(path.join(newspaperRoot, name))));
  return batches.flat();
}

export async function readSaddleUsageSummary({ worldRoot } = {}) {
  const records = await readSaddleUsageRecords({ worldRoot });
  const groups = new Map();
  for (const record of records) {
    const key = [record.mindName || "mind", record.backend || "unknown", record.model || "unknown"].join("\0");
    const group = groups.get(key) ?? {
      mindName: record.mindName || "mind",
      backend: record.backend || "unknown",
      model: record.model || "unknown",
      turns: 0,
      usages: []
    };
    group.turns += 1;
    group.usages.push(record.usage);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, usage: sumMindUsages(group.usages) }))
    .sort((left, right) => [
      left.mindName.localeCompare(right.mindName),
      left.model.localeCompare(right.model),
      left.backend.localeCompare(right.backend)
    ].find((value) => value !== 0) ?? 0);
}

export function formatSaddleUsageSummary(groups = []) {
  const entries = Array.isArray(groups) ? groups.filter((group) => group?.usage) : [];
  if (!entries.length) return "usage: no recorded model turns";
  return entries.map((group) => [
    `usage: ${group.mindName}/${group.model}`,
    `turns ${group.turns}`,
    formatMindUsage(group.usage)
  ].join(" · ")).join("\n");
}
