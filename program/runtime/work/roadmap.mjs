import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pyaFileToJson } from "../../library/pya_to_json.mjs";
import { listWorkTasks } from "./operator.mjs";
import { resolveWorkRoleConfig } from "./supervisor.mjs";
import {
  resumeCodexThread,
  runCodexTurn,
  spawnCodexAppServer,
  startCodexThread,
  threadIdFromResponse
} from "../codex/app_server.mjs";

const ROADMAP_PACKAGES = Object.freeze([
  {
    taskId: "roadmap-translation-parity-tranche",
    title: "Complete the higher-level translation parity tranche",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Higher-level translation paths parity",
    whyMatters: "Closes the highest current non-external parity gap and makes the language surface safer to use across interpreter and JavaScript execution.",
    dependencies: ["stable ceremony signature and return semantics"],
    scope: "Top-level multi-word ceremonies, signature-first binding, isolated call frames, this/ret propagation, repeated calls, interpreter/JavaScript parity tests and goldens.",
    nonGoals: "Nested or dynamic definitions, recursion, closures, imports, C parity, and general translator refactoring.",
    acceptance: "The selected capability works end-to-end in the interpreter and JavaScript backend; focused parity tests, wrong-signature guards, and goldens pass; the supported boundary is documented.",
    priority: 125,
    prompt: "Complete one bounded higher-level translation parity tranche across the current interpreter and JavaScript paths, with the corresponding golden and regression coverage.",
    whyNow: "This is the highest non-external parity item in the current TODO and is a coherent capability slice rather than a micro-fix."
  },
  {
    taskId: "roadmap-mind-reply-envelope-streaming",
    title: "Complete mind reply envelopes and streaming parity",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Mind: plus streaming path and richer reply envelopes",
    whyMatters: "Makes mind calls useful as a durable language/runtime primitive by preserving assistant, thinking, timestamp, and streaming evidence.",
    dependencies: ["current mind contract", "translation/runtime parity baseline"],
    scope: "Richer reply envelope mapping, Ollama streaming path, supported interpreter/JavaScript surfaces, durable success/failure tests, and aligned documentation.",
    nonGoals: "New providers, multi-host scheduling, UI work, and fixture-only behavior.",
    acceptance: "Mind replies preserve text, metadata, and streaming behavior through supported runtime paths; focused success/failure tests pass without fixture-only backends.",
    priority: 120,
    prompt: "Implement the next coherent mind capability slice: richer reply envelopes and the plus streaming path across the current supported runtime surfaces, with durable tests and documentation alignment.",
    whyNow: "Mind integration is an active language/runtime milestone and unlocks more useful Pyash-first agent workflows."
  },
  {
    taskId: "roadmap-ceremony-error-propagation",
    title: "Complete ceremony and sandpit error propagation",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Add error-handling paths for ceremonies/sandpits",
    whyMatters: "Reliable autonomous work needs truthful errors to cross ceremony boundaries without losing source context or result shape.",
    dependencies: ["ceremony this/ret semantics", "error sentence contract"],
    scope: "ret with be error, nested and returned ceremony errors, surfaced main-memory/results behavior, and supported parity coverage.",
    nonGoals: "A new exception system, undocumented error names, or broad compiler redesign.",
    acceptance: "Ceremony and sandpit errors become truthful Pyash error sentences, propagate through supported paths, and focused nested/returned error tests pass.",
    priority: 115,
    prompt: "Implement one coherent ceremony and sandpit error-propagation slice using ret with be error, preserving surfaced main-memory/results behavior and parity coverage.",
    whyNow: "This closes a language-runtime correctness gap that affects reliable autonomous work and is explicitly called out in the current TODO."
  },
  {
    taskId: "roadmap-hnuc-compositional-validation",
    title: "Add HNUC compositional-case validation",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Add hnuc/code validation utilities for compositional cases",
    whyMatters: "Turns the compositional case table into executable validation so parser, signatures, compiler, and vocabulary cannot drift silently.",
    dependencies: ["compositionalCases.mjs", "sentence grammar specification"],
    scope: "HNUC/code validation utilities, case-grid coverage, deterministic diagnostics, and focused parser/signature regression tests.",
    nonGoals: "Inventing new compositional keywords or replacing the canonical case table.",
    acceptance: "The validator checks the canonical compositional grid and catches missing/invalid axis-context mappings with deterministic tests and operator-readable output.",
    priority: 110,
    prompt: "Add a bounded HNUC/code validation capability for compositional cases, aligned with the canonical case grid and covered by deterministic parser/signature tests.",
    whyNow: "The runtime already centralizes compositional cases; validation is a high-leverage guard against future parity regressions."
  },
  {
    taskId: "roadmap-register-state-ground-truth",
    title: "Remove separate register-fact reliance",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Remove reliance on separate register facts",
    whyMatters: "Keeps the evoking sentence as the source of truth and reduces stale fromindex/toindex state during loops and resumed work.",
    dependencies: ["loop semantics", "evoke sentence result contract"],
    scope: "Derive register lookups from the evoking sentence, preserve observable loop behavior, and add interpreter/JavaScript/C parity guards where supported.",
    nonGoals: "Removing legitimate result facts or changing the public loop vocabulary.",
    acceptance: "Loop and ceremony paths no longer depend on stale separate register facts; existing loop behavior and backend parity remain green.",
    priority: 105,
    prompt: "Complete a focused register-state cleanup so evoking sentences remain ground truth while preserving loop behavior and parity coverage.",
    whyNow: "This is an explicitly recorded correctness debt in the TODO and supports reliable multi-wake language work."
  },
  {
    taskId: "roadmap-cli-language-ux",
    title: "Strengthen CLI language UX",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Strengthen CLI UX",
    whyMatters: "Makes the language executable and inspectable for humans without requiring knowledge of internal wrapper conventions.",
    dependencies: ["current compile/run/interpret commands", "CLI contract tests"],
    scope: "Document case-parsed compile/run/interpret arguments, add smoke coverage for the wrappers, and keep command output/error contracts explicit.",
    nonGoals: "A new CLI framework or a broad flag/alias compatibility layer.",
    acceptance: "The documented CLI forms work from a clean checkout, focused smoke tests cover success and error paths, and command contracts are clear.",
    priority: 100,
    prompt: "Strengthen the Pyash CLI language UX with documented case-parsed compile/run/interpret forms and deterministic wrapper smoke tests.",
    whyNow: "Operator usability is a direct multiplier for every later language and automation milestone."
  },
  {
    taskId: "roadmap-standard-verb-coverage",
    title: "Expand standard verb and noun coverage",
    sourcePath: "documentation/todo.md",
    sourceAnchor: "Expand verb coverage with quizzes for additional nouns/classes",
    whyMatters: "Builds language capability from tested vocabulary instead of adding runtime behavior without a stable surface contract.",
    dependencies: ["pyac.md noun/class hints", "signature-first dispatch"],
    scope: "Choose one coherent noun/class family, add specification-aligned signatures, interpreter behavior, parity quizzes, and examples before implementation broadens.",
    nonGoals: "A speculative standard library expansion or untested vocabulary aliases.",
    acceptance: "One noun/class family has a frozen sentence contract, interpreter behavior, parity coverage, and runnable examples without unrelated verb churn.",
    priority: 95,
    prompt: "Choose and complete one bounded standard verb/noun coverage family from pyac.md, with frozen signatures, interpreter behavior, parity quizzes, and a runnable example.",
    whyNow: "The current TODO explicitly prioritizes vocabulary contracts before adding more code."
  },
  {
    taskId: "roadmap-pyash-native-agent-workflows",
    title: "Strengthen Pyash-native agent workflows",
    sourcePath: "documentation/roadmap.md",
    sourceAnchor: "Next milestone: Agent harness (research + builder)",
    whyMatters: "Exercises Pyash itself as the workflow language and improves the agent/runtime substrate that operates the roadmap.",
    dependencies: ["agent session and scheduler contracts", "mind reply envelopes", "tool/MCP lifecycle"],
    scope: "One end-to-end Pyash-defined agent workflow using existing session, tool, newspaper, and command primitives, with a durable example and tests.",
    nonGoals: "Replacing the supervisor, adding parallel workers, or inventing a second agent framework.",
    acceptance: "A bounded agent workflow is expressed in Pyash where reasonable, runs through supported runtime primitives, records durable evidence, and has zero-quota tests.",
    priority: 90,
    prompt: "Complete one Pyash-first agent workflow slice using existing session, tool, newspaper, and command primitives, with a durable example and tests.",
    whyNow: "The roadmap names the agent harness as the next product milestone, and the manager policy explicitly asks autonomous work to dogfood Pyash."
  }
]);

