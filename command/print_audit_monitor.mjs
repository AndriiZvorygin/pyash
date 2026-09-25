#!/usr/bin/env node

import os from "node:os";

import { appendPrintEvent, hasPrintEvent, readAllPrintJournals, summarizePrintRecords } from "../program/library/print_audit/journal.mjs";
import {
  createCupsSubscription,
  cupsStatusFromState,
  cupsEventDetails,
  listCupsJobs,
  monitorDbusJobs,
  queryCupsJob
} from "../program/library/print_audit/cups.mjs";
import { calculatePrintCost, createCostSnapshot } from "../program/library/print_audit/cost.mjs";
import { discoverPrinterIdentity, loadPrinterProfiles, profileSnapshot, resolvePrinterProfile } from "../program/library/print_audit/profile.mjs";

const JOURNAL_ROOT = process.env.PYA_PRINT_JOURNAL_ROOT;
const SERVER = process.env.PYA_CUPS_SERVER || "ipp://localhost";
const RENEW_MS = 12 * 60 * 60 * 1000;

async function ensureSubscription() {
  await createCupsSubscription({ server: SERVER });
}

async function recordEvent(event) {
  if (!event.jobId) return;
  let attributes = {};
  try {
    attributes = await queryCupsJob(event.jobId, { server: SERVER });
  } catch (err) {
    process.stderr.write(`Print monitor IPP query failed for ${event.jobId}: ${err?.message || err}\n`);
  }
  if (!attributes["job-originating-user-name"]) {
    try {
      const listed = (await listCupsJobs()).find((job) => job.jobId === event.jobId && (!event.printer || job.printer === event.printer));
      if (listed) event.user = listed.user;
    } catch (err) {
      process.stderr.write(`Print monitor user lookup failed for ${event.jobId}: ${err?.message || err}\n`);
    }
  }
  const details = cupsEventDetails(event, attributes);
  const cupsJobId = event.printer ? `${event.printer}-${event.jobId}` : String(event.jobId);
  const existing = summarizePrintRecords(await readAllPrintJournals(JOURNAL_ROOT)).find((job) => job.cupsJobId === cupsJobId) || {};
  const identity = await discoverPrinterIdentity(event.printer || details.printer, { server: SERVER }).catch(() => ({
    cups_queue: event.printer || details.printer,
    cups_server: "localhost"
  }));
  const profile = resolvePrinterProfile((await loadPrinterProfiles()).profiles, identity, details.timestamp);
  const snapshot = existing.cost_snapshot || createCostSnapshot(profile, {
    media: attributes.media || "Letter",
    colorMode: attributes["print-color-mode"] || "color"
  });
  const hasImpressions = Number(attributes["job-impressions-completed"] || 0) > 0;
  const hasSheets = Number(attributes["job-media-sheets-completed"] || 0) > 0;
  const finalCost = (hasImpressions || hasSheets) && ["completed", "cancelled", "aborted", "stopped"].includes(details.status)
    ? calculatePrintCost(snapshot, {
      impressions: hasImpressions ? Number(attributes["job-impressions-completed"]) : Number(existing.printed_impressions_requested || 0),
      sheets: hasSheets ? Number(attributes["job-media-sheets-completed"]) : Number(existing.physical_sheets_requested || 0),
      basis: "cups_completed"
    })
    : {};
  const eventId = `${os.hostname()}-${event.jobId}-${details.status}-${details.printed_impressions_completed || 0}-${details.physical_sheets_completed || 0}`;
  const timestamp = new Date(details.timestamp);
  if (await hasPrintEvent(eventId, { root: JOURNAL_ROOT, timestamp })) return;
  await appendPrintEvent({
    eventId,
    ...details,
    cupsJobId,
    ...identity,
    printer_profile: existing.printer_profile || profile?.id || "",
    printer_profile_version: existing.printer_profile_version || profile?.version || "",
    printer_profile_snapshot: existing.printer_profile_snapshot || profileSnapshot(profile),
    cost_snapshot: snapshot,
    document_pages: existing.document_pages,
    printed_impressions_requested: existing.printed_impressions_requested,
    physical_sheets_requested: existing.physical_sheets_requested,
    original_estimated_total_cost: existing.original_estimated_total_cost || existing.estimated_total_cost,
    campaign: existing.campaign,
    ...finalCost
  }, { root: JOURNAL_ROOT });
}

async function reconcileRecentJobs() {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  for (const job of await listCupsJobs()) {
    if (!job.timestamp || Date.parse(job.timestamp) < cutoff) continue;
    let attributes;
    try {
      attributes = await queryCupsJob(job.jobId, { server: SERVER });
    } catch (err) {
      process.stderr.write(`Print monitor reconciliation query failed for ${job.jobId}: ${err?.message || err}\n`);
      continue;
    }
    const state = Number(attributes["job-state"] || 0);
    await recordEvent({
      member: "JobState",
      timestamp: job.timestamp,
      printer: job.printer,
      printerUri: String(attributes["job-printer-uri"] || ""),
      jobId: job.jobId,
      jobState: state,
      status: cupsStatusFromState(state),
      jobReasons: String(attributes["job-state-reasons"] || ""),
      title: String(attributes["job-name"] || ""),
      impressions: Number(attributes["job-impressions-completed"] || 0),
      user: job.user
    });
  }
}

const monitor = monitorDbusJobs(recordEvent);

try {
  await ensureSubscription();
  await reconcileRecentJobs();
} catch (err) {
  process.stderr.write(`Print monitor subscription failed: ${err?.message || err}\n`);
}

const renewal = setInterval(() => {
  ensureSubscription().catch((err) => {
    process.stderr.write(`Print monitor subscription renewal failed: ${err?.message || err}\n`);
  });
}, RENEW_MS);
renewal.unref();

let stopping = false;
function stop(signal) {
  stopping = true;
  clearInterval(renewal);
  monitor.kill(signal);
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

monitor.on("close", (code, signal) => {
  if (stopping) process.exit(0);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
