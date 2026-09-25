import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { splitSentences } from "../sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

export const DEFAULT_PRINT_JOURNAL_ROOT = path.join(os.homedir(), "world", "newspaper");

const STATUS_PRIORITY = new Map([
  ["prepared", 1],
  ["created", 2],
  ["accepted", 3],
  ["pending", 4],
  ["held", 5],
  ["processing", 6],
  ["stopped", 7],
  ["cancelled", 8],
  ["aborted", 9],
  ["rejected", 10],
  ["completed", 11],
  ["reconciled", 12]
]);

const DETAIL_FIELDS = [
  "cups_queue", "printer_make_model", "printer_uuid", "printer_serial", "device_uri", "cups_server",
  "printer_profile", "printer_profile_version", "campaign", "paper_profile", "cost_basis",
  "document_pages", "printed_impressions_requested", "printed_impressions_completed",
  "physical_sheets_requested", "physical_sheets_completed", "paper_cost", "estimated_ink_cost",
  "maintenance_cost", "electricity_cost", "equipment_use_cost", "estimated_total_cost",
  "original_estimated_total_cost", "confirmed_physical_copies", "spoiled_or_jammed_sheets",
  "reconciliation_date", "reconciliation_user", "reconciliation_note"
];
const NUMBER_DETAIL_FIELDS = new Set([
  "document_pages", "printed_impressions_requested", "printed_impressions_completed",
  "physical_sheets_requested", "physical_sheets_completed", "paper_cost", "estimated_ink_cost",
  "maintenance_cost", "electricity_cost", "equipment_use_cost", "estimated_total_cost",
  "original_estimated_total_cost", "confirmed_physical_copies", "spoiled_or_jammed_sheets"
]);

function encodeSnapshot(value) {
  return value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url") : "";
}

function decodeSnapshot(value) {
  try { return value ? JSON.parse(Buffer.from(value, "base64url").toString("utf8")) : null; } catch { return null; }
}

function eventDetails(event = {}) {
  const details = [...(event.details || [])];
  for (const field of DETAIL_FIELDS) {
    const value = event[field];
    if (value !== undefined && value !== null && value !== "") details.push(`${field}=${value}`);
  }
  if (event.printer_profile_snapshot) details.push(`printer_profile_snapshot64=${encodeSnapshot(event.printer_profile_snapshot)}`);
  if (event.cost_snapshot) details.push(`cost_snapshot64=${encodeSnapshot(event.cost_snapshot)}`);
  return [...new Set(details)];
}

function parsedDetails(details = []) {
  const values = {};
  for (const detail of details) {
    const equal = String(detail).indexOf("=");
    if (equal < 1) continue;
    const key = String(detail).slice(0, equal);
    const value = String(detail).slice(equal + 1);
    if (DETAIL_FIELDS.includes(key)) values[key] = NUMBER_DETAIL_FIELDS.has(key) ? Number(value) : value;
    if (key === "printer_profile_snapshot64") values.printer_profile_snapshot = decodeSnapshot(value);
    if (key === "cost_snapshot64") values.cost_snapshot = decodeSnapshot(value);
  }
  return values;
}

function textVector(values = []) {
  const normalized = values.map((value) => String(value ?? ""));
  return normalized.length ? { ve: { type: "text", values: normalized } } : undefined;
}

function numberVector(values = []) {
  const normalized = values.map(Number).filter(Number.isFinite);
  return normalized.length ? { ve: { type: "num", values: normalized } } : undefined;
}

function argumentVector(values = []) {
  return textVector(values.map((value) => `argument:${String(value ?? "")}`));
}

function vectorValues(np) {
  return Array.isArray(np?.ve?.values) ? np.ve.values : [];
}

function textValue(np) {
  if (typeof np?.text === "string") return np.text;
  if (typeof np?.name === "string") return np.name;
  return "";
}

function numberValue(np, fallback = 0) {
  const value = Number(np?.num);
  return Number.isFinite(value) ? value : fallback;
}