const COMPLETED_PACKAGES = Object.freeze([
  {
    taskId: "language-ret-register-live",
    title: "Complete single-register ceremony ret parity",
    sourcePath: "quiz/definitions.test.mjs",
    sourceAnchor: "ceremony with ret returns updated evoke registers to caller names",
    whyMatters: "Established the first real ceremony return parity increment used by later translation and error work.",
    dependencies: [],
    scope: "Single-register ceremony ret propagation and focused interpreter regression coverage.",
    nonGoals: "Higher-level translation, nested ceremonies, and broader return refactoring.",
    acceptance: "The Sol-reviewed focused regression passes and the accepted task commit is available for automation history.",
    priority: 131
  }
]);

const ROADMAP_SCHEMA = "1";

function text(value) {
  return String(value ?? "").trim();
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function roadmapPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.pya");
}

function roadmapMarkdownPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.md");
}

function listField(value) {
  return Array.isArray(value) ? value.join(" | ") : text(value);
}

function fieldEntries(item) {
  return [
    ["task id", item.taskId],
    ["title", item.title],
    ["source", item.source],
    ["source path", item.sourcePath],
    ["source anchor", item.sourceAnchor],
    ["why matters", item.whyMatters],
    ["dependencies", listField(item.dependencies)],
    ["intended scope", item.scope],
    ["non goals", listField(item.nonGoals)],
    ["acceptance", item.acceptance],
    ["priority", item.priority],
    ["status", item.status],
    ["current progress", item.progress],
    ["worktree", item.worktree],
    ["commit", item.commit]
  ];
}

