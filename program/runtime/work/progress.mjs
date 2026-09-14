import crypto from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? "")).digest("hex");
}

function section(output, names) {
  const sections = {};
  let current = "_text";
  sections[current] = [];
  for (const line of String(output ?? "").split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z _-]{1,40}):\s*(.*)$/u);
    if (match) {
      current = match[1].trim().toUpperCase();
      sections[current] = [match[2]];
    } else {
      sections[current] ||= [];
      sections[current].push(line);
    }
  }
  for (const name of names) {
    const value = text(sections[String(name).toUpperCase()]);
    if (value) return value;
  }
  return "";
}

function lines(value) {
  return String(value ?? "").split(/\n|,/u)
    .map((line) => line.replace(/^\s*[-*]\s*/u, "").trim())
    .filter((line) => line && !/^(none|n\/a|no files?)\.?$/iu.test(line));
}

export function extractCommitIds(value) {
  return [...String(value ?? "").matchAll(/\b[0-9a-f]{7,40}\b/giu)]
    .map((match) => match[0].toLowerCase())
    .filter((commit, index, commits) => commits.indexOf(commit) === index);
}

function reportFromTurn(turn) {
  const output = text(turn?.result?.text);
  const commits = extractCommitIds(output);
  const tests = lines(section(output, ["TESTS", "TEST EVIDENCE"]));
  const blockers = section(output, ["BLOCKERS", "BLOCKER"]);
  const changedFiles = lines(section(output, ["CHANGED FILES", "FILES"]));
  const summary = section(output, ["SUMMARY", "IMPLEMENTATION SUMMARY"]) || output.slice(0, 1000);
  return {
    summary,
    commits,
    tests,
    blockers,
    changedFiles,
    reviewReady: /(?:REVIEW READY|READY FOR REVIEW):\s*(?:yes|true|truth|1)\b/iu.test(output),
    diff: text(turn?.result?.diff),
    fileChanges: Array.isArray(turn?.result?.fileChanges) ? turn.result.fileChanges : []
  };
}

function explicitNoDelta(output) {
  return /(?:no (?:additional )?changes|no changes were needed|repeats? (?:the|this|completed)|already completed|worktree (?:remains? )?clean|preserv(?:e|ing) the clean|no new correction|unchanged)/iu.test(output);
}

function testProgress(output, tests, previousHistory) {
  if (!tests.length || explicitNoDelta(output)) return false;
  if (!previousHistory.length) return true;
  return /(?:previously failing|failed .*?(?:now|and) pass|fixed .*?(?:test|assertion)|new (?:regression )?coverage|added .*?(?:test|assertion)|acceptance .*?(?:closed|met)|targeted .*?(?:failure|gap))/iu.test(output);
}

function previousCommits(history) {
  return new Set(history.flatMap((entry) => entry.commits || []).map((commit) => text(commit).toLowerCase()));
}

function previousValue(history, key, fallback = "") {
  return history.length ? history.at(-1)?.[key] ?? fallback : fallback;
}

