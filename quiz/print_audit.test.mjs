import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  appendPrintEvent,
  buildPrintSentence,
  parsePrintJournalText,
  printSentenceToRecord,
  summarizePrintRecords
} from "../program/library/print_audit/journal.mjs";
import {
  collectPrintSources,
  forceLetterMedia,
  parseLpArguments,
  parseLpRequestIds,
  runAuditedLp
} from "../program/library/print_audit/lp.mjs";
import {
  cupsEventDetails,
  parseDbusJobMessage,
  parseIpptoolPlist,
  parseLpstatJobs
} from "../program/library/print_audit/cups.mjs";
import { calculatePrintCost, calculatePrintMetrics, createCostSnapshot } from "../program/library/print_audit/cost.mjs";
import { resolvePrinterProfile, sanitizeDeviceUri } from "../program/library/print_audit/profile.mjs";
import { appendPrintReconciliation } from "../program/library/print_audit/reconcile.mjs";

test("print audit sentence round-trips paths, copies, hashes, and CUPS identity", () => {
  const sentence = buildPrintSentence({
    eventId: "request-1",
    status: "accepted",
    timestamp: "2026-07-10T12:00:00.000Z",
    sourcePaths: ["/tmp/a campaign file.pdf"],
    canonicalPaths: ["/tmp/a campaign file.pdf"],
    sourceDirectories: ["/tmp"],
    sourceSizes: [1234],
    sourceHashes: ["abc123"],
    cwd: "/tmp",
    copies: 25,
    printer: "EPSON",
    cupsJobId: "EPSON-42",
    title: "a campaign file.pdf",
    user: "htaf",
    args: ["-n", "25", "a campaign file.pdf"],
    details: ["sides=two-sided-short-edge"]
  });
  const record = printSentenceToRecord(parse(sentenceToPyash(sentence)));
  assert.equal(record.eventId, "request-1");
  assert.equal(record.status, "accepted");
  assert.equal(record.copies, 25);
  assert.deepEqual(record.sourcePaths, ["/tmp/a campaign file.pdf"]);
  assert.deepEqual(record.sourceSizes, [1234]);
  assert.deepEqual(record.sourceHashes, ["abc123"]);
  assert.equal(record.cupsJobId, "EPSON-42");
});

test("print audit preserves lp arguments that are also Pyash keywords", () => {
  const sentence = buildPrintSentence({
    eventId: "keyword-arguments",
    args: ["for", "to", "ya", "be", "normal"]
  });
  const record = printSentenceToRecord(parse(sentenceToPyash(sentence)));
  assert.deepEqual(record.args, ["for", "to", "ya", "be", "normal"]);
});

test("appendPrintEvent creates a parseable append-only daily Pyash journal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-print-journal-"));
  await appendPrintEvent({ eventId: "one", status: "prepared", timestamp: "2026-07-10T12:00:00.000Z" }, { root, sync: false });
  await appendPrintEvent({ eventId: "one", status: "accepted", timestamp: "2026-07-10T12:00:01.000Z", cupsJobId: "P-1" }, { root, sync: false });
  const files = await fs.readdir(root);
  assert.deepEqual(files, ["20260710-print.pya"]);
  const records = parsePrintJournalText(await fs.readFile(path.join(root, files[0]), "utf8"));
  assert.deepEqual(records.map(({ status }) => status), ["prepared", "accepted"]);
});

test("summarizePrintRecords joins wrapper and CUPS events by request id", () => {
  const records = [
    { eventId: "wrapper", status: "accepted", timestamp: "2026-07-10T12:00:00Z", cupsJobId: "P-7", copies: 3, sourcePaths: ["/tmp/f.pdf"], sourceDirectories: ["/tmp"] },
    { eventId: "cups-created", status: "created", timestamp: "2026-07-10T12:00:01Z", cupsJobId: "P-7", copies: 3, title: "f.pdf", user: "htaf" },
    { eventId: "cups-done", status: "completed", timestamp: "2026-07-10T12:00:02Z", cupsJobId: "P-7", copies: 3, printer: "P" }
  ];
  const [summary] = summarizePrintRecords(records);
  assert.equal(summary.status, "completed");
  assert.equal(summary.copies, 3);
  assert.deepEqual(summary.sourcePaths, ["/tmp/f.pdf"]);
  assert.equal(summary.user, "htaf");
});