function renderMap(name, entries) {
  return [
    `su name ${name} be map def`,
    ...entries
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `  su name ${key} ob text ${quote(value)} ya`),
    "prah",
    ""
  ].join("\n");
}

function sourceForPackage(item) {
  return item.source || `${item.sourcePath}:${item.sourceAnchor}`;
}

function taskMatch(item, tasks) {
  return tasks.find((task) => task.taskId === item.taskId)
    || tasks.find((task) => task.workSpec?.provenance?.key === `${item.sourcePath}:${item.sourceAnchor}`);
}

function progressForTask(task) {
  if (!task) return "not started; candidate package";
  const checkpoint = task.checkpoint || {};
  const passes = Number(checkpoint.implementation?.passes || 0);
  const action = text(checkpoint.lastAction || checkpoint.interruption?.reason);
  if (task.status === "accepted") return `accepted; Sol review ${text(checkpoint.review?.decision) || "complete"}`;
  if (task.status === "blocked" || task.status === "failed") return text(checkpoint.blocker || task.message || task.error) || task.status;
  if (task.status === "ready") return "queued for the next eligible background wake";
  return `${passes} implementation pass${passes === 1 ? "" : "es"}; ${action || `phase ${task.status}`}`;
}

function statusForTask(task) {
  if (!task) return "CANDIDATE";
  if (task.status === "accepted") return "COMPLETE";
  if (task.status === "blocked" || task.status === "failed") return "BLOCKED / NEEDS DECISION";
  if (task.status === "ready") return "QUEUED";
  return "ACTIVE";
}

function normalizePackage(item, task) {
  return {
    ...item,
    source: sourceForPackage(item),
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : text(item.dependencies).split(" | ").filter(Boolean),
    nonGoals: Array.isArray(item.nonGoals) ? item.nonGoals : text(item.nonGoals),
    status: statusForTask(task),
    progress: progressForTask(task),
    worktree: text(task?.checkpoint?.workspace?.worktreePath),
    commit: text(task?.checkpoint?.integration?.commit || task?.checkpoint?.implementation?.commit)
  };
}

function mapValue(map, key) {
  const node = map?.[key];
  return String(node?.ob?.text ?? "").trim();
}

