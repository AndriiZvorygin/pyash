import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { sha256, stableJson, tokenize } from "./metrics.mjs";

export const SUITE_CATALOG = Object.freeze({
  meetingbank: {
    name: "MeetingBank",
    version: "official public dataset; pass the selected train/validation/test export",
    sourceUrl: "https://meetingbank.github.io/dataset/",
    licenseUrl: "https://meetingbank.github.io/license/",
    utilityUrl: "https://github.com/YebowenHu/MeetingBank-utils",
    splits: ["train", "validation", "test"],
    required: "JSON or JSONL export of the MeetingBank split"
  },
  qmsum: {
    name: "QMSum",
    version: "official dataset; pass the selected train/validation/test export",
    sourceUrl: "https://github.com/Yale-LILY/QMSum",
    licenseUrl: "https://github.com/Yale-LILY/QMSum/blob/main/LICENSE",
    splits: ["train", "validation", "test"],
    required: "official JSONL split or a normalized JSON export"
  },
  ami: {
    name: "AMI Meeting Corpus",
    version: "official corpus annotations or prepared transcript-summary export",
    sourceUrl: "https://groups.inf.ed.ac.uk/ami/corpus/",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    required: "prepared JSON/JSONL, or --fixtures with transcript.txt and summary.txt/reference.json"
  },
  icsi: {
    name: "ICSI Meeting Corpus",
    version: "official corpus transcription or prepared transcript-summary export",
    sourceUrl: "https://groups.inf.ed.ac.uk/ami/icsi/index.shtml",
    licenseUrl: "https://groups.inf.ed.ac.uk/ami/icsi/license.shtml",
    required: "prepared JSON/JSONL, or --fixtures with transcript.txt and summary.txt/reference.json"
  },
  dialogsum: {
    name: "DialogSum",
    version: "official test split or documented Hugging Face mirror",
    sourceUrl: "https://github.com/cylnlp/dialogsum",
    mirrorUrl: "https://huggingface.co/datasets/knkarthick/dialogsum",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    splits: ["train", "validation", "test"],
    required: "official or mirrored JSON/JSONL export"
  },
  "longbench-summary": {
    name: "LongBench v1 summarization",
    version: "LongBench v1 official task exports",
    sourceUrl: "https://github.com/THUDM/LongBench",
    taskSourceUrl: "https://github.com/THUDM/LongBench/blob/main/LongBench/task.md",
    tasks: ["GovReport", "MultiNews", "QMSum", "VCSUM"],
    required: "prepared LongBench v1 summarization JSON/JSONL export"
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
  },
  "omnicseval-meeting": {
    name: "OmniCSEval MeetingBank subset",
    version: "released OmniCSEval annotations; exact-compatible 75-sample MeetingBank lane",
    sourceUrl: "https://github.com/zhouweixiao/OmniCSEval",
    paperUrl: "https://arxiv.org/html/2606.15974v1",
    required: "local released annotation package plus saved MeetingBank model outputs"
  },
  "meetingbank-fact-audit": {
    name: "MeetingBank automated fact audit",
    version: "automated_proxy; full MeetingBank post-hoc fact lane",
    sourceUrl: "https://meetingbank.github.io/dataset/",
    paperUrl: "https://arxiv.org/html/2606.15974v1",
    required: "local MeetingBank dataset, saved model runs, and an external fact judge"
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
  if (resolved.endsWith(".csv")) return parseCsv(text, { columns: true, skip_empty_lines: true, bom: true });
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.records)) return parsed.records;
  return parsed;
}

function splitAliases(split) {
  const requested = String(split ?? "test").toLowerCase();
  if (requested === "validation" || requested === "val" || requested === "dev") return [requested, "validation", "val", "dev"];
  return [requested];
}

function canonicalSplit(value) {
  return ["validation", "val", "dev"].includes(String(value).toLowerCase()) ? "validation" : String(value).toLowerCase();
}

function splitFromPath(filepath) {
  const name = path.basename(String(filepath ?? ""), path.extname(String(filepath ?? ""))).toLowerCase();
  return ["train", "test", "validation", "val", "dev"].includes(name) ? canonicalSplit(name) : null;
}