test("parseLpArguments finds options even when they follow the filename", () => {
  const parsed = parseLpArguments([
    "book.pdf", "-n", "12", "-dEPSON", "-o", "sides=two-sided-short-edge", "--", "-appendix.pdf"
  ], {});
  assert.equal(parsed.copies, 12);
  assert.equal(parsed.printer, "EPSON");
  assert.deepEqual(parsed.files, ["book.pdf", "-appendix.pdf"]);
});

test("forceLetterMedia replaces A4 and media-col with one final Letter option", () => {
  const args = forceLetterMedia([
    "flyer.pdf", "-o", "media=A4", "-omedia-col={media-size-name=iso_a4_210x297mm}", "-o", "sides=two-sided-short-edge"
  ]);
  assert.deepEqual(args, ["flyer.pdf", "-o", "sides=two-sided-short-edge", "-o", "media=Letter"]);
});

test("forceLetterMedia inserts Letter before the end-of-options marker", () => {
  assert.deepEqual(
    forceLetterMedia(["-n", "2", "--", "-leading-dash.pdf"]),
    ["-n", "2", "-o", "media=Letter", "--", "-leading-dash.pdf"]
  );
});

test("collectPrintSources records an exact SHA-256 and source directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-print-source-"));
  const source = path.join(root, "source file.pdf");
  await fs.writeFile(source, "print audit fixture", "utf8");
  const [record] = await collectPrintSources(["source file.pdf"], root);
  assert.equal(record.absolute, source);
  assert.equal(record.directory, root);
  assert.equal(record.size, 19);
  assert.equal(record.sha256, "dbe644e7d4e43d09583b4a38d22a05b506c64610d10500d81201145bcd21269e");
});

test("runAuditedLp writes prepared and accepted events around a successful submission", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-print-wrapper-"));
  const source = path.join(root, "flyer.pdf");
  await fs.writeFile(source, "flyer", "utf8");
  const events = [];
  const code = await runAuditedLp(["flyer.pdf", "-n", "4"], {
    cwd: root,
    journalRoot: root,
    appendEvent: async (event) => { events.push(event); },
    runProcess: async () => ({ code: 0, signal: null, stdout: "request id is TEST-99 (1 file(s))\n" }),
    now: () => new Date("2026-07-10T12:00:00Z"),
    user: "tester"
  });
  assert.equal(code, 0);
  assert.deepEqual(events.map(({ status }) => status), ["prepared", "accepted"]);
  assert.equal(events[1].cupsJobId, "TEST-99");
  assert.equal(events[1].copies, 4);
  assert.equal(events[1].sourcePaths[0], source);
  assert.deepEqual(events[1].args.slice(-2), ["-o", "media=Letter"]);
});

test("runAuditedLp fails closed before submission when provenance cannot be journaled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-print-closed-"));
  const source = path.join(root, "flyer.pdf");
  await fs.writeFile(source, "flyer", "utf8");
  let submitted = false;
  const code = await runAuditedLp([source], {
    appendEvent: async () => { throw new Error("read-only journal"); },
    runProcess: async () => { submitted = true; return { code: 0, stdout: "" }; }
  });
  assert.equal(code, 73);
  assert.equal(submitted, false);
});

test("runAuditedLp passes help through without creating an audit event", async () => {
  let appended = false;
  let submitted = false;
  const code = await runAuditedLp(["--help"], {
    appendEvent: async () => { appended = true; },
    runProcess: async () => { submitted = true; return { code: 0, stdout: "Usage: lp" }; }
  });
  assert.equal(code, 0);
  assert.equal(submitted, true);
  assert.equal(appended, false);
});

test("parseLpRequestIds accepts standard CUPS output", () => {
  assert.deepEqual(parseLpRequestIds("request id is EPSON-1847 (2 file(s))\n"), ["EPSON-1847"]);
});

test("parseDbusJobMessage reads the documented CUPS job signal order", () => {
  const event = parseDbusJobMessage([
    "signal time=1783700000.250 sender=:1.1 -> destination=(null destination) serial=1 path=/org/cups/cupsd/Notifier; interface=org.cups.cupsd.Notifier; member=JobCompleted",
    "   string \"Printed\"",
    "   string \"ipp://localhost/printers/EPSON\"",
    "   string \"EPSON\"",
    "   uint32 3",
    "   string \"none\"",
    "   boolean true",
    "   uint32 1847",
    "   uint32 9",
    "   string \"job-completed-successfully\"",
    "   string \"flyer.pdf\"",
    "   uint32 8"
  ]);
  assert.equal(event.member, "JobCompleted");
  assert.equal(event.jobId, 1847);
  assert.equal(event.status, "completed");
  assert.equal(event.impressions, 8);
  assert.equal(event.printer, "EPSON");
});