export function classifyImplementationPass({
  pass,
  at,
  turn,
  report = reportFromTurn(turn),
  evidence = {},
  previousHistory = [],
  baseRevision = ""
} = {}) {
  const commits = [...new Set([
    ...list(report.commits),
    ...extractCommitIds(report.commit),
    ...extractCommitIds(evidence.revision)
  ])];
  const diff = text(evidence.diff || report.diff);
  const changedFiles = [...new Set([
    ...list(report.changedFiles),
    ...list(evidence.changedFiles),
    ...report.fileChanges.map((change) => text(change?.path || change?.file || change?.filename))
  ])];
  const tests = list(report.tests);
  const blockers = text(report.blockers);
  const priorCommits = previousCommits(previousHistory);
  const newCommits = commits.filter((commit) => !priorCommits.has(commit) && commit !== text(baseRevision).toLowerCase());
  const previousDiffHash = previousValue(previousHistory, "diffHash");
  const previousFilesHash = previousValue(previousHistory, "changedFilesHash");
  const previousTestsHash = previousValue(previousHistory, "testsHash");
  const previousBlockerHash = previousValue(previousHistory, "blockerHash");
  const diffHash = diff ? fingerprint(diff) : "";
  const changedFilesHash = changedFiles.length ? fingerprint(changedFiles) : "";
  const testsHash = tests.length ? fingerprint(tests) : "";
  const blockerHash = blockers ? fingerprint(blockers.replace(/\s+/gu, " ").slice(0, 240)) : "";
  const reasons = [];
  if (newCommits.length) reasons.push("new commit");
  if (diffHash && diffHash !== previousDiffHash) reasons.push("diff changed");
  const evidenceFiles = [...new Set([
    ...list(evidence.changedFiles),
    ...report.fileChanges.map((change) => text(change?.path || change?.file || change?.filename))
  ])];
  const evidenceFilesHash = evidenceFiles.length ? fingerprint(evidenceFiles) : "";
  if (evidenceFilesHash && evidenceFilesHash !== previousFilesHash) reasons.push("changed files");
  if (testsHash && testsHash !== previousTestsHash && testProgress(text(turn?.result?.text), tests, previousHistory)) {
    reasons.push("new test evidence");
  }
  if (report.reviewReady === true && previousValue(previousHistory, "reviewReady", false) !== true) {
    reasons.push("acceptance boundary reported ready");
  }
  if (blockerHash && blockerHash !== previousBlockerHash
    && (!previousBlockerHash || /(?:new|additional|discovered|identified|diagnos)/iu.test(blockers))) {
    reasons.push("new blocker evidence");
  }
  const material = reasons.length > 0;
  return {
    pass: Number(pass) || 0,
    at: text(at),
    turnId: text(turn?.turnId),
    requestIdentity: text(turn?.requestIdentity),
    state: text(turn?.state),
    summary: text(report.summary),
    commits,
    newCommits,
    changedFiles,
    changedFilesHash: evidenceFilesHash,
    diffHash,
    tests,
    testsHash,
    blockers,
    blockerHash,
    reviewReady: report.reviewReady === true,
    material,
    materialReasons: reasons,
    noDeltaReason: material ? "" : "same commit, diff, tests, acceptance state, and blocker evidence"
  };
}

export function deriveImplementationProgress(checkpoint = {}) {
  const implementation = checkpoint.implementation || {};
  if (Array.isArray(implementation.passHistory) && implementation.passHistory.length) {
    return summarizeImplementationProgress(implementation.passHistory);
  }
  const history = [];
  let pass = 0;
  for (const turn of Array.isArray(checkpoint.turnHistory) ? checkpoint.turnHistory : []) {
    if (turn?.phase !== "implementation") continue;
    const report = reportFromTurn(turn);
    const completed = text(turn.state) === "completed" && Boolean(text(turn?.result?.text));
    if (!completed) {
      history.push({
        pass: 0,
        at: text(turn.completedAt || turn.startedAt),
        turnId: text(turn.turnId),
        requestIdentity: text(turn.requestIdentity),
        state: text(turn.state),
        material: false,
        materialReasons: [],
        noDeltaReason: text(turn.state) || "unresolved implementation turn"
      });
      continue;
    }
    pass += 1;
    history.push(classifyImplementationPass({
      pass,
      at: turn.completedAt || turn.startedAt,
      turn,
      report,
      previousHistory: history.filter((entry) => entry.state === "completed")
    }));
  }
  return summarizeImplementationProgress(history);
}

export function summarizeImplementationProgress(passHistory = []) {
  const history = Array.isArray(passHistory) ? passHistory : [];
  const completed = history.filter((entry) => entry.state === "completed" || entry.state === "");
  const material = completed.filter((entry) => entry.material === true);
  const noProgress = completed.filter((entry) => entry.material !== true);
  let consecutiveNoProgress = 0;
  for (const entry of [...completed].reverse()) {
    if (entry.material === true) break;
    consecutiveNoProgress += 1;
  }
  const commits = new Set(completed.flatMap((entry) => entry.newCommits || entry.commits || []));
  const lastMaterial = [...material].at(-1);
  return {
    passHistory: history,
    implementationPasses: completed.length,
    materialProgressPasses: material.length,
    noProgressPasses: noProgress.length,
    consecutiveNoProgressPasses: consecutiveNoProgress,
    commitsProduced: commits.size,
    lastMaterialProgressAt: text(lastMaterial?.at),
    acceptanceChecksClosed: material.filter((entry) => (entry.materialReasons || []).includes("acceptance boundary reported ready")).length
  };
}

export function implementationProgressFields(progress = {}) {
  return {
    passHistory: Array.isArray(progress.passHistory) ? progress.passHistory : [],
    materialProgressPasses: Number(progress.materialProgressPasses) || 0,
    noProgressPasses: Number(progress.noProgressPasses) || 0,
    consecutiveNoProgressPasses: Number(progress.consecutiveNoProgressPasses) || 0,
    commitsProduced: Number(progress.commitsProduced) || 0,
    acceptanceChecksClosed: Number(progress.acceptanceChecksClosed) || 0,
    lastMaterialProgressAt: text(progress.lastMaterialProgressAt)
  };

}
