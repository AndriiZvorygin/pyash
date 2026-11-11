#!/usr/bin/env node
// The rules the example audit uses to decide what a failure means.
//
// They live in their own module so a quiz can pin them without running the
// audit, which takes one process per example and several minutes.

// Examples that need a live MCP server or model backend cannot be audited
// offline; they are reported as skipped rather than counted as failures.
export const backendPattern = /\b(uvx|mcp-server-time|mind_ollama|mind_openai|mind_minimax|mind_zai|mind_strata)\b/;
// Examples that perform live network I/O are likewise skipped offline.
export const networkPattern = /\b(download|web search|web-search|confederation-priest-run)\b/;

// Classify a failure so parameterized templates and environment-dependent
// examples are not reported as runtime defects.
export function classify(output) {
  // A container-only path comes first: the sandbox root is /workplace inside
  // the image, so an example that names it cannot run on the host at all.
  // Checked after the other rules it would be shadowed by the examples/out
  // rule for exactly the container case it exists to catch.
  if (/\/workplace\//.test(output)) return "needs backend";

  if (/input binding defective: missing required input/i.test(output)) return "needs input";
  if (/no such file or directory.*(module|know|artifacts|input)/i.test(output)) return "needs input";
  if (/Error opening output .*examples\/out/i.test(output)) return "needs input";
  if (/file or directory unavailable: .*examples\/out/i.test(output)) return "needs input";
  // An example input artifact that a fresh checkout does not have. The
  // examples/out folder holds generated files and is not in the repository.
  if (/examples\/out\/[^\s"']*.*no such file or directory/i.test(output)) return "needs input";

  // A live model, media backend, audio device, or built helper binary.
  if (/localhost:11434|localhost:8000|localhost:8188|ollama request failed|whisperx|fetch failed|ECONNREFUSED/i.test(output)) return "needs backend";
  if (/gpu-managed comfyui job failed/i.test(output)) return "needs backend";
  if (/aplay:.*audio open error/i.test(output)) return "needs backend";
  // A binary that cannot be spawned is missing from the machine, not broken
  // in the example. Only a bare program name counts: a spawn of a path inside
  // the repository is the example failing to produce something of its own,
  // which is a defect.
  if (/spawn [\w.-]+ ENOENT/i.test(output)) return "needs backend";
  if (/spawn caterer\/.*ENOENT/i.test(output)) return "needs backend";
  // A tool the example shells out to is not installed on the machine. The
  // shell reports it by name, and it exits 127, which is the shell's own
  // "command not found" status.
  if (/(^|[\s"'])(?!error\b)[a-z0-9][a-z0-9._-]*: (not found|command not found)\b/i.test(output)) return "needs backend";
  if (/status=127\b/.test(output)) return "needs backend";
  // A device the example talks to is not attached to the machine.
  if (/missing device id/i.test(output)) return "needs backend";
  // The sibling dictionary checkout that sits next to this repository holds
  // the glyph word lists the translation subsystem reads.
  if (/no such file or directory.*(pyachso2n|English30k|16GlyphWordList)/i.test(output)) return "needs backend";
  // An interactive session example waits for a live session that never arrives.
  if (/Detected unsettled top-level await/i.test(output)) return "needs backend";
  // A session example that cannot run because nothing was piped into it.
  if (/session defective: no interactive input available/i.test(output)) return "needs backend";

  return "failed";
}

// Bucket a set of audit results.
//
// A timeout is not a pass. It used to be folded into the passed count,
// because the total was computed by subtraction, so an example that was
// killed at the timeout was reported as if it had run.
export function summarize(results = []) {
  const needsBackend = results.filter((r) => r.status === "failed" && r.kind === "needs backend");
  const failed = results.filter((r) => r.status === "failed" && r.kind !== "needs backend");
  const needsInput = results.filter((r) => r.status === "needs input");
  const timedOut = results.filter((r) => r.status === "timeout");
  const skipped = results.filter((r) => r.status === "skipped");
  const passed = results.filter((r) => r.status === "ok").length;
  return { passed, failed, needsBackend, needsInput, timedOut, skipped };
}

// Split the recorded failures into the ones that no longer fail and the ones
// that now actually pass.
//
// A recorded failure is only fixed when the example passes. An example that
// stopped failing because it became a gap is reported as a gap, not as a
// pass: the two are different states, and the difference matters when the
// environment changes underneath the audit.
export function splitRecordedFailures({ baseline = [], failed = [], results = [] } = {}) {
  const failedFiles = new Set(failed.map((entry) => entry.file));
  const recorded = [...baseline].filter((name) => !failedFiles.has(name));
  const fixed = recorded.filter((name) => results.some((r) => r.file === name && r.status === "ok"));
  const noLongerFailing = recorded.filter((name) => !fixed.includes(name));
  return { fixed, noLongerFailing };
}
