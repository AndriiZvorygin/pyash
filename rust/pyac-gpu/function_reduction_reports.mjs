import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function interpretationForVariant(variant) {
  if (variant === "baseline") return "Control run: the selected function body is unchanged; compare this artifact with diagnostic variants built from the same source snapshot.";
  if (variant === "minimal") return "Diagnostic-only success-shaped replacement; it preserves a successful return but may remove other reachable behavior, so it is not a behavior test.";
  return "Diagnostic-only early-error replacement; downstream code may become unreachable and be removed, so a fast result only implicates this function's reachable path.";
}

export function replacementDescription(variant) {
  if (variant === "baseline") return "none; source body unchanged";
  if (variant === "minimal") return "success-shaped diagnostic replacement (not behaviorally equivalent)";
  return "early-error diagnostic replacement (not behaviorally equivalent)";
}

export function sourceFingerprint(roots, repoRoot) {
  const hash = createHash("sha256");
  for (const root of roots) {
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === "target" || entry.name === ".git") continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) {
          hash.update(path.relative(repoRoot, absolute));
          hash.update(fs.readFileSync(absolute));
        }
      }
    };
    visit(root);
  }
  return hash.digest("hex");
}

function readPipelineEvidence(logPath) {
  if (!fs.existsSync(logPath)) return {};
  const log = fs.readFileSync(logPath, "utf8");
  const duration = (stage) => log.match(new RegExp(`${stage} pipeline ready in ([\\d.]+)s`, "u"))?.[1];
  return {
    pack: duration("pack"),
    programlet: duration("programlet"),
    sections: duration("sections"),
    total: log.match(/full initialization ([\d.]+s)/u)?.[1],
    stop: log.match(/^.*\[pipeline profile\] (.*)$/mu)?.[1],
  };
}

export function writeReport(runDir, candidate, variant, build, pipeline, spirvPath) {
  const size = fs.existsSync(spirvPath) ? fs.statSync(spirvPath).size : 0;
  const evidence = readPipelineEvidence(path.join(runDir, "vulkan-probe.log"));
  const lines = [
    "# Programlet Function Reduction",
    "",
    `- Candidate: \`${candidate.name}\``,
    `- Source: \`rust/pyac-vliw-core/src/semantics_runtime/${candidate.file}\``,
    `- Variant: \`${variant}\`; ${variant === "baseline" ? "function body unchanged" : "diagnostic-only body replacement, not a behavior test"}.`,
    `- Rust-GPU/SPIR-V build: ${build.stopReason ? `stopped (${build.stopReason})` : build.code === 0 ? "complete" : `failed (exit ${build.code ?? "unknown"})`}`,
    `- Build time: ${(build.elapsedMs / 1000).toFixed(1)} s; peak process-tree RSS: ${(build.peakRss / 1024 ** 3).toFixed(2)} GiB`,
    `- SPIR-V artifact: ${size ? `${spirvPath} (${size} bytes)` : "not produced"}`,
    `- Vulkan pipeline probe: ${pipeline ? (pipeline.code === 0 ? "complete" : `bounded/incomplete (exit ${pipeline.code ?? "unknown"})`) : "not run"}`,
  ];
  if (pipeline) {
    const stages = [`pack ${evidence.pack ?? "incomplete"}`, `programlet ${evidence.programlet ?? "incomplete"}`, `sections ${evidence.sections ?? "incomplete"}`].join(", ");
    lines.push(`- Vulkan entry-point timings: ${stages}; full initialization ${evidence.total ?? "incomplete"}`);
    lines.push(`- Vulkan probe process: ${(pipeline.elapsedMs / 1000).toFixed(1)} s; peak RSS: ${(pipeline.peakRss / 1024 ** 3).toFixed(2)} GiB; stop: ${pipeline.stopReason || evidence.stop || "none reported"}`);
  }
  lines.push("- Driver shader-cache state is not controlled; use first-run stage timings for cross-variant comparisons and note repeats as potentially warm.", "", `Interpretation: ${interpretationForVariant(variant)}`, "");
  fs.writeFileSync(path.join(runDir, "report.md"), lines.join("\n"));
}

export function writeIndex(diagnostics) {
  const rows = [];
  for (const entry of fs.readdirSync(diagnostics, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{8}T\d{6}Z-/u.test(entry.name)) continue;
    const reportPath = path.join(diagnostics, entry.name, "report.md");
    if (!fs.existsSync(reportPath)) continue;
    const report = fs.readFileSync(reportPath, "utf8");
    const candidate = report.match(/^- Candidate: `([^`]+)`/mu)?.[1] || entry.name;
    const variant = report.match(/^- Variant: `([^`]+)`/mu)?.[1] || "error";
    const pipeline = report.match(/^- Vulkan pipeline probe: (.+)$/mu)?.[1] || "not run";
    const evidence = readPipelineEvidence(path.join(diagnostics, entry.name, "vulkan-probe.log"));
    const stageTiming = [`pack ${evidence.pack ?? "-"}`, `programlet ${evidence.programlet ?? "-"}`, `sections ${evidence.sections ?? "-"}`, `total ${evidence.total ?? "-"}`].join(", ");
    const timing = evidence.total ? stageTiming : `${stageTiming}; ${evidence.stop || "no completion marker"}`;
    const size = report.match(/^- SPIR-V artifact: (.+)$/mu)?.[1] || "n/a";
    rows.push(`| ${candidate} (${variant}) | ${pipeline} | ${timing} | ${size} | [report](${entry.name}/report.md) |`);
  }
  rows.sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(path.join(diagnostics, "index.md"), [
    "# Function Reduction Runs",
    "",
    "Each row records a function-reduction control or diagnostic variant. Early-error stubs can remove downstream reachable code; use success-shaped variants for narrower comparisons. None is a behavior test. NVIDIA driver cache state is not controlled, so compare first-run timings and mark repeats as potentially warm.",
    "",
    "| Function | Pipeline result | Entry-point timings | SPIR-V | Evidence |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n"));
}