function mapFromMemory(memory, name) {
  const sentence = (Array.isArray(memory) ? memory : []).find((item) => item?.su?.name === name && item?.be === "map");
  return sentence?.ob?.map || {};
}

function splitList(value) {
  return text(value).split(" | ").filter(Boolean);
}

function packageFromMap(map) {
  return {
    taskId: mapValue(map, "task id"),
    title: mapValue(map, "title"),
    source: mapValue(map, "source"),
    sourcePath: mapValue(map, "source path"),
    sourceAnchor: mapValue(map, "source anchor"),
    whyMatters: mapValue(map, "why matters"),
    dependencies: splitList(mapValue(map, "dependencies")),
    scope: mapValue(map, "intended scope"),
    nonGoals: mapValue(map, "non goals"),
    acceptance: mapValue(map, "acceptance"),
    priority: Number(mapValue(map, "priority")) || 0,
    status: mapValue(map, "status"),
    progress: mapValue(map, "current progress"),
    worktree: mapValue(map, "worktree"),
    commit: mapValue(map, "commit")
  };
}

export function autonomousRoadmapPackages() {
  return ROADMAP_PACKAGES.map((item) => ({ ...item, dependencies: [...item.dependencies] }));
}

export function autonomousCompletedPackages() {
  return COMPLETED_PACKAGES.map((item) => ({ ...item, dependencies: [...item.dependencies] }));
}

export function autonomousRoadmapPaths(worldRoot) {
  return { pya: roadmapPath(worldRoot), markdown: roadmapMarkdownPath(worldRoot) };
}

export function roadmapNeedsRefresh(roadmap) {
  return Boolean(roadmap?.refreshNeeded)
    || (roadmap?.packages || []).filter((item) => item.status === "CANDIDATE").length < 3;
}

export function renderAutonomousRoadmapMarkdown(roadmap = {}) {
  const sections = [
    ["Active", (roadmap.packages || []).filter((item) => item.status === "ACTIVE")],
    ["Queued", (roadmap.packages || []).filter((item) => item.status === "QUEUED")],
    ["Candidate", (roadmap.packages || []).filter((item) => item.status === "CANDIDATE")],
    ["Blocked / Needs Decision", [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / NEEDS DECISION"),
      ...(roadmap.needsDecision || [])
    ]],
    ["Complete", [
      ...(roadmap.packages || []).filter((item) => item.status === "COMPLETE"),
      ...(roadmap.completed || [])
    ]]
  ];
  const output = ["# Pyash Autonomous Roadmap", "", `Generated: ${roadmap.generatedAt || "unknown"}`, `Refresh needed: ${roadmap.refreshNeeded ? "yes" : "no"}`, `Refresh reason: ${roadmap.refreshReason || "roadmap has enough credible packages"}`, ""];
  for (const [heading, items] of sections) {
    output.push(`## ${heading}`, "");
    if (!items.length) {
      output.push("_None._", "");
      continue;
    }
    for (const item of items) {
      output.push(`### ${item.title || item.taskId}`, "", `- Task: \`${item.taskId}\``, `- Source: ${item.source || "operator history"}`, `- Priority: ${item.priority ?? ""}`, `- Status: ${item.status || heading.toUpperCase()}`, `- Progress: ${item.progress || ""}`);
      if (item.whyMatters) output.push(`- Why it matters: ${item.whyMatters}`);
      if (item.dependencies?.length) output.push(`- Dependencies: ${listField(item.dependencies)}`);
      if (item.scope) output.push(`- Scope: ${item.scope}`);
      if (item.nonGoals) output.push(`- Non-goals: ${listField(item.nonGoals)}`);
      if (item.acceptance) output.push(`- Acceptance: ${item.acceptance}`);
      if (item.worktree) output.push(`- Worktree: \`${item.worktree}\``);
      if (item.commit) output.push(`- Commit: \`${item.commit}\``);
      output.push("");
    }
  }
  if (roadmap.architect?.summary) output.push("## Last Sol Roadmap Review", "", roadmap.architect.summary, "");
  if (roadmap.architect?.decisions?.length) output.push("### Decisions Needed", "", ...roadmap.architect.decisions.map((item) => `- ${item}`), "");
  return output.join("\n");
}

