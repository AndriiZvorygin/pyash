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

  // A live model, media backend, audio device, or built helper binary.
  if (/localhost:11434|localhost:8000|localhost:8188|ollama request failed|whisperx|fetch failed|ECONNREFUSED/i.test(output)) return "needs backend";
  if (/gpu-managed comfyui job failed/i.test(output)) return "needs backend";
  if (/aplay:.*audio open error/i.test(output)) return "needs backend";
  if (/spawn caterer\/.*ENOENT/i.test(output)) return "needs backend";
  // An interactive session example waits for a live session that never arrives.
  if (/Detected unsettled top-level await/i.test(output)) return "needs backend";

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
