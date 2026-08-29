import crypto from "node:crypto";

import { deriveImplementationProgress } from "./progress.mjs";

export const WORK_CONTEXT_VERSION = 1;
export const WORK_CONTEXT_MAX_PROMPT_BYTES = 16000;

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(list(values))];
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function utf8Prefix(value, limit) {
  let output = "";
  let bytes = 0;
  for (const character of String(value ?? "")) {
    const size = byteLength(character);
    if (bytes + size > limit) break;
    output += character;
    bytes += size;
  }
  return output;
}

function utf8Suffix(value, limit) {
  let output = "";
  let bytes = 0;
  for (const character of [...String(value ?? "")].reverse()) {
    const size = byteLength(character);
    if (bytes + size > limit) break;
    output = `${character}${output}`;
    bytes += size;
  }
  return output;
}

function bounded(value, limit) {
  const body = text(value);
  if (byteLength(body) <= limit) return body;
  const marker = "\n... [truncated]";
  if (byteLength(marker) >= limit) return utf8Prefix(body, limit);
  const available = limit - byteLength(marker);
  const prefixBytes = Math.ceil(available / 2);
  const suffixBytes = Math.floor(available / 2);
  return `${utf8Prefix(body, prefixBytes)}${marker}${utf8Suffix(body, suffixBytes)}`;
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

function promptField(label, value, {
  priority = 50,
  preferredBytes = 800,
  minimumBytes = 64
} = {}) {
  return {
    kind: "field",
    label,
    value: text(value) || "(none)",
    priority,
    preferredBytes,
    minimumBytes
  };
}

function listValue(value) {
  const values = unique(value);
  return values.length ? values.join(", ") : "(none)";
}

function dutyFields(task, checkpoint) {
  return [
    promptField("Task title", task?.title, { priority: 90, preferredBytes: 700, minimumBytes: 64 }),
    promptField("Objective", task?.promptText, { priority: 80, preferredBytes: 1200, minimumBytes: 96 }),
    promptField("Acceptance criteria", task?.acceptanceText, { priority: 80, preferredBytes: 1200, minimumBytes: 96 }),
    promptField("Context", task?.contextText, { priority: 70, preferredBytes: 1000, minimumBytes: 96 }),
    promptField("Sol work order", checkpoint?.plan?.workOrder, { priority: 90, preferredBytes: 1400, minimumBytes: 96 }),
    promptField("Sol risks", checkpoint?.plan?.risks, { priority: 60, preferredBytes: 900, minimumBytes: 64 }),
    promptField("Repository", checkpoint?.workspace?.repository, { priority: 30, preferredBytes: 500, minimumBytes: 32 }),
    promptField("Worktree", checkpoint?.workspace?.worktreePath, { priority: 30, preferredBytes: 700, minimumBytes: 32 })
  ];
}

function evidenceFields(label, evidence) {
  return [
    `${label}:`,
    promptField("  Summary", evidence.summary, { priority: 30, preferredBytes: 1400, minimumBytes: 96 }),
    promptField("  Commit", evidence.commit, { priority: 100, preferredBytes: 256, minimumBytes: 32 }),
    promptField("  Changed files", listValue(evidence.changedFiles), { priority: 80, preferredBytes: 900, minimumBytes: 64 }),
    promptField("  Tests", listValue(evidence.tests), { priority: 60, preferredBytes: 1000, minimumBytes: 64 }),
    promptField("  Blockers", evidence.blockers, { priority: 20, preferredBytes: 700, minimumBytes: 64 }),
    promptField("  Diff hash", evidence.diffHash, { priority: 100, preferredBytes: 128, minimumBytes: 64 }),
    promptField("  Diff stat", evidence.diffStat, { priority: 80, preferredBytes: 200, minimumBytes: 64 }),
    promptField("  Source turn IDs", listValue(evidence.sourceTurnIds), { priority: 100, preferredBytes: 800, minimumBytes: 64 }),
    promptField("  Source request IDs", listValue(evidence.sourceRequestIds), { priority: 100, preferredBytes: 800, minimumBytes: 64 })
  ];
}

function reviewFields(label, review) {
  return [
    `${label}:`,
    promptField("  Decision", review.decision, { priority: 100, preferredBytes: 64, minimumBytes: 16 }),
    promptField("  Explanation", review.explanation, { priority: 30, preferredBytes: 1000, minimumBytes: 96 }),
    promptField("  Correction", review.correction, { priority: 100, preferredBytes: 1400, minimumBytes: 96 }),
    promptField("  Source turn IDs", listValue(review.sourceTurnIds), { priority: 100, preferredBytes: 800, minimumBytes: 64 }),
    promptField("  Source request IDs", listValue(review.sourceRequestIds), { priority: 100, preferredBytes: 800, minimumBytes: 64 })
  ];
}

function compactCounterFields(checkpoint) {
  const implementation = checkpoint?.implementation || {};
  const progress = deriveImplementationProgress(checkpoint);
  return [
    "Convergence counters:",
    promptField("  Implementation passes", Number(implementation.passes || progress.implementationPasses || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  Material-progress passes", Number(implementation.materialProgressPasses || progress.materialProgressPasses || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  No-delta passes", Number(implementation.noProgressPasses || progress.noProgressPasses || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  Consecutive no-progress passes", Number(implementation.consecutiveNoProgressPasses || progress.consecutiveNoProgressPasses || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  Commits produced", Number(implementation.commitsProduced || progress.commitsProduced || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  Acceptance checks closed", Number(implementation.acceptanceChecksClosed || progress.acceptanceChecksClosed || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 }),
    promptField("  Sol review count", Number(checkpoint?.convergence?.reviewCount || 0), { priority: 70, preferredBytes: 100, minimumBytes: 16 })
  ];
}

function promptForPhase(task, { phase, correction = "" } = {}) {
  const checkpoint = task?.checkpoint || {};
  const luna = implementationEvidence(task);
  const review = reviewEvidence(task);
  const convergence = convergenceEvidence(task);
  const segments = [
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
    "Original duty:",
    ...dutyFields(task, checkpoint)
  ];
  if (phase === "planning") {
    segments.push(
      "Produce a bounded implementation work order. Do not edit files.",
      "Use exact headings: SUMMARY:, WORK ORDER:, RISKS:."
    );
  } else if (phase === "implementation" || phase === "revision") {
    segments.push(
      "Implement the bounded work order and run relevant tests.",
      "Use exact headings: SUMMARY:, CHANGED FILES:, TESTS:, BLOCKERS:, UNCERTAINTY:.",
      "Include REVIEW READY: yes only when the acceptance criteria are sufficiently implemented for Sol to review."
    );
  } else if (phase === "review") {
    segments.push(
      "Return exactly one decision: DECISION: ACCEPT, DECISION: REVISE, or DECISION: BLOCK.",
      "Also provide RATIONALE: and, when revising, CORRECTION:."
    );
  } else if (phase === "convergence-review") {
    segments.push(
      "Choose exactly one: DECISION: CONTINUE, DECISION: SPLIT, or DECISION: BLOCK.",
      "Use exact headings: DECISION:, RATIONALE:, and CORRECTION: (or FOLLOW-UP: when splitting).",
      "A clean worktree, repeated tests, a revision count, or a client timeout alone is not a human decision."
    );
  }
  if (phase === "review") {
    segments.push(...evidenceFields("Latest completed Luna implementation evidence", luna));
  } else if (phase === "revision") {
    segments.push(...evidenceFields("Immediately preceding Luna result", luna));
    segments.push(...reviewFields("Sol's corresponding decision and correction", review));
    if (correction && correction !== review.correction) {
      segments.push(promptField("Requested correction", correction, { priority: 90, preferredBytes: 1400, minimumBytes: 96 }));
    }
  } else if (phase === "accepted") {
    segments.push(...evidenceFields("Accepted Luna implementation evidence", luna));
    segments.push(...reviewFields("Accepted Sol review evidence", review));
  } else if (phase === "convergence-review") {
    segments.push(...compactCounterFields(checkpoint));
    segments.push(...evidenceFields("Latest relevant Luna implementation evidence", luna));
    segments.push(...reviewFields("Latest relevant Sol review evidence", review));
    if (convergence.sourceTurnIds.length || convergence.decision) {
      segments.push(...reviewFields("Latest convergence decision", convergence));
    }
  } else if (phase === "implementation" && correction) {
    segments.push(...evidenceFields("Immediately preceding Luna result", luna));
    segments.push(...reviewFields("Sol's corresponding decision and correction", review));
  }
  return segments;
}

function allocateFieldBudgets(segments, maxBytes = WORK_CONTEXT_MAX_PROMPT_BYTES) {
  const fields = segments.filter((segment) => segment?.kind === "field");
  const fixedBytes = segments.reduce((total, segment) => {
    if (segment?.kind === "field") return total + byteLength(`${segment.label}: `);
    return total + byteLength(segment);
  }, Math.max(0, segments.length - 1));
  const availableBytes = Math.max(0, maxBytes - fixedBytes);
  const targets = fields.map((field) => Math.min(byteLength(field.value), Math.max(0, field.preferredBytes)));
  const minimums = fields.map((field, index) => Math.min(targets[index], Math.max(0, field.minimumBytes)));
  const budgets = minimums.map((value) => value);
  let remaining = Math.max(0, availableBytes - budgets.reduce((total, value) => total + value, 0));
  const order = fields.map((field, index) => ({ field, index }))
    .sort((left, right) => right.field.priority - left.field.priority || left.index - right.index);
  for (const { index } of order) {
    if (!remaining) break;
    const extra = Math.min(targets[index] - budgets[index], remaining);
    budgets[index] += extra;
    remaining -= extra;
  }
  return budgets;
}

function assemblePrompt(segments, maxBytes = WORK_CONTEXT_MAX_PROMPT_BYTES) {
  const fields = segments.filter((segment) => segment?.kind === "field");
  const budgets = allocateFieldBudgets(segments, maxBytes);
  let fieldIndex = 0;
  const prompt = segments.map((segment) => {
    if (segment?.kind !== "field") return segment;
    const budget = budgets[fieldIndex++];
    return `${segment.label}: ${bounded(segment.value, budget)}`;
  }).join("\n");
  if (byteLength(prompt) > maxBytes) throw new RangeError("work context prompt exceeded its byte budget");
  return prompt;
}

export function projectWorkContext(task, {
  phase = "implementation",
  role = phase === "review" || phase === "convergence-review" || phase === "accepted" ? "manager" : "worker",
  correction = "",
  requestIdentity = "",
  activeThreadId = "",
  priorThreadIds = []
} = {}) {
  const prompt = assemblePrompt(promptForPhase(task, { phase, correction }));
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