function selectSplit(data, split, filepath = null) {
  if (Array.isArray(data)) return { rows: data, actualSplit: splitFromPath(filepath) ?? "provided-array", availableSplits: [] };
  const availableSplits = data && typeof data === "object"
    ? Object.keys(data).filter(key => Array.isArray(data[key]))
    : [];
  for (const alias of splitAliases(split)) {
    if (data && Array.isArray(data[alias])) return { rows: data[alias], actualSplit: canonicalSplit(alias), availableSplits };
  }
  if (data && Array.isArray(data.data)) return { rows: data.data, actualSplit: "data", availableSplits };
  return { rows: [], actualSplit: null, availableSplits };
}

function firstDefined(row, keys, fallback = null) {
  for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  return fallback;
}

function referenceParts(value) {
  if (Array.isArray(value)) {
    const parts = value.map(referenceParts);
    return {
      text: parts[0]?.text ?? "",
      references: parts.flatMap(part => part.references ?? [part.text]).filter(Boolean),
      provenance: parts.find(part => part.provenance)?.provenance ?? null
    };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      text: String(firstDefined(value, ["summary", "text", "value", "target"], "")),
      references: [String(firstDefined(value, ["summary", "text", "value", "target"], ""))].filter(Boolean),
      provenance: value.provenance ?? value.source ?? value.sourceUrl ?? null
    };
  }
  return { text: String(value ?? ""), references: String(value ?? "") ? [String(value)] : [], provenance: null };
}

function normalizeTurns(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") return { index, speaker: null, text: item, start: null, end: null };
    return {
      index,
      speaker: firstDefined(item, ["speaker", "speaker_id", "speakerId", "participant", "role"], null),
      text: String(firstDefined(item, ["text", "content", "utterance", "dialogue"], "")),
      start: firstDefined(item, ["start", "start_time", "startTime", "begin"], null),
      end: firstDefined(item, ["end", "end_time", "endTime", "stop"], null)
    };
  });
}

