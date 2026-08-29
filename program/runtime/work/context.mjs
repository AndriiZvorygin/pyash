import crypto from "node:crypto";

import { deriveImplementationProgress } from "./progress.mjs";

export const WORK_CONTEXT_VERSION = 1;
export const WORK_CONTEXT_MAX_PROMPT_BYTES = 16000;

const LIMITS = Object.freeze({
  title: 600,
  objective: 1800,
  acceptance: 1800,
  context: 1800,
  workOrder: 2400,
  risks: 1600,
  summary: 1800,
  commit: 160,
  files: 1200,
  tests: 1800,
  blockers: 1200,
  correction: 1800,
  explanation: 1600,
  diffStat: 180,
  hash: 128,
  id: 180,
  counters: 700
});

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(list(values))];
}

function bounded(value, limit) {
  const body = text(value);
  if (body.length <= limit) return body;
  const suffix = "\n... [truncated]";
  return `${body.slice(0, Math.max(0, limit - suffix.length)).trimEnd()}${suffix}`;
}

function boundedList(value, limit) {
  const values = unique(value);
  if (!values.length) return "(none)";
  return bounded(values.join(", "), limit);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function diffStat(diff, changedFiles = []) {
  const source = String(diff ?? "");
  let additions = 0;
  let deletions = 0;
  for (const line of source.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  const files = new Set(list(changedFiles));
  for (const line of source.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/u);
    if (match) files.add(match[2]);
  }
  if (!files.size && !additions && !deletions) return "no recorded changes";
  return `${files.size} file${files.size === 1 ? "" : "s"} changed, +${additions} -${deletions}`;
}

function sections(output) {
  const result = {};
  let current = "_text";
  result[current] = [];
  for (const line of String(output ?? "").split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z _-]{1,40}):\s*(.*)$/u);
    if (match) {
      current = match[1].trim().toUpperCase();
      result[current] = [match[2]];
    } else {
      result[current] ||= [];
      result[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, values]) => [
    key,
    values.join("\n").trim()
  ]));
}

function section(output, names) {
  const values = sections(output);
  for (const name of names) {
    const value = text(values[String(name).toUpperCase()]);
    if (value) return value;
  }
  return "";
}

function completedTurn(turn, phase = "") {
  return turn
    && turn.state === "completed"
    && (!phase || turn.phase === phase)
    && (turn.resultCaptured === true || turn.result?.text || turn.turnId);
}

function latestTurn(checkpoint, phase) {
  return [...(Array.isArray(checkpoint?.turnHistory) ? checkpoint.turnHistory : [])]
    .reverse()
    .find((turn) => completedTurn(turn, phase)) || null;
}

function progressForTurn(checkpoint, turn) {
  const history = Array.isArray(checkpoint?.implementation?.passHistory)
    ? checkpoint.implementation.passHistory
    : [];
  return [...history].reverse().find((entry) => (
    entry?.state === "completed"
      && (!turn?.turnId || entry.turnId === turn.turnId)
  )) || history.at(-1) || {};
}

function implementationEvidence(task) {
  const checkpoint = task?.checkpoint || {};
  const implementation = checkpoint.implementation || {};
  const turn = latestTurn(checkpoint, "implementation");
  const output = text(turn?.result?.text);
  const progress = progressForTurn(checkpoint, turn);
  const diff = text(turn?.result?.diff || implementation.diff);
  const changedFiles = list(
    section(output, ["CHANGED FILES", "FILES"])
      .split(/\n|,/u)
      .map((entry) => entry.replace(/^\s*[-*]\s*/u, "").trim())
      .filter(Boolean)
  );
  const tests = list(
    section(output, ["TESTS", "TEST EVIDENCE"])
      .split(/\n|,/u)
      .map((entry) => entry.replace(/^\s*[-*]\s*/u, "").trim())
      .filter(Boolean)
  );
  const fallbackSummary = section(output, ["SUMMARY", "IMPLEMENTATION SUMMARY"]) || output.slice(0, 1000);
  const fallbackBlockers = section(output, ["BLOCKERS", "BLOCKER"]);
  const commit = section(output, ["COMMIT"]) || progress.commits?.at(-1) || implementation.commit;
  const files = changedFiles.length ? changedFiles : implementation.changedFiles;
  const reportedTests = tests.length ? tests : implementation.tests;
  const reportedBlockers = fallbackBlockers || implementation.blockers;
  const diffHash = progress.diffHash || (diff ? sha256(diff) : "");
  const sourceTurnIds = turn?.turnId ? [turn.turnId] : [];
  const sourceRequestIds = turn?.requestIdentity ? [turn.requestIdentity] : [];
  return {
    summary: fallbackSummary || implementation.summary,
    commit,
    changedFiles: files,
    tests: reportedTests,
    blockers: reportedBlockers,
    diffHash,
    diffStat: diffStat(diff, files),
    sourceTurnIds,
    sourceRequestIds,
    reviewReady: turn ? /(?:REVIEW READY|READY FOR REVIEW):\s*(?:yes|true|truth|1)\b/iu.test(output) : implementation.reviewReady === true
  };
}