export function renderAutonomousRoadmapReport(roadmap = {}) {
  const groups = [
    ["ACTIVE", (roadmap.packages || []).filter((item) => item.status === "ACTIVE")],
    ["QUEUED", (roadmap.packages || []).filter((item) => item.status === "QUEUED")],
    ["CANDIDATE", (roadmap.packages || []).filter((item) => item.status === "CANDIDATE")],
    ["BLOCKED / NEEDS DECISION", [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / NEEDS DECISION"),
      ...(roadmap.needsDecision || [])
    ]],
    ["COMPLETE", [
      ...(roadmap.packages || []).filter((item) => item.status === "COMPLETE"),
      ...(roadmap.completed || [])
    ]]
  ];
  const lines = [
    "PYASH AUTONOMOUS ROADMAP",
    "",
    `Generated: ${roadmap.generatedAt || "unknown"}`,
    `Refresh needed: ${roadmap.refreshNeeded ? "yes" : "no"}`,
    `Refresh reason: ${roadmap.refreshReason || "roadmap has enough credible packages"}`,
    ""
  ];
  for (const [heading, items] of groups) {
    lines.push(heading, "-".repeat(heading.length));
    if (!items.length) {
      lines.push("(none)", "");
      continue;
    }
    for (const item of items) {
      lines.push(`${item.taskId} [priority ${item.priority}] ${item.title}`, `  progress: ${item.progress || ""}`);
      if (item.source) lines.push(`  source: ${item.source}`);
      if (item.worktree) lines.push(`  worktree: ${item.worktree}`);
      if (item.commit) lines.push(`  commit: ${item.commit}`);
    }
    lines.push("");
  }
  if (roadmap.architect?.summary) {
    lines.push("LAST SOL ROADMAP REVIEW", "------------------------", roadmap.architect.summary, "");
  }
  if (roadmap.architect?.decisions?.length) {
    lines.push("SOL DECISIONS NEEDED", "--------------------", ...roadmap.architect.decisions.map((item) => `- ${item}`), "");
  }
  return lines.join("\n");
}

function renderAutonomousRoadmapPya(roadmap) {
  const header = renderMap("work autonomous roadmap state", [
    ["schema", roadmap.schema || ROADMAP_SCHEMA],
    ["generated at", roadmap.generatedAt],
    ["refresh needed", roadmap.refreshNeeded ? "true" : "false"],
    ["refresh reason", roadmap.refreshReason],
    ["last refresh at", roadmap.architect?.refreshedAt || ""],
    ["manager thread id", roadmap.architect?.threadId || ""],
    ["last sol summary", roadmap.architect?.summary || ""]
  ]);
  const packageText = [...(roadmap.packages || []), ...(roadmap.completed || [])]
    .map((item) => renderMap(`work autonomous roadmap package ${item.taskId}`, fieldEntries(item)))
    .join("\n");
  const decisions = renderMap("work autonomous roadmap decisions", (roadmap.needsDecision || []).map((item, index) => [String(index + 1), `${item.taskId}: ${item.blocker || item.progress || item.title}`]));
  return `${header}${packageText}${decisions}`;
}