test("parseDbusJobMessage treats a JobCompleted cancellation by its CUPS state", () => {
  const event = parseDbusJobMessage([
    "signal time=1783700000.250 sender=:1.1 -> destination=(null destination) serial=1 path=/org/cups/cupsd/Notifier; interface=org.cups.cupsd.Notifier; member=JobCompleted",
    "   string \"Job canceled\"",
    "   string \"ipp://localhost/printers/EPSON\"",
    "   string \"EPSON\"",
    "   uint32 3",
    "   string \"none\"",
    "   boolean true",
    "   uint32 1847",
    "   uint32 7",
    "   string \"job-canceled-by-user\"",
    "   string \"flyer.pdf\"",
    "   uint32 0"
  ]);
  assert.equal(event.status, "cancelled");
});

test("parseIpptoolPlist and cupsEventDetails retain copies and print settings", () => {
  const xml = `<?xml version="1.0"?><plist><dict><key>Tests</key><array><dict><key>Operation</key><string>Get-Job-Attributes</string><key>ResponseAttributes</key><array><dict><key>copies</key><integer>6</integer><key>job-name</key><string>book.pdf</string><key>job-originating-user-name</key><string>caleb</string><key>sides</key><string>two-sided-short-edge</string></dict></array></dict></array></dict></plist>`;
  const payload = parseIpptoolPlist(xml);
  const attrs = payload.Tests[0].ResponseAttributes[0];
  const details = cupsEventDetails({ member: "JobCreated", jobId: 8, status: "created", printer: "P", timestamp: "2026-07-10T12:00:00Z" }, attrs);
  assert.equal(details.copies, 6);
  assert.equal(details.title, "book.pdf");
  assert.equal(details.user, "caleb");
  assert.ok(details.details.includes("sides=two-sided-short-edge"));
});

test("completed zero CUPS counters are treated as unavailable", () => {
  const details = cupsEventDetails({ status: "completed", printer: "P" }, {
    "job-impressions-completed": 0, "job-media-sheets-completed": 0
  });
  assert.equal(details.printed_impressions_completed, undefined);
  assert.equal(details.physical_sheets_completed, undefined);
});

test("parseLpstatJobs deduplicates jobs and retains the submitting user", () => {
  const jobs = parseLpstatJobs([
    "EPSON_DUPLEX-1848 htaf 2209792 Fri Jul 10 15:22:11 2026",
    "EPSON_DUPLEX-1848 htaf 2209792 Fri Jul 10 15:22:11 2026",
    "EPSON_DUPLEX-1849 caleb 1024 Fri Jul 10 15:25:00 2026"
  ].join("\n"));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].key, "EPSON_DUPLEX-1848");
  assert.equal(jobs[0].user, "htaf");
  assert.equal(jobs[1].user, "caleb");
});

const profile2980 = {
  id: "epson-et-2980-home", version: "v1", effective_date: "2026-01-01T00:00:00Z",
  queues: ["HOME", "HOME_DUPLEX"], match: { printer_uuid: "uuid-2980", make_model_pattern: "ET-2980" },
  ink_bottles: [{ colour: "black", price: 20, rated_yield_pages: 4000 }],
  allowances: { maintenance_cost_per_sheet: 0.01, equipment_use_cost_per_sheet: 0.02 },
  default_paper_profile: "letter", paper_profiles: { letter: { media: ["Letter"], cost_per_sheet: 0.03 } }
};
const profile5850 = {
  ...profile2980, id: "epson-et-5850-liberit", version: "v2", queues: [],
  match: { printer_uuid: "uuid-5850", make_model_pattern: "ET-5850" }
};

test("two CUPS queues resolving to one UUID retain one physical printer profile", () => {
  for (const cups_queue of ["HOME", "HOME_DUPLEX"]) {
    assert.equal(resolvePrinterProfile([profile2980], { cups_queue, printer_uuid: "uuid-2980" })?.id, "epson-et-2980-home");
  }
});