function reviewEvidence(task) {
  const checkpoint = task?.checkpoint || {};
  const review = checkpoint.review || {};
  const turn = latestTurn(checkpoint, "review");
  const output = text(turn?.result?.text);
  const match = output.match(/\b(ACCEPT|REVISE|BLOCK)\b/iu);
  return {
    decision: text(match?.[1] || review.decision).toUpperCase(),
    explanation: section(output, ["RATIONALE", "EXPLANATION", "SUMMARY"]) || review.explanation,
    correction: section(output, ["CORRECTION", "CORRECTIONS", "REVISION", "REVISION INSTRUCTIONS"]) || review.revisionInstructions,
    sourceTurnIds: turn?.turnId ? [turn.turnId] : [],
    sourceRequestIds: turn?.requestIdentity ? [turn.requestIdentity] : []
  };
}

function convergenceEvidence(task) {
  const checkpoint = task?.checkpoint || {};
  const convergence = checkpoint.convergence || {};
  const turn = latestTurn(checkpoint, "convergence-review");
  const output = text(turn?.result?.text);
  const match = output.match(/DECISION:\s*(CONTINUE|SPLIT|BLOCK)\b/iu);
  return {
    decision: text(match?.[1] || convergence.decision).toUpperCase(),
    explanation: section(output, ["RATIONALE", "EXPLANATION", "SUMMARY"]) || convergence.rationale,
    correction: section(output, ["CORRECTION", "CORRECTIONS", "CONTINUE", "FOLLOW-UP", "FOLLOW UP"]) || convergence.correction,
    sourceTurnIds: turn?.turnId ? [turn.turnId] : [],
    sourceRequestIds: turn?.requestIdentity ? [turn.requestIdentity] : []
  };
}

function dutyLines(task, checkpoint) {
  return [
    "Original duty:",
    `Task title: ${bounded(task?.title, LIMITS.title) || "(untitled)"}`,
    `Objective: ${bounded(task?.promptText, LIMITS.objective) || "(none)"}`,
    `Acceptance criteria: ${bounded(task?.acceptanceText, LIMITS.acceptance) || "(none)"}`,
    `Context: ${bounded(task?.contextText, LIMITS.context) || "(none)"}`,
    `Sol work order: ${bounded(checkpoint?.plan?.workOrder, LIMITS.workOrder) || "(none)"}`,
    `Sol risks: ${bounded(checkpoint?.plan?.risks, LIMITS.risks) || "(none)"}`,
    `Repository: ${bounded(checkpoint?.workspace?.repository, 500) || "(none)"}`,
    `Worktree: ${bounded(checkpoint?.workspace?.worktreePath, 900) || "(none)"}`
  ];
}

