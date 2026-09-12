import fs from "node:fs/promises";
import path from "node:path";

export const SUITE_CATALOG = Object.freeze({
  meetingbank: {
    name: "MeetingBank",
    version: "public dataset",
    sourceUrl: "https://meetingbank.github.io/dataset/",
    utilityUrl: "https://github.com/YebowenHu/MeetingBank-utils",
    required: "JSON or JSONL export of the MeetingBank split"
  },
  qmsum: {
    name: "QMSum",
    version: "official dataset",
    sourceUrl: "https://github.com/Yale-LILY/QMSum",
    required: "official JSONL split or a normalized JSON export"
  },
  longbench: {
    name: "LongBench v2",
    version: "official scoring format",
    sourceUrl: "https://github.com/THUDM/LongBench",
    v2SourceUrl: "https://github.com/THUDM/LongBench/tree/main/LongBench-v2",
    required: "official JSON/JSONL/Parquet export (Parquet conversion is external)"
  },
  ifeval: {
    name: "IFEval",
    version: "official instruction-following evaluation",
    sourceUrl: "https://github.com/google-research/google-research/tree/master/instruction_following_eval",
    required: "official JSONL export; official verifier may be configured separately"
  },
  "helpos-local": {
    name: "HelpOS-local",
    version: "repository fixture contract v1",
    sourceUrl: "local repository fixtures",
    required: "fixtures/<id>/transcript.txt and optional agenda/reference/expected_facts files"
  },
  "mmlu-pro": {
    name: "MMLU-Pro calibration",
    version: "optional calibration",
    sourceUrl: "https://github.com/TIGER-AI-Lab/MMLU-Pro",
    required: "external dataset export"
  },
  gpqa: {
    name: "GPQA calibration",
    version: "optional calibration",
    sourceUrl: "https://github.com/idavidrein/gpqa",
    required: "private/licensed local dataset export"
  }
});

function parseJsonLines(text, filepath) {
  return String(text).split(/\r?\n/u).map((line, index) => {
    if (!line.trim()) return null;
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`criterion dataset malformed at ${filepath}:${index + 1}: ${error.message}`);
    }
  }).filter(Boolean);
}

export async function readDatasetFile(filepath) {
  const resolved = path.resolve(filepath);
  const text = await fs.readFile(resolved, "utf8");
  if (resolved.endsWith(".jsonl") || resolved.endsWith(".ndjson")) return parseJsonLines(text, resolved);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.records)) return parsed.records;
  return parsed;
}

function selectSplit(data, split) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[split])) return data[split];
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function stringifyTranscript(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item === "string") return item;
    return `${item.speaker ?? item.role ?? ""}: ${item.text ?? item.content ?? JSON.stringify(item)}`;
  }).join("\n");
  return value ? JSON.stringify(value) : "";
}

function meetingBankSample(row, index) {
  const transcript = stringifyTranscript(row.transcript ?? row.source ?? row.text);
  const reference = row.summary ?? row.reference ?? row.target ?? "";
  return {
    id: String(row.id ?? row.meeting_id ?? `meetingbank-${index + 1}`),
    prompt: `Summarize this council meeting segment. Preserve the important decisions and factual details.\n\nTRANSCRIPT:\n${transcript}`,
    reference: stringifyTranscript(reference),
    input: transcript,
    metadata: {
      source: row.source ?? null,
      type: row.type ?? null,
      segment: row.segment ?? null,
      evaluationMode: row.segment !== undefined ? "segment" : "whole-meeting",
      agendaAvailable: Boolean(row.agenda ?? row.agenda_items ?? row.agendaItems)
    }
  };
}

function qmsumSample(row, index) {
  const meeting = stringifyTranscript(row.meeting ?? row.transcript ?? row.source);
  const query = row.query ?? row.question ?? row.query_text ?? "Summarize the meeting.";
  const reference = row.answer ?? row.summary ?? row.reference ?? "";
  return {
    id: String(row.id ?? row.uid ?? `qmsum-${index + 1}`),
    prompt: `Answer the meeting question using only the relevant meeting evidence.\n\nQUESTION:\n${query}\n\nMEETING:\n${meeting}`,
    reference: stringifyTranscript(reference),
    input: meeting,
    query,
    metadata: {
      topic: row.topic ?? row.topic_list ?? null,
      relevantTextSpan: row.relevant_text_span ?? row.relevant_text_spans ?? row.relevant_spans ?? null,
      queryType: row.query_type ?? row.queryType ?? "general"
    }
  };
}

