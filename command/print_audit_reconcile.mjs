#!/usr/bin/env node

import { appendPrintReconciliation } from "../program/library/print_audit/reconcile.mjs";

const args = process.argv.slice(2);
const cupsJobId = args.shift() || "";
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (key === "--copies") options.confirmedPhysicalCopies = Number(args[++index]);
  else if (key === "--spoiled") options.spoiledOrJammedSheets = Number(args[++index]);
  else if (key === "--cost") options.reconciledCost = Number(args[++index]);
  else if (key === "--note") options.note = args[++index] || "";
  else throw new Error(`Unknown option: ${key}`);
}
if (!cupsJobId || options.confirmedPhysicalCopies === undefined) {
  process.stderr.write("Usage: print-audit-reconcile JOB-ID --copies N [--spoiled N] [--cost CAD] [--note TEXT]\n");
  process.exit(2);
}
const event = await appendPrintReconciliation({ cupsJobId, ...options });
process.stdout.write(`Appended reconciliation for ${event.cupsJobId}: ${event.confirmed_physical_copies} copies, ${event.spoiled_or_jammed_sheets} spoiled sheets, $${Number(event.estimated_total_cost || 0).toFixed(2)}.\n`);