function evidenceLines(label, evidence) {
  return [
    `${label}:`,
    `  Summary: ${bounded(evidence.summary, LIMITS.summary) || "(none)"}`,
    `  Commit: ${bounded(evidence.commit, LIMITS.commit) || "(none)"}`,
    `  Changed files: ${boundedList(evidence.changedFiles, LIMITS.files)}`,
    `  Tests: ${boundedList(evidence.tests, LIMITS.tests)}`,
    `  Blockers: ${bounded(evidence.blockers, LIMITS.blockers) || "(none)"}`,
    `  Diff hash: ${bounded(evidence.diffHash, LIMITS.hash) || "(none)"}`,
    `  Diff stat: ${bounded(evidence.diffStat, LIMITS.diffStat)}`,
    `  Source turn IDs: ${boundedList(evidence.sourceTurnIds, LIMITS.id)}`,
    `  Source request IDs: ${boundedList(evidence.sourceRequestIds, LIMITS.id)}`
  ];
}

function reviewLines(label, review) {
  return [
    `${label}:`,
    `  Decision: ${bounded(review.decision, 40) || "(none)"}`,
    `  Explanation: ${bounded(review.explanation, LIMITS.explanation) || "(none)"}`,
    `  Correction: ${bounded(review.correction, LIMITS.correction) || "(none)"}`,
    `  Source turn IDs: ${boundedList(review.sourceTurnIds, LIMITS.id)}`,
    `  Source request IDs: ${boundedList(review.sourceRequestIds, LIMITS.id)}`
  ];
}

function compactCounters(checkpoint) {
  const implementation = checkpoint?.implementation || {};
  const progress = deriveImplementationProgress(checkpoint);
  return [
    "Convergence counters:",
    `  Implementation passes: ${Number(implementation.passes || progress.implementationPasses || 0)}`,
    `  Material-progress passes: ${Number(implementation.materialProgressPasses || progress.materialProgressPasses || 0)}`,
    `  No-delta passes: ${Number(implementation.noProgressPasses || progress.noProgressPasses || 0)}`,
    `  Consecutive no-progress passes: ${Number(implementation.consecutiveNoProgressPasses || progress.consecutiveNoProgressPasses || 0)}`,
    `  Commits produced: ${Number(implementation.commitsProduced || progress.commitsProduced || 0)}`,
    `  Acceptance checks closed: ${Number(implementation.acceptanceChecksClosed || progress.acceptanceChecksClosed || 0)}`,
    `  Sol review count: ${Number(checkpoint?.convergence?.reviewCount || 0)}`
  ].map((line) => bounded(line, LIMITS.counters));
}

function promptForPhase(task, { phase, correction = "" } = {}) {
  const checkpoint = task?.checkpoint || {};
  const luna = implementationEvidence(task);
  const review = reviewEvidence(task);
  const convergence = convergenceEvidence(task);
  const lines = [
    phase === "review"
      ? "You are Sol reviewing Luna's latest completed implementation in the Pyash worktree."
      : phase === "convergence-review"
        ? "You are Sol performing a focused convergence review for a technical Pyash task."
        : phase === "accepted"
          ? "You are preserving the accepted Pyash work context for replay."
          : phase === "revision"
            ? "You are Luna applying Sol's immediately preceding technical correction in the Pyash worktree."
            : phase === "planning"
              ? "You are Sol, the Pyash manager and architect, preparing a bounded implementation work order."
              : "You are Luna, the Pyash implementation worker, continuing the bounded work order.",
    ...dutyLines(task, checkpoint)
  ];
  if (phase === "planning") {
    lines.push(
      "Produce a bounded implementation work order. Do not edit files.",
      "Use exact headings: SUMMARY:, WORK ORDER:, RISKS:."
    );
  } else if (phase === "implementation" || phase === "revision") {
    lines.push(
      "Implement the bounded work order and run relevant tests.",
      "Use exact headings: SUMMARY:, CHANGED FILES:, TESTS:, BLOCKERS:, UNCERTAINTY:.",
      "Include REVIEW READY: yes only when the acceptance criteria are sufficiently implemented for Sol to review."
    );
  } else if (phase === "review") {
    lines.push(
      "Return exactly one decision: DECISION: ACCEPT, DECISION: REVISE, or DECISION: BLOCK.",
      "Also provide RATIONALE: and, when revising, CORRECTION:."
    );
  } else if (phase === "convergence-review") {
    lines.push(
      "Choose exactly one: DECISION: CONTINUE, DECISION: SPLIT, or DECISION: BLOCK.",
      "Use exact headings: DECISION:, RATIONALE:, and CORRECTION: (or FOLLOW-UP: when splitting).",
      "A clean worktree, repeated tests, a revision count, or a client timeout alone is not a human decision."
    );
  }
  if (phase === "review") {
    lines.push(...evidenceLines("Latest completed Luna implementation evidence", luna));
  } else if (phase === "revision") {
    lines.push(...evidenceLines("Immediately preceding Luna result", luna));
    lines.push(...reviewLines("Sol's corresponding decision and correction", review));
    if (correction && correction !== review.correction) lines.push(`Requested correction: ${bounded(correction, LIMITS.correction)}`);
  } else if (phase === "accepted") {
    lines.push(...evidenceLines("Accepted Luna implementation evidence", luna));
    lines.push(...reviewLines("Accepted Sol review evidence", review));
  } else if (phase === "convergence-review") {
    lines.push(...compactCounters(checkpoint));
    lines.push(...evidenceLines("Latest relevant Luna implementation evidence", luna));
    lines.push(...reviewLines("Latest relevant Sol review evidence", review));
    if (convergence.sourceTurnIds.length || convergence.decision) {
      lines.push(...reviewLines("Latest convergence decision", convergence));
    }
  } else if (phase === "implementation" && correction) {
    lines.push(...evidenceLines("Immediately preceding Luna result", luna));
    lines.push(...reviewLines("Sol's corresponding decision and correction", review));
  }
  return lines.filter(Boolean).join("\n");
}

