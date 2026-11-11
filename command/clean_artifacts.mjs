#!/usr/bin/env node
import path from "node:path";
import { cleanArtifactStore } from "../program/library/artifact_cleanup.mjs";

function optionsFromArgs(args) {
  let root = process.cwd();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--apply") {
      apply = true;
    } else if (args[index] === "--root" && args[index + 1]) {
      root = args[index + 1];
      index += 1;
    } else if (args[index].startsWith("--root=")) {
      root = args[index].slice("--root=".length);
    } else {
      throw new Error(`unknown argument: ${args[index]}`);
    }
  }
  return { root: path.resolve(root), apply };
}

function printPathSummary(label, paths, limit = 12) {
  const sample = paths.slice(0, limit);
  const remainder = paths.length - sample.length;
  console.log(`${label}: ${paths.length}${sample.length ? ` (${sample.join(", ")}${remainder ? `, +${remainder} more` : ""})` : ""}`);
}

try {
  const report = await cleanArtifactStore(optionsFromArgs(process.argv.slice(2)));
  console.log(`artifact cleanup ${report.applied ? "applied" : "dry-run"}`);
  console.log(`root: ${report.root}`);
  printPathSummary("artifact stores scanned", report.storeRoots);
  console.log(`newspapers scanned: ${report.newspaperFiles.length}`);
  console.log(`run directories: ${report.runDirectories.length} (${report.runDirectories.reduce((sum, entry) => sum + entry.bytes, 0)} bytes)`);
  console.log(`unreferenced content-addressed objects: ${report.contentAddressedObjects.length} (${report.contentAddressedObjects.reduce((sum, entry) => sum + entry.bytes, 0)} bytes)`);
  console.log(`referenced content-addressed objects: ${report.referencedContentAddressedObjects}`);
  printPathSummary("unknown artifact roots preserved", report.unknownArtifactRoots);
  printPathSummary("external artifact roots not modified", report.externalArtifactRoots);
  printPathSummary("missing newspaper references", report.missingReferences);
  console.log(`malformed CAS paths preserved: ${report.malformedContentAddressedPaths.length}`);
  printPathSummary("blockers", report.blockers);
  for (const blocker of report.blockers.slice(0, 12)) console.error(`blocked: ${blocker}`);
  if (report.skippedContentAddressedObjects?.length) {
    for (const item of report.skippedContentAddressedObjects) console.error(`preserved: ${item.filename} (${item.reason})`);
  }
  if (report.removedExternalHardlinkCounts?.length) {
    for (const item of report.removedExternalHardlinkCounts) {
      console.warn(`CAS entry removed but ${item.remainingLinks} external hardlink(s) remain: ${item.filename}`);
    }
  }
  if (report.blocked) process.exitCode = 2;
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 1;
}
