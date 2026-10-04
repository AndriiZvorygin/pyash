#!/usr/bin/env node

import path from "node:path";

import {
  DEFAULT_PRINT_JOURNAL_ROOT,
  readAllPrintJournals,
  summarizePrintRecords
} from "../program/library/print_audit/journal.mjs";

const root = process.env.PYA_PRINT_JOURNAL_ROOT || DEFAULT_PRINT_JOURNAL_ROOT;
const selector = process.argv[2] || "today";
const timezone = process.env.TZ || "America/Toronto";

function localParts(timestamp) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`
  };
}

function matches(summary) {
  if (selector === "all") return true;
  const today = localParts(new Date()).date;
  const target = selector === "today" ? today : selector;
  return summary.events.some((event) => {
    const day = localParts(event.timestamp).date;
    return /^\d{4}-\d{2}$/u.test(target) ? day.startsWith(target) : day === target;
  });
}

function shorten(value, width) {
  const text = String(value || "");
  if (text.length <= width) return text;
  return `...${text.slice(-(width - 3))}`;
}

const summaries = summarizePrintRecords(await readAllPrintJournals(root)).filter(matches);
if (!summaries.length) {
  process.stdout.write(`No print records found for ${selector}.\n`);
  process.exit(0);
}

const rows = summaries.map((summary) => {
  const when = localParts(summary.firstRecord.timestamp);
  const source = summary.sourcePaths?.[0] || summary.title || "unknown";
  const directory = summary.sourceDirectories?.[0] || summary.cwd || "unknown";
  return {
    date: when.date,
    time: when.time,
    user: summary.user || "unknown",
    copies: String(summary.copies || 1),
    file: path.basename(source),
    directory,
    printer: summary.printer_profile || summary.cups_queue || summary.printer || "unknown",
    sheets: String(summary.physical_sheets_completed
      ?? (["completed", "reconciled"].includes(summary.status) ? (summary.physical_sheets_requested ?? "?") : "?")),
    cost: `$${Number(summary.estimated_total_cost || 0).toFixed(2)}`,
    job: summary.cupsJobId || "-",
    status: summary.status || "unknown"
  };
});

const headers = { date: "DATE", time: "TIME", user: "USER", copies: "COPIES", sheets: "SHEETS", cost: "EST.COST", file: "FILE", directory: "DIRECTORY", printer: "PRINTER PROFILE", job: "JOB", status: "STATUS" };
const widths = { date: 10, time: 8, user: 10, copies: 6, sheets: 6, cost: 9, file: 28, directory: 36, printer: 28, job: 32, status: 10 };
const keys = Object.keys(headers);
const render = (row) => keys.map((key) => shorten(row[key], widths[key]).padEnd(widths[key])).join("  ").trimEnd();
process.stdout.write(`${render(headers)}\n`);
process.stdout.write(`${keys.map((key) => "-".repeat(widths[key])).join("  ")}\n`);
for (const row of rows) process.stdout.write(`${render(row)}\n`);