function byteBounded(value, maxBytes = WORK_CONTEXT_MAX_PROMPT_BYTES) {
  const body = String(value ?? "");
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;
  const suffix = "\n... [truncated]";
  let output = body;
  while (Buffer.byteLength(`${output}${suffix}`, "utf8") > maxBytes && output.length) {
    output = output.slice(0, Math.max(0, output.length - 64));
  }
  return `${output.trimEnd()}${suffix}`;
}

export function projectWorkContext(task, {
  phase = "implementation",
  role = phase === "review" || phase === "convergence-review" || phase === "accepted" ? "manager" : "worker",
  correction = "",
  requestIdentity = "",
  activeThreadId = "",
  priorThreadIds = []
} = {}) {
  const prompt = byteBounded(promptForPhase(task, { phase, correction }));
  const contextHash = sha256(prompt);
  return {
    version: WORK_CONTEXT_VERSION,
    phase: text(phase),
    role: text(role),
    contextHash,
    hash: contextHash,
    prompt,
    sourceRequestIds: unique([
      ...implementationEvidence(task).sourceRequestIds,
      ...(phase === "revision" || phase === "accepted" || phase === "convergence-review" ? reviewEvidence(task).sourceRequestIds : []),
      ...(phase === "convergence-review" ? convergenceEvidence(task).sourceRequestIds : [])
    ]),
    sourceTurnIds: unique([
      ...implementationEvidence(task).sourceTurnIds,
      ...(phase === "revision" || phase === "accepted" || phase === "convergence-review" ? reviewEvidence(task).sourceTurnIds : []),
      ...(phase === "convergence-review" ? convergenceEvidence(task).sourceTurnIds : [])
    ]),
    requestIdentity: text(requestIdentity),
    activeThreadId: text(activeThreadId),
    priorThreadIds: unique(priorThreadIds)
  };
}

export const buildWorkContext = projectWorkContext;

export function buildCompactContextCheckpoint(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const version = Number(source.version);
  const sourceRequestIds = unique(source.sourceRequestIds || source.sourceRequestIDs);
  const sourceTurnIds = unique(source.sourceTurnIds || source.sourceTurnIDs);
  const priorThreadIds = unique(source.priorThreadIds || source.previousThreadIds);
  return {
    version: Number.isFinite(version) ? Math.max(0, Math.trunc(version)) : 0,
    phase: text(source.phase),
    role: text(source.role),
    contextHash: text(source.contextHash || source.hash),
    prompt: text(source.prompt || source.exactPrompt),
    sourceRequestIds,
    sourceTurnIds,
    requestIdentity: text(source.requestIdentity),
    activeThreadId: text(source.activeThreadId || source.threadId),
    priorThreadIds
  };
}