test("physical identity overrides a queue redirected from ET-2980 to ET-5850", () => {
  const resolved = resolvePrinterProfile([profile2980, profile5850], {
    cups_queue: "HOME", printer_uuid: "uuid-5850", printer_make_model: "EPSON ET-5850"
  });
  assert.equal(resolved.id, "epson-et-5850-liberit");
});

test("duplex and number-up calculations distinguish pages, impressions, and sheets", () => {
  assert.deepEqual(calculatePrintMetrics({ documentPages: 4, copies: 10, numberUp: 2, sides: "two-sided-short-edge" }), {
    document_pages: 4, copies: 10, number_up: 2, sides: "two-sided-short-edge",
    impressions_per_copy: 2, sheets_per_copy: 1,
    printed_impressions_requested: 20, physical_sheets_requested: 10
  });
});

test("partial jobs use completed counts and manual reconciliation includes jammed sheets", async () => {
  const snapshot = createCostSnapshot(profile2980, { media: "Letter", colorMode: "monochrome" });
  const partial = calculatePrintCost(snapshot, { impressions: 8, sheets: 4, basis: "cups_completed" });
  assert.equal(partial.cost_basis, "cups_completed");
  const appended = [];
  const reconciled = await appendPrintReconciliation({
    cupsJobId: "HOME-9", confirmedPhysicalCopies: 3, spoiledOrJammedSheets: 2,
    timestamp: "2026-07-21T12:00:00Z", user: "tester"
  }, {
    readRecords: async () => [{
      eventId: "original", status: "processing", timestamp: "2026-07-21T11:00:00Z", cupsJobId: "HOME-9",
      copies: 10, printed_impressions_requested: 20, physical_sheets_requested: 10,
      printer_profile: profile2980.id, printer_profile_version: profile2980.version, cost_snapshot: snapshot
    }],
    appendEvent: async (event) => appended.push(event)
  });
  assert.equal(reconciled.physical_sheets_completed, 3);
  assert.equal(reconciled.spoiled_or_jammed_sheets, 2);
  assert.equal(reconciled.cost_basis, "manually_reconciled");
  assert.equal(appended.length, 1);
});

test("historical records without physical profiles retain their legacy queue", () => {
  const [legacy] = summarizePrintRecords([{
    eventId: "legacy", status: "completed", timestamp: "2025-01-01T00:00:00Z",
    printer: "OLD_QUEUE", cupsJobId: "OLD_QUEUE-1", copies: 1
  }]);
  assert.equal(legacy.printer, "OLD_QUEUE");
  assert.equal(legacy.printer_profile, undefined);
});

test("price changes select an effective profile version and do not mutate old snapshots", () => {
  const newer = structuredClone(profile2980);
  newer.version = "v2";
  newer.effective_date = "2026-07-01T00:00:00Z";
  newer.ink_bottles[0].price = 40;
  const oldProfile = resolvePrinterProfile([profile2980, newer], { printer_uuid: "uuid-2980" }, "2026-06-01T00:00:00Z");
  const oldSnapshot = createCostSnapshot(oldProfile, { media: "Letter", colorMode: "monochrome" });
  const newProfile = resolvePrinterProfile([profile2980, newer], { printer_uuid: "uuid-2980" }, "2026-08-01T00:00:00Z");
  assert.equal(oldProfile.version, "v1");
  assert.equal(newProfile.version, "v2");
  assert.equal(oldSnapshot.ink_bottles[0].price, 20);
});

test("physical identity fields and cost snapshots round-trip through append-only Pyash", () => {
  const sentence = buildPrintSentence({
    eventId: "physical", cups_queue: "HOME", printer_uuid: "uuid-2980", printer_serial: "serial-1",
    device_uri: sanitizeDeviceUri("ipp://user:secret@printer.local/ipp/print?token=secret"),
    printer_profile: "epson-et-2980-home", printer_profile_version: "v1",
    document_pages: 4, printed_impressions_requested: 2, physical_sheets_requested: 1,
    cost_snapshot: { paper_cost_per_sheet: 0.03 }
  });
  const record = printSentenceToRecord(parse(sentenceToPyash(sentence)));
  assert.equal(record.device_uri, "ipp://printer.local/ipp/print");
  assert.equal(record.document_pages, 4);
  assert.equal(record.cost_snapshot.paper_cost_per_sheet, 0.03);
});