export function localDayStamp(now = new Date(), timezone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}`;
}

export function printJournalPath({
  root = DEFAULT_PRINT_JOURNAL_ROOT,
  timestamp = new Date(),
  timezone = "America/Toronto"
} = {}) {
  return path.join(root, `${localDayStamp(timestamp, timezone)}-print.pya`);
}

export function buildPrintSentence(event = {}) {
  const {
    eventId = crypto.randomUUID(), status = "status", timestamp = new Date().toISOString(),
    sourcePaths = [], canonicalPaths = [], sourceDirectories = [], sourceSizes = [], sourceHashes = [],
    cwd = "", copies = 1, printer = "", cupsJobId = "", title = "", user = "", args = [], details = []
  } = event;
  const sentence = {
    mood: "ya",
    su: { name: `print ${String(eventId).trim() || crypto.randomUUID()}` },
    be: "print",
    as: { text: String(status || "status") },
    during: { date: String(timestamp || new Date().toISOString()) }
  };

  const source = textVector(sourcePaths);
  const canonical = textVector(canonicalPaths);
  const directories = textVector(sourceDirectories);
  const sizes = numberVector(sourceSizes);
  const hashes = textVector(sourceHashes);
  const optionArgs = argumentVector(args);
  const detailValues = textVector(eventDetails({ ...event, details }));

  if (source) sentence.ob = source;
  if (canonical) sentence.from = canonical;
  if (directories) sentence.in = directories;
  if (sizes) sentence.beneath = sizes;
  if (hashes) sentence.fromtext = hashes;
  if (optionArgs) sentence.with = optionArgs;
  if (detailValues) sentence.among = detailValues;
  if (cwd) sentence.at = { text: String(cwd) };
  if (Number(copies) > 0) sentence.by = { num: Math.max(1, Number.parseInt(copies, 10) || 1) };
  if (printer) sentence.to = { text: String(printer) };
  if (cupsJobId) sentence.accordingto = { text: String(cupsJobId) };
  if (title) sentence.totext = { text: String(title) };
  if (user) sentence.for = { text: String(user) };

  return sentence;
}

export function printSentenceToRecord(sentence = {}) {
  if (sentence?.be !== "print") return null;
  const subject = String(sentence?.su?.name || "");
  const eventId = subject.startsWith("print ") ? subject.slice(6) : subject;
  const details = vectorValues(sentence.among).map(String);
  return {
    eventId,
    status: textValue(sentence.as),
    timestamp: String(sentence?.during?.date || ""),
    sourcePaths: vectorValues(sentence.ob).map(String),
    canonicalPaths: vectorValues(sentence.from).map(String),
    sourceDirectories: vectorValues(sentence.in).map(String),
    sourceSizes: vectorValues(sentence.beneath).map(Number),
    sourceHashes: vectorValues(sentence.fromtext).map(String),
    cwd: textValue(sentence.at),
    copies: numberValue(sentence.by, 0),
    printer: textValue(sentence.to),
    cupsJobId: textValue(sentence.accordingto),
    title: textValue(sentence.totext),
    user: textValue(sentence.for),
    args: vectorValues(sentence.with).map(String).map((value) => value.startsWith("argument:") ? value.slice(9) : value),
    details,
    ...parsedDetails(details),
    raw: sentence
  };
}

export async function appendPrintEvent(event, {
  root = DEFAULT_PRINT_JOURNAL_ROOT,
  timezone = "America/Toronto",
  sync = true
} = {}) {
  const sentence = buildPrintSentence(event);
  const parsedTime = new Date(event?.timestamp || sentence.during.date);
  const timestamp = Number.isNaN(parsedTime.getTime()) ? new Date() : parsedTime;
  const target = printJournalPath({ root, timestamp, timezone });
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await fs.open(target, "a", 0o600);
  try {
    await handle.write(`${sentenceToPyash(sentence)}\n`, null, "utf8");
    if (sync) await handle.sync();
  } finally {
    await handle.close();
  }
  return { target, sentence, record: printSentenceToRecord(sentence) };
}

export function parsePrintJournalText(text = "") {
  const records = [];
  for (const raw of splitSentences(String(text))) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const record = printSentenceToRecord(parse(line));
    if (record) records.push(record);
  }
  return records;
}

export async function readPrintJournal(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parsePrintJournalText(text);
}

export async function listPrintJournalFiles(root = DEFAULT_PRINT_JOURNAL_ROOT) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile() && /^\d{8}-print\.pya$/u.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

export async function readAllPrintJournals(root = DEFAULT_PRINT_JOURNAL_ROOT) {
  const records = [];
  for (const filePath of await listPrintJournalFiles(root)) {
    records.push(...await readPrintJournal(filePath));
  }
  return records;
}

function newerRecord(current, candidate) {
  if (!current) return candidate;
  const currentTime = Date.parse(current.timestamp) || 0;
  const candidateTime = Date.parse(candidate.timestamp) || 0;
  return candidateTime >= currentTime ? candidate : current;
}

export function summarizePrintRecords(records = []) {
  const byEventId = new Map();
  const byJobId = new Map();

  for (const record of records) {
    const event = byEventId.get(record.eventId) || {};
    const merged = { ...event, ...record };
    for (const key of ["sourcePaths", "canonicalPaths", "sourceDirectories", "sourceSizes", "sourceHashes", "args", "details"]) {
      if (!record[key]?.length && event[key]?.length) merged[key] = event[key];
    }
    byEventId.set(record.eventId, merged);
  }

  for (const record of byEventId.values()) {
    const key = record.cupsJobId || `event:${record.eventId}`;
    const summary = byJobId.get(key) || {
      key,
      events: [],
      status: "",
      statusRecord: null
    };
    summary.events.push(record);
    for (const field of ["sourcePaths", "canonicalPaths", "sourceDirectories", "sourceSizes", "sourceHashes", "args", "details"]) {
      if (!summary[field]?.length && record[field]?.length) summary[field] = record[field];
    }
    for (const field of ["cwd", "printer", "cupsJobId", "title", "user"]) {
      if (!summary[field] && record[field]) summary[field] = record[field];
    }
    if (record.copies) summary.copies = record.copies;
    for (const field of [...DETAIL_FIELDS, "printer_profile_snapshot", "cost_snapshot"]) {
      if (record[field] !== undefined && record[field] !== "" && record[field] !== null) summary[field] = record[field];
    }
    summary.firstRecord = summary.firstRecord
      ? (Date.parse(record.timestamp) < Date.parse(summary.firstRecord.timestamp) ? record : summary.firstRecord)
      : record;
    summary.lastRecord = newerRecord(summary.lastRecord, record);
    const priority = STATUS_PRIORITY.get(record.status) || 0;
    const currentPriority = STATUS_PRIORITY.get(summary.status) || 0;
    if (priority >= currentPriority) {
      summary.status = record.status;
      summary.statusRecord = record;
    }
    byJobId.set(key, summary);
  }

  for (const summary of byJobId.values()) {
    const unreliableCompletedZero = summary.status === "completed"
      && summary.printed_impressions_completed === 0
      && summary.physical_sheets_completed === 0
      && !summary.printed_impressions_requested
      && !summary.physical_sheets_requested;
    if (unreliableCompletedZero) {
      for (const field of [
        "printed_impressions_completed", "physical_sheets_completed", "paper_cost", "estimated_ink_cost",
        "maintenance_cost", "electricity_cost", "equipment_use_cost", "estimated_total_cost", "cost_basis"
      ]) delete summary[field];
    }
  }

  return [...byJobId.values()].sort((a, b) => {
    return (Date.parse(a.firstRecord?.timestamp) || 0) - (Date.parse(b.firstRecord?.timestamp) || 0);
  });
}

export async function hasPrintEvent(eventId, {
  root = DEFAULT_PRINT_JOURNAL_ROOT,
  timestamp = new Date(),
  timezone = "America/Toronto"
} = {}) {
  const target = printJournalPath({ root, timestamp, timezone });
  try {
    const records = await readPrintJournal(target);
    return records.some((record) => record.eventId === eventId);
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}