export async function readAutonomousRoadmap(worldRoot) {
  const { pya, markdown } = autonomousRoadmapPaths(worldRoot);
  try {
    const payload = await pyaFileToJson(pya, { memoryOnly: false });
    const stateMap = mapFromMemory(payload.memory, "work autonomous roadmap state");
    const packageMaps = (payload.memory || [])
      .filter((item) => item?.be === "map" && String(item?.su?.name || "").startsWith("work autonomous roadmap package "))
      .map((item) => packageFromMap(item.ob?.map || {}))
      .filter((item) => item.taskId);
    const decisionsMap = mapFromMemory(payload.memory, "work autonomous roadmap decisions");
    const decisions = Object.values(decisionsMap).map((item) => String(item?.ob?.text || "")).filter(Boolean);
    return {
      schema: mapValue(stateMap, "schema") || ROADMAP_SCHEMA,
      generatedAt: mapValue(stateMap, "generated at"),
      refreshNeeded: mapValue(stateMap, "refresh needed") === "true",
      refreshReason: mapValue(stateMap, "refresh reason"),
      architect: {
        refreshedAt: mapValue(stateMap, "last refresh at"),
        threadId: mapValue(stateMap, "manager thread id"),
        summary: mapValue(stateMap, "last sol summary"),
        decisions
      },
      packages: packageMaps.filter((item) => !COMPLETED_PACKAGES.some((completed) => completed.taskId === item.taskId)),
      completed: packageMaps.filter((item) => COMPLETED_PACKAGES.some((completed) => completed.taskId === item.taskId)),
      needsDecision: decisions,
      paths: { pya, markdown }
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

export async function writeAutonomousRoadmap(worldRoot, roadmap) {
  const { pya, markdown } = autonomousRoadmapPaths(worldRoot);
  await fs.mkdir(path.dirname(pya), { recursive: true });
  const pyaTemp = `${pya}.tmp-${process.pid}-${Date.now()}`;
  const markdownTemp = `${markdown}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(pyaTemp, renderAutonomousRoadmapPya(roadmap), "utf8");
  await fs.writeFile(markdownTemp, `${renderAutonomousRoadmapMarkdown(roadmap)}\n`, "utf8");
  await fs.rename(pyaTemp, pya);
  await fs.rename(markdownTemp, markdown);
  return { ...roadmap, paths: { pya, markdown } };
}

export async function buildAutonomousRoadmap({
  worldRoot,
  repositoryRoot = process.cwd(),
  tasks = null,
  now = () => new Date(),
  persist = true,
  architect = null
} = {}) {
  const allTasks = tasks || await listWorkTasks(worldRoot, { includeTerminal: true });
  const previous = await readAutonomousRoadmap(worldRoot);
  const persistedCatalog = previous?.packages?.filter((item) => item.taskId && item.sourcePath && item.sourceAnchor) || [];
  const catalog = persistedCatalog.length >= 5 ? persistedCatalog : ROADMAP_PACKAGES;
  const packages = catalog.map((item) => normalizePackage(item, taskMatch(item, allTasks)));
  const completed = COMPLETED_PACKAGES.map((item) => normalizePackage(item, taskMatch(item, allTasks)));
  const needsDecision = allTasks
    .filter((task) => task.status === "blocked")
    .filter((task) => !packages.some((item) => item.taskId === task.taskId))
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: "BLOCKED / NEEDS DECISION",
      priority: task.priority,
      blocker: text(task.checkpoint?.blocker || task.message || task.error),
      progress: progressForTask(task)
    }));
  const roadmap = {
    schema: ROADMAP_SCHEMA,
    generatedAt: iso(typeof now === "function" ? now() : now),
    refreshNeeded: false,
    refreshReason: "roadmap has enough credible packages",
    packages,
    completed,
    needsDecision,
    architect: architect || previous?.architect || {},
    repositoryRoot
  };
  roadmap.refreshNeeded = roadmapNeedsRefresh(roadmap);
  if (roadmap.refreshNeeded) roadmap.refreshReason = "fewer than three credible candidate packages remain";
  return persist ? writeAutonomousRoadmap(worldRoot, roadmap) : roadmap;
}

function parseArchitectResponse(output) {
  const raw = text(output);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Sol roadmap refresh did not return a JSON object");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed.packages) || parsed.packages.length < 5 || parsed.packages.length > 8) {
    throw new Error("Sol roadmap refresh must return 5 to 8 substantial packages");
  }
  return parsed;
}

function normalizeArchitectPackage(item, index) {
  const taskId = text(item.taskId) || `roadmap-curated-${index + 1}`;
  return {
    taskId,
    title: text(item.title) || taskId,
    source: text(item.source) || "Sol roadmap review",
    sourcePath: text(item.sourcePath),
    sourceAnchor: text(item.sourceAnchor),
    whyMatters: text(item.whyMatters || item.whyNow),
    dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(text).filter(Boolean) : [],
    scope: text(item.scope),
    nonGoals: text(item.nonGoals),
    acceptance: text(item.acceptance),
    priority: Number(item.priority) || 0,
    prompt: text(item.prompt) || text(item.scope),
    whyNow: text(item.whyNow || item.whyMatters)
  };
}

function roadmapRefreshPrompt(roadmap, repositoryRoot) {
  return [
    "You are Sol, the occasional Pyash roadmap architect.",
    "Inspect the repository, current specs, TODO, tests, and durable work state before proposing the next substantial packages.",
    "Return JSON only with this shape: {summary, decisions, packages:[{taskId,title,source,whyMatters,dependencies,scope,nonGoals,acceptance,priority,prompt,whyNow}] }.",
    "Return 5 to 8 packages. Keep only the first 2 or 3 ready-worthy; the rest are candidates. Prefer coherent language/runtime/parity increments over micro-fixes.",
    "Respect Pyash-first policy: use Pyash for workflow logic when reasonably expressible and state the reason for host-language substrate.",
    `Repository: ${repositoryRoot}`,
    `Current roadmap:\n${JSON.stringify(roadmap.packages)}`,
    `Current needs for human decision:\n${JSON.stringify(roadmap.needsDecision)}`
  ].join("\n");
}

export async function refreshAutonomousRoadmap({
  worldRoot,
  repositoryRoot = process.cwd(),
  appServerFactory = ({}) => spawnCodexAppServer({}),
  roleConfig = {},
  threadSandbox = "workspace-write",
  now = () => new Date(),
  ifNeeded = false
} = {}) {
  const current = await buildAutonomousRoadmap({ worldRoot, repositoryRoot, now, persist: false });
  if (ifNeeded && !roadmapNeedsRefresh(current)) {
    return { status: "not-needed", roadmap: await writeAutonomousRoadmap(worldRoot, current) };
  }
  const roles = resolveWorkRoleConfig({ manager: roleConfig.manager });
  const existingThread = current.architect?.threadId || "";
  const client = await appServerFactory({
    role: "manager",
    model: roles.manager.model,
    reasoningEffort: roles.manager.reasoningEffort,
    cwd: repositoryRoot,
    threadId: existingThread
  });
  try {
    let threadId = existingThread;
    if (threadId) {
      if (typeof client.resumeThread === "function") await client.resumeThread({ threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
      else await resumeCodexThread(client, threadId, { cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
    } else {
      const started = typeof client.startThread === "function"
        ? await client.startThread({ role: "manager", cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox })
        : await startCodexThread(client, { cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, sandbox: threadSandbox });
      threadId = threadIdFromResponse(started);
    }
    if (!threadId) throw new Error("Sol roadmap refresh returned no manager thread id");
    const result = typeof client.runTurn === "function"
      ? await client.runTurn({ threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, requestIdentity: `pyash-autonomous-roadmap-refresh-${Date.now()}`, input: [{ type: "text", text: roadmapRefreshPrompt(current, repositoryRoot) }] })
      : await runCodexTurn(client, { threadId, cwd: repositoryRoot, model: roles.manager.model, reasoningEffort: roles.manager.reasoningEffort, requestIdentity: `pyash-autonomous-roadmap-refresh-${Date.now()}`, input: [{ type: "text", text: roadmapRefreshPrompt(current, repositoryRoot) }] });
    const proposal = parseArchitectResponse(result?.text || result?.output || "");
    const packages = proposal.packages.map(normalizeArchitectPackage);
    const refreshedTasks = await listWorkTasks(worldRoot, { includeTerminal: true });
    const refreshed = await buildAutonomousRoadmap({
      worldRoot,
      repositoryRoot,
      now,
      persist: false,
      architect: {
        threadId,
        refreshedAt: iso(typeof now === "function" ? now() : now),
        summary: text(proposal.summary),
        decisions: Array.isArray(proposal.decisions) ? proposal.decisions.map(text).filter(Boolean) : []
      }
    });
    refreshed.packages = packages.map((item) => normalizePackage(item, refreshedTasks.find((task) => task.taskId === item.taskId)));
    refreshed.refreshNeeded = false;
    refreshed.refreshReason = "last Sol roadmap refresh returned a bounded package set";
    const roadmap = await writeAutonomousRoadmap(worldRoot, refreshed);
    return { status: "refreshed", roadmap, proposal };
  } finally {
    await client?.close?.();
  }
}
