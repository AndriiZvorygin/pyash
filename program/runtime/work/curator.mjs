import fs from "node:fs/promises";
import path from "node:path";

import { addWorkTask, listWorkTasks } from "./operator.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function iso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

const CANDIDATES = Object.freeze([
  {
    taskId: "roadmap-translation-parity-tranche",
    title: "Complete the higher-level translation parity tranche",
    anchor: "Higher-level translation paths parity",
    priority: 125,
    prompt: "Complete one bounded higher-level translation parity tranche across the current interpreter and JavaScript paths, with the corresponding golden and regression coverage.",
    acceptance: "The selected translation capability works end-to-end in the interpreter and JavaScript backend, relevant parity tests and goldens pass, and the implementation boundary is documented.",
    whyNow: "This is the highest non-external parity item in the current TODO and is a coherent capability slice rather than a micro-fix."
  },
  {
    taskId: "roadmap-mind-reply-envelope-streaming",
    title: "Complete mind reply envelopes and streaming parity",
    anchor: "Mind: plus streaming path and richer reply envelopes",
    priority: 120,
    prompt: "Implement the next coherent mind capability slice: richer reply envelopes and the plus streaming path across the current supported runtime surfaces, with durable tests and documentation alignment.",
    acceptance: "Mind replies preserve assistant text, metadata, and streaming behavior through the supported runtime paths, focused tests cover success and failure envelopes, and no fixture-only path is required.",
    whyNow: "Mind integration is an active language/runtime milestone and unlocks more useful Pyash-first agent workflows."
  },
  {
    taskId: "roadmap-ceremony-error-propagation",
    title: "Complete ceremony and sandpit error propagation",
    anchor: "Add error-handling paths for ceremonies/sandpits",
    priority: 115,
    prompt: "Implement one coherent ceremony and sandpit error-propagation slice using ret with be error, preserving surfaced main-memory/results behavior and parity coverage.",
    acceptance: "Ceremony and sandpit errors become truthful Pyash error sentences, propagate through interpreter and supported compiled paths, and focused regression tests cover nested and returned errors.",
    whyNow: "This closes a language-runtime correctness gap that affects reliable autonomous work and is explicitly called out in the current TODO."
  }
]);

function sourceKey(candidate) {
  return `documentation/todo.md:${candidate.anchor}`;
}

async function todoSource(repositoryRoot) {
  const filename = path.join(repositoryRoot, "documentation", "todo.md");
  try {
    return await fs.readFile(filename, "utf8");
  } catch {
    return "";
  }
}

function sourceRecord(candidate, source) {
  const offset = source.indexOf(candidate.anchor);
  const line = offset < 0 ? 0 : source.slice(0, offset).split("\n").length;
  return {
    kind: "todo",
    path: "documentation/todo.md",
    anchor: candidate.anchor,
    line,
    key: sourceKey(candidate),
    whyNow: candidate.whyNow
  };
}

export async function curateWorkBacklog({
  worldRoot,
  repositoryRoot = process.cwd(),
  owner = "background",
  threshold = 1,
  maxTasks = 3,
  dryRun = false,
  now = () => new Date()
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  const active = tasks.filter((task) => !["accepted", "failed", "blocked"].includes(task.status));
  if (active.length >= Math.max(0, Number(threshold) || 0)) {
    return { created: [], proposed: [], needsDirection: false, reason: "backlog threshold satisfied", active: active.length };
  }
  const source = await todoSource(repositoryRoot);
  const known = new Set(tasks.flatMap((task) => [
    task.taskId,
    task.workSpec?.provenance?.key
  ].filter(Boolean)));
  const proposed = CANDIDATES
    .filter((candidate) => source.includes(candidate.anchor))
    .filter((candidate) => !known.has(candidate.taskId) && !known.has(sourceKey(candidate)))
    .slice(0, Math.max(0, Number(maxTasks) || 0))
    .map((candidate) => ({
      ...candidate,
      provenance: sourceRecord(candidate, source)
    }));
  if (dryRun) {
    return {
      created: [],
      proposed,
      needsDirection: active.length === 0 && proposed.length === 0,
      reason: proposed.length ? "curated current TODO" : "roadmap backlog exhausted",
      active: active.length
    };
  }
  const created = [];
  for (const candidate of proposed) {
    await addWorkTask(worldRoot, {
      taskId: candidate.taskId,
      owner,
      kind: "roadmap",
      title: candidate.title,
      promptText: candidate.prompt,
      acceptanceText: candidate.acceptance,
      contextText: `Pyash-first policy. Source: ${candidate.provenance.path}:${candidate.provenance.line}. Why now: ${candidate.whyNow}`,
      priority: candidate.priority,
      retryMax: 1,
      queuedAt: iso(now),
      workSpec: {
        granularity: "substantial",
        pyashFirst: true,
        provenance: candidate.provenance
      }
    });
    created.push(candidate.taskId);
    known.add(candidate.taskId);
    known.add(candidate.provenance.key);
  }
  return {
    created,
    proposed,
    needsDirection: active.length === 0 && created.length === 0,
    reason: created.length ? "curated current TODO" : "roadmap backlog exhausted",
    active: active.length
  };
}

export function curatedCandidates() {
  return CANDIDATES.map((candidate) => ({ ...candidate }));
}