function transcriptParts(row, fields = ["transcript", "source", "text", "dialogue"]) {
  const turns = normalizeTurns(firstDefined(row, ["turns", "utterances", "dialogue_turns", "meeting_transcripts", "segments"], null));
  const raw = firstDefined(row, fields, "");
  const transcript = turns.length
    ? turns.map(turn => `${turn.speaker ? `${turn.speaker}: ` : ""}${turn.text}`).join("\n")
    : typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(item => typeof item === "string" ? item : `${item.speaker ?? item.role ?? ""}: ${item.text ?? item.content ?? JSON.stringify(item)}`).join("\n") : raw ? JSON.stringify(raw) : "";
  const explicitSpeakerLabels = turns.map(turn => turn.speaker).filter(Boolean).map(String);
  const markedSpeakerLabels = [...transcript.matchAll(/(?:^|\n|\s)(?:#?)([A-Za-z][A-Za-z0-9 _-]{0,39})(?:#?)\s*:\s/gu)].map(match => match[1].trim());
  const speakerLabels = [...new Set([...explicitSpeakerLabels, ...markedSpeakerLabels])];
  return { transcript, turns, speakerLabels };
}

function transcriptMetadata(transcript, turns = [], speakerLabels = []) {
  return {
    transcriptCharacters: transcript.length,
    transcriptTokens: tokenize(transcript).length,
    sourceTokenCount: tokenize(transcript).length,
    turnCount: turns.length || null,
    speakerLabels,
    turnBoundaries: turns.length ? turns.map(turn => ({ index: turn.index, speaker: turn.speaker, start: turn.start, end: turn.end })) : []
  };
}

function meetingBankSample(row, index) {
  const transcriptData = transcriptParts(row);
  const referenceData = referenceParts(firstDefined(row, ["summary", "reference", "target"], ""));
  const segment = firstDefined(row, ["segment", "segment_id", "segmentId", "segment_boundary", "segmentBoundary"], null);
  const segmentBoundary = segment && typeof segment === "object" ? segment : {
    start: firstDefined(row, ["segment_start", "segmentStart", "start"], null),
    end: firstDefined(row, ["segment_end", "segmentEnd", "end"], null)
  };
  const hasBoundary = Object.values(segmentBoundary).some(value => value !== null && value !== undefined && value !== "");
  const meetingId = String(firstDefined(row, ["meeting_id", "meetingId", "uid", "meeting", "id"], `meetingbank-${index + 1}`));
  const evaluationMode = String(firstDefined(row, ["evaluation_mode", "evaluationMode"], hasBoundary ? "segment" : "whole-meeting"));
  return {
    id: String(row.id ?? `${meetingId}-${index + 1}`),
    prompt: `${evaluationMode === "segment" ? "Summarize this council meeting segment" : "Summarize this complete council meeting"}. Preserve the important decisions and factual details.\n\nTRANSCRIPT:\n${transcriptData.transcript}`,
    reference: referenceData.text,
    input: transcriptData.transcript,
    metadata: {
      ...transcriptMetadata(transcriptData.transcript, transcriptData.turns, transcriptData.speakerLabels),
      source: firstDefined(row, ["source", "dataset"], "MeetingBank"),
      meetingId,
      city: firstDefined(row, ["city", "location"], null),
      date: firstDefined(row, ["date", "meeting_date", "meetingDate"], null),
      type: row.type ?? null,
      segment: segment,
      segmentBoundary: hasBoundary ? segmentBoundary : null,
      evaluationMode,
      agenda: firstDefined(row, ["agenda", "agenda_items", "agendaItems"], null),
      agendaAvailable: Boolean(row.agenda ?? row.agenda_items ?? row.agendaItems),
      referenceProvenance: referenceData.provenance,
      referenceCandidates: referenceData.references,
      referenceAvailable: Boolean(referenceData.text)
    }
  };
}

function qmsumSample(row, index, queryRecord = null, queryIndex = 0) {
  const queryRow = queryRecord ? {
    ...row,
    query: queryRecord.query,
    answer: queryRecord.answer,
    relevant_text_span: queryRecord.relevant_text_span
  } : row;
  const transcriptData = transcriptParts(queryRow, ["meeting", "transcript", "meeting_transcripts", "source", "text"]);
  const query = String(firstDefined(queryRow, ["query", "question", "query_text"], "Summarize the meeting."));
  const referenceData = referenceParts(firstDefined(queryRow, ["answer", "summary", "reference"], ""));
  const meetingId = String(firstDefined(row, ["meeting_id", "meetingId", "id", "uid"], `qmsum-${index + 1}`));
  const evaluationMode = String(queryRecord?.evaluationMode ?? firstDefined(queryRow, ["evaluation_mode", "evaluationMode"], /^summarize the whole meeting\.?$/iu.test(query) || query === "Summarize the meeting." ? "full-meeting" : "query-focused"));
  return {
    id: String(queryRecord ? `${row.id ?? meetingId}-${queryIndex + 1}` : (row.id ?? `${meetingId}-${queryIndex + 1}`)),
    prompt: `${evaluationMode === "query-focused" ? "Answer the meeting question" : "Summarize the full meeting"} using only the relevant meeting evidence.\n\nQUESTION:\n${query}\n\nMEETING:\n${transcriptData.transcript}`,
    reference: referenceData.text,
    input: transcriptData.transcript,
    query,
    metadata: {
      ...transcriptMetadata(transcriptData.transcript, transcriptData.turns, transcriptData.speakerLabels),
      source: "QMSum",
      meetingId,
      topic: queryRecord?.topic ?? row.topic ?? row.topic_list ?? null,
      relevantTextSpan: queryRow.relevant_text_span ?? queryRow.relevant_text_spans ?? queryRow.relevant_spans ?? null,
      queryType: queryRecord?.queryType ?? row.query_type ?? row.queryType ?? "general",
      evaluationMode,
      referenceProvenance: referenceData.provenance,
      referenceCandidates: referenceData.references,
      referenceAvailable: Boolean(referenceData.text)
    }
  };
}

function qmsumSamples(row, index) {
  const general = Array.isArray(row.general_query_list)
    ? row.general_query_list.map(query => ({ ...query, queryType: "general", evaluationMode: "full-meeting" }))
    : [];
  const specific = Array.isArray(row.specific_query_list)
    ? row.specific_query_list.map(query => ({ ...query, queryType: "specific", evaluationMode: "query-focused" }))
    : [];
  const queries = [...general, ...specific];
  return queries.length ? queries.map((query, queryIndex) => qmsumSample(row, index, query, queryIndex)) : [qmsumSample(row, index)];
}

function corpusSample(row, index, corpus, fields = ["transcript", "source", "text", "dialogue"]) {
  const transcriptData = transcriptParts(row, fields);
  const referenceData = referenceParts(firstDefined(row, ["summary", "reference", "target", "answer"], ""));
  const meetingId = String(firstDefined(row, ["meeting_id", "meetingId", "id", "key"], `${corpus.toLowerCase()}-${index + 1}`));
  return {
    id: String(row.id ?? meetingId),
    prompt: `Summarize this ${corpus} meeting. Preserve speaker attribution, decisions, problems, and actions where present.\n\nTRANSCRIPT:\n${transcriptData.transcript}`,
    reference: referenceData.text,
    input: transcriptData.transcript,
    metadata: {
      ...transcriptMetadata(transcriptData.transcript, transcriptData.turns, transcriptData.speakerLabels),
      source: firstDefined(row, ["source", "corpus"], corpus),
      corpus,
      meetingId,
      speakers: row.speakers ?? row.participants ?? transcriptData.speakerLabels,
      preparation: row.preparation ?? row.preparationProvenance ?? null,
      accessStatus: row.accessStatus ?? row.access_status ?? "user-supplied",
      referenceProvenance: referenceData.provenance,
      referenceCandidates: referenceData.references,
      referenceAvailable: Boolean(referenceData.text)
    }
  };
}

function dialogSumSample(row, index) {
  const transcriptData = transcriptParts(row, ["dialogue", "transcript", "text"]);
  const referenceData = referenceParts(row.summary ?? row.reference ?? "");
  return {
    id: String(row.id ?? `dialogsum-${index + 1}`),
    prompt: `Summarize this dialogue. Preserve the important participants, topic, and outcome.\n\nDIALOGUE:\n${transcriptData.transcript}`,
    reference: referenceData.text,
    input: transcriptData.transcript,
    metadata: {
      ...transcriptMetadata(transcriptData.transcript, transcriptData.turns, transcriptData.speakerLabels),
      source: "DialogSum",
      topic: row.topic ?? null,
      evaluationMode: "dialogue-summary",
      adjacentBenchmark: true,
      referenceProvenance: referenceData.provenance,
      referenceAvailable: Boolean(referenceData.text)
    }
  };
}

function normalizeLongBenchTask(value) {
  const key = String(value ?? "unknown").toLowerCase().replace(/[ _-]+/gu, "");
  return { govreport: "GovReport", multinews: "MultiNews", qmsum: "QMSum", vcsum: "VCSUM" }[key] ?? String(value ?? "unknown");
}

function longBenchSummarySample(row, index) {
  const task = normalizeLongBenchTask(firstDefined(row, ["task", "dataset", "sub_dataset", "subDataset", "name"], "unknown"));
  const transcriptData = transcriptParts(row, ["context", "input", "passage", "transcript", "text"]);
  const referenceData = referenceParts(firstDefined(row, ["answer", "answers", "summary", "reference", "target"], ""));
  const taskInput = String(row.input ?? row.question ?? "").trim();
  return {
    id: String(row.id ?? row._id ?? `${task}-${index + 1}`),
    prompt: `Summarize the ${task} source faithfully. Preserve the important information and avoid unsupported claims.${taskInput ? `\n\nTASK:\n${taskInput}` : ""}\n\nSOURCE:\n${transcriptData.transcript}`,
    reference: referenceData.text,
    input: transcriptData.transcript,
    metadata: {
      ...transcriptMetadata(transcriptData.transcript, transcriptData.turns, transcriptData.speakerLabels),
      source: "LongBench v1",
      task,
      taskInput: taskInput || null,
      officialScoring: row.scoring ?? "ROUGE",
      referenceProvenance: referenceData.provenance,
      referenceCandidates: referenceData.references,
      referenceAvailable: Boolean(referenceData.text)
    },
    contextLength: Number(row.context_length ?? row.contextLength ?? row.length ?? 0) || null
  };
}

function longBenchSample(row, index) {
  const options = row.options ?? row.choices ?? [row.A, row.B, row.C, row.D].filter(value => value !== undefined);
  const optionLines = Array.isArray(options)
    ? options.map((value, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${value}`).join("\n")
    : Object.entries(options).map(([key, value]) => `${key}. ${value}`).join("\n");
  const context = row.context ?? row.input ?? row.passage ?? "";
  const question = row.question ?? row.prompt ?? "";
  const input = [context, question, optionLines].filter(Boolean).join("\n\n");
  return {
    id: String(row.id ?? row._id ?? `longbench-${index + 1}`),
    prompt: `Read the context and answer the multiple-choice question. Return only the answer letter.\n\nCONTEXT:\n${context}\n\nQUESTION:\n${question}\n\nOPTIONS:\n${optionLines}`,
    reference: String(row.answer ?? row.label ?? ""),
    input,
    expectedAnswer: String(row.answer ?? row.label ?? "").trim(),
    metadata: { category: row.category ?? null, subcategory: row.subcategory ?? null, difficulty: row.difficulty ?? null, source: "LongBench v2" },
    contextLength: Number(row.context_length ?? row.contextLength ?? row.length ?? 0) || null
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
    metadata: { locale: row.locale ?? null, source: "IFEval", referenceAvailable: false }
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
      metadata: { ...transcriptMetadata(transcript), fixtureDirectory: dir, transcriptHashInput: transcript, source: "HelpOS-local", meetingId: id, referenceAvailable: Boolean(referenceText) }
    });
  }
  return samples;
}

async function loadCorpusFixtures({ fixtureRoot, fixtureId, corpus }) {
  const root = fixtureRoot ? path.resolve(fixtureRoot) : path.resolve("criterion", "fixtures", corpus.toLowerCase());
  const ids = fixtureId ? [fixtureId] : await fs.readdir(root, { withFileTypes: true }).then(entries => entries.filter(entry => entry.isDirectory()).map(entry => entry.name));
  const samples = [];
  for (const id of ids.sort()) {
    const dir = path.join(root, id);
    const transcript = await fs.readFile(path.join(dir, "transcript.txt"), "utf8");
    const reference = await readOptionalJson(path.join(dir, "reference.json"));
    const metadata = await readOptionalJson(path.join(dir, "metadata.json"));
    const turns = await readOptionalJson(path.join(dir, "turns.json"));
    let summary = reference;
    if (summary === null) {
      try { summary = await fs.readFile(path.join(dir, "summary.txt"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const row = { id, transcript, summary, turns: Array.isArray(turns) ? turns : undefined, ...(metadata ?? {}) };
    samples.push(corpusSample(row, samples.length, corpus));
  }
  return samples;
}

async function hashPath(filepath) {
  if (!filepath) return null;
  try {
    const stat = await fs.stat(filepath);
    if (stat.isFile()) return sha256(await fs.readFile(filepath));
    return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadSuiteSamples({ benchmark, datasetPath, split = "test", fixtureRoot, fixtureId } = {}) {
  const key = String(benchmark ?? "").toLowerCase().replace(/[_ ]/gu, "-");
  if (!SUITE_CATALOG[key]) throw new Error(`unknown criterion suite: ${benchmark}`);
  if (key === "helpos-local" || key === "ami" || key === "icsi") {
    if (key === "helpos-local") {
      const samples = await loadHelpOSFixtures({ fixtureRoot: datasetPath ?? fixtureRoot, fixtureId });
      return { key, catalog: SUITE_CATALOG[key], samples, datasetHash: datasetPath ? await hashPath(datasetPath) : sha256(stableJson(samples)), actualSplit: "provided", availableSplits: [] };
    }
    if (!datasetPath) {
      const samples = await loadCorpusFixtures({ fixtureRoot, fixtureId, corpus: key.toUpperCase() });
      return { key, catalog: SUITE_CATALOG[key], samples, datasetHash: sha256(stableJson(samples)), actualSplit: "fixture", availableSplits: [] };
    }
    const data = await readDatasetFile(datasetPath);
    const selection = selectSplit(data, split, datasetPath);
    const samples = selection.rows.map((row, index) => corpusSample(row, index, key.toUpperCase()));
    return { key, catalog: SUITE_CATALOG[key], samples, datasetHash: await hashPath(datasetPath), actualSplit: selection.actualSplit, availableSplits: selection.availableSplits };
  }
  if (!datasetPath) throw new Error(`${SUITE_CATALOG[key].name} dataset is not configured; pass --dataset or set a local cache path (datasets are never downloaded implicitly)`);
  const data = await readDatasetFile(datasetPath);
  const selection = selectSplit(data, split, datasetPath);
  const adapters = {
    meetingbank: meetingBankSample,
    qmsum: qmsumSamples,
    dialogsum: dialogSumSample,
    "longbench-summary": longBenchSummarySample,
    longbench: longBenchSample,
    ifeval: ifevalSample,
    "mmlu-pro": longBenchSample,
    gpqa: longBenchSample
  };
  const adapter = adapters[key];
  if (!adapter) throw new Error(`criterion suite adapter is not implemented: ${key}`);
  const samples = selection.rows.flatMap(adapter);
  return { key, catalog: SUITE_CATALOG[key], samples, datasetHash: await hashPath(datasetPath), actualSplit: selection.actualSplit, availableSplits: selection.availableSplits };
}