function longBenchSample(row, index) {
  const options = row.options ?? row.choices ?? [row.A, row.B, row.C, row.D].filter(value => value !== undefined);
  const optionLines = Array.isArray(options)
    ? options.map((value, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${value}`).join("\n")
    : Object.entries(options).map(([key, value]) => `${key}. ${value}`).join("\n");
  const context = row.context ?? row.input ?? row.passage ?? "";
  const question = row.question ?? row.prompt ?? "";
  return {
    id: String(row.id ?? row._id ?? `longbench-${index + 1}`),
    prompt: `Read the context and answer the multiple-choice question. Return only the answer letter.\n\nCONTEXT:\n${context}\n\nQUESTION:\n${question}\n\nOPTIONS:\n${optionLines}`,
    reference: String(row.answer ?? row.label ?? ""),
    input: context,
    expectedAnswer: String(row.answer ?? row.label ?? "").trim(),
    metadata: { category: row.category ?? null, subcategory: row.subcategory ?? null, difficulty: row.difficulty ?? null },
    contextLength: Number(row.context_length ?? row.contextLength ?? 0) || null
  };
}

function ifevalSample(row, index) {
  return {
    id: String(row.key ?? row.id ?? `ifeval-${index + 1}`),
    prompt: String(row.prompt ?? row.instruction ?? ""),
    reference: "",
    input: String(row.prompt ?? row.instruction ?? ""),
    instructionIds: row.instruction_id_list ?? row.instructionIds ?? [],
    kwargs: row.kwargs ?? [],
    metadata: { locale: row.locale ?? null }
  };
}

async function readOptionalJson(filepath) {
  try { return await readDatasetFile(filepath); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadHelpOSFixtures({ fixtureRoot, fixtureId } = {}) {
  const root = path.resolve(fixtureRoot ?? "fixtures");
  const ids = fixtureId ? [fixtureId] : await fs.readdir(root, { withFileTypes: true }).then(entries => entries.filter(entry => entry.isDirectory()).map(entry => entry.name));
  const samples = [];
  for (const id of ids.sort()) {
    const dir = path.join(root, id);
    const transcript = await fs.readFile(path.join(dir, "transcript.txt"), "utf8");
    const agenda = await readOptionalJson(path.join(dir, "agenda.json"));
    const reference = await readOptionalJson(path.join(dir, "reference.json"));
    const expectedFacts = await readOptionalJson(path.join(dir, "expected_facts.json"));
    const referenceText = typeof reference === "string" ? reference : reference?.summary ?? reference?.text ?? "";
    samples.push({
      id,
      prompt: `Process this municipal meeting transcript into a concise, factual summary. Preserve source grounding and do not invent facts.\n\nTRANSCRIPT:\n${transcript}${agenda ? `\n\nAGENDA:\n${JSON.stringify(agenda)}` : ""}`,
      reference: referenceText,
      input: transcript,
      agenda,
      expectedFacts: Array.isArray(expectedFacts) ? expectedFacts : expectedFacts?.facts ?? [],
      expected: reference,
      metadata: { fixtureDirectory: dir, transcriptHashInput: transcript }
    });
  }
  return samples;
}

export async function loadSuiteSamples({ benchmark, datasetPath, split = "test", fixtureRoot, fixtureId } = {}) {
  const key = String(benchmark ?? "").toLowerCase().replace(/[_ ]/gu, "-");
  if (!SUITE_CATALOG[key]) throw new Error(`unknown criterion suite: ${benchmark}`);
  if (key === "helpos-local") {
    return { key, catalog: SUITE_CATALOG[key], samples: await loadHelpOSFixtures({ fixtureRoot: datasetPath ?? fixtureRoot, fixtureId }) };
  }
  if (!datasetPath) throw new Error(`${SUITE_CATALOG[key].name} dataset is not configured; pass --dataset or set a local cache path (datasets are never downloaded implicitly)`);
  const data = await readDatasetFile(datasetPath);
  const rows = selectSplit(data, split);
  const adapters = {
    meetingbank: meetingBankSample,
    qmsum: qmsumSample,
    longbench: longBenchSample,
    ifeval: ifevalSample,
    "mmlu-pro": longBenchSample,
    gpqa: longBenchSample
  };
  const adapter = adapters[key];
  if (!adapter) throw new Error(`criterion suite adapter is not implemented: ${key}`);
  return { key, catalog: SUITE_CATALOG[key], samples: rows.map(adapter) };
}
