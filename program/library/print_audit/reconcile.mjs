import crypto from "node:crypto";
import os from "node:os";

import { appendPrintEvent, readAllPrintJournals, summarizePrintRecords } from "./journal.mjs";
import { calculatePrintCost, calculatePrintMetrics, pdfPageCount, printSettingsFromArgs } from "./cost.mjs";

export async function appendPrintReconciliation({
  cupsJobId,
  confirmedPhysicalCopies,
  spoiledOrJammedSheets = 0,
  reconciledCost,
  note = "",
  timestamp = new Date().toISOString(),
  user = os.userInfo().username
}, {
  root,
  readRecords = () => readAllPrintJournals(root),
  appendEvent = (event) => appendPrintEvent(event, { root })
} = {}) {
  if (!cupsJobId) throw new Error("A CUPS job ID is required");
  const job = summarizePrintRecords(await readRecords()).find((item) => item.cupsJobId === cupsJobId);
  if (!job) throw new Error(`Print job not found: ${cupsJobId}`);
  const copies = Math.max(0, Number(confirmedPhysicalCopies) || 0);
  const spoiled = Math.max(0, Number(spoiledOrJammedSheets) || 0);
  const requestedCopies = Math.max(1, Number(job.copies) || 1);
  let requestedImpressions = Number(job.printed_impressions_requested || 0);
  let requestedSheets = Number(job.physical_sheets_requested || 0);
  let documentPages = Number(job.document_pages || 0);
  if ((!requestedImpressions || !requestedSheets) && job.sourcePaths?.[0]) {
    documentPages ||= await pdfPageCount(job.canonicalPaths?.[0] || job.sourcePaths[0]);
    const settings = printSettingsFromArgs(job.args || []);
    const inferred = calculatePrintMetrics({
      documentPages, copies: requestedCopies, numberUp: settings.numberUp, sides: settings.sides
    });
    requestedImpressions ||= inferred.printed_impressions_requested;
    requestedSheets ||= inferred.physical_sheets_requested;
  }
  const impressionsPerCopy = requestedImpressions / requestedCopies;
  const sheetsPerCopy = requestedSheets / requestedCopies;
  const goodImpressions = Math.round(impressionsPerCopy * copies);
  const goodSheets = Math.round(sheetsPerCopy * copies);
  const calculated = calculatePrintCost(job.cost_snapshot, {
    impressions: goodImpressions + spoiled,
    sheets: goodSheets + spoiled,
    basis: "manually_reconciled"
  });
  if (reconciledCost !== undefined) calculated.estimated_total_cost = Number(reconciledCost) || 0;
  const event = {
    eventId: `reconcile-${crypto.randomUUID()}`,
    status: "reconciled",
    timestamp,
    cupsJobId,
    printer: job.printer,
    title: job.title,
    user,
    copies: job.copies,
    cups_queue: job.cups_queue,
    printer_make_model: job.printer_make_model,
    printer_uuid: job.printer_uuid,
    printer_serial: job.printer_serial,
    device_uri: job.device_uri,
    cups_server: job.cups_server,
    printer_profile: job.printer_profile,
    printer_profile_version: job.printer_profile_version,
    printer_profile_snapshot: job.printer_profile_snapshot,
    cost_snapshot: job.cost_snapshot,
    campaign: job.campaign,
    document_pages: documentPages || job.document_pages,
    printed_impressions_requested: requestedImpressions || job.printed_impressions_requested,
    physical_sheets_requested: requestedSheets || job.physical_sheets_requested,
    printed_impressions_completed: goodImpressions,
    physical_sheets_completed: goodSheets,
    original_estimated_total_cost: job.original_estimated_total_cost || job.estimated_total_cost,
    confirmed_physical_copies: copies,
    spoiled_or_jammed_sheets: spoiled,
    reconciliation_date: timestamp,
    reconciliation_user: user,
    reconciliation_note: note,
    ...calculated
  };
  await appendEvent(event);
  return event;
}
