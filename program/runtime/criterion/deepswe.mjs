import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { collectMachineMetadata } from "./machine.mjs";
import { sha256, stableJson } from "./metrics.mjs";
import { writeRunArtifacts } from "./report.mjs";

export const DEEPSWE_CATALOG = Object.freeze({
  name: "DeepSWE",
  version: "official DeepSWE task corpus; verifier-scored external Pier run",
  sourceUrl: "https://github.com/datacurve-ai/deep-swe",
  licenseUrl: "https://github.com/datacurve-ai/deep-swe/blob/main/LICENSE",
  taskFormatUrl: "https://www.harborframework.com/",
  required: "local DeepSWE tasks directory and an installed Pier runner"
});

export const DEFAULT_DEEPSWE_MODEL = "qwen3.5:9b";
export const DEFAULT_DEEPSWE_AGENT = "mini-swe-agent";
export const DEFAULT_DEEPSWE_SAMPLE_SEED = 0;
export const DEFAULT_DEEPSWE_PIER_COMMAND = "pier";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(value, keys) {
  if (typeof value === "number") return finiteNumber(value);
  for (const key of keys) {
    const number = finiteNumber(value?.[key]);
    if (number !== null) return number;
  }
  return null;
}

function firstString(value, keys) {
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null) return String(value[key]);
  }
  return null;
}

function parseTomlValue(value) {
  const trimmed = String(value ?? "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/u, "");
}

function parseTomlMetadata(text) {
  const metadata = {};
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/u);
    if (!match) continue;
    metadata[match[1]] = parseTomlValue(match[2]);
  }
  return metadata;
}

export async function discoverDeepSWETasks(tasksRoot) {
  const root = path.resolve(String(tasksRoot ?? ""));
  const found = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const manifestPath = path.join(entryPath, "task.toml");
        try {
          const text = await fs.readFile(manifestPath, "utf8");
          const metadata = parseTomlMetadata(text);
          const instructionPath = path.join(entryPath, "instruction.md");
          let instructionHash = null;
          try { instructionHash = sha256(await fs.readFile(instructionPath, "utf8")); } catch (instructionError) {
            if (instructionError.code !== "ENOENT") throw instructionError;
          }
          found.push({
            id: String(metadata.id ?? metadata.task_id ?? entry.name),
            path: entryPath,
            taskToml: manifestPath,
            taskTomlHash: sha256(text),
            instructionPath,
            instructionHash,
            metadata
          });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await visit(entryPath);
        }
      }
    }
  }
  await visit(root);
  return found.sort((left, right) => left.id.localeCompare(right.id));
}

export function selectDeepSWETasks(tasks, { limit = null, sampleSeed = DEFAULT_DEEPSWE_SAMPLE_SEED } = {}) {
  const ordered = [...tasks].sort((left, right) => {
    const leftRank = sha256(`${sampleSeed}:${left.id}`);
    const rightRank = sha256(`${sampleSeed}:${right.id}`);
    return leftRank.localeCompare(rightRank) || left.id.localeCompare(right.id);
  });
  const selected = limit === null || limit === undefined ? ordered : ordered.slice(0, Math.max(0, Number(limit)));
  return selected.sort((left, right) => left.id.localeCompare(right.id));
}

function parseJsonText(value) {
  if (value && typeof value === "object") return value;
  if (!value) return null;
  try { return JSON.parse(String(value)); } catch { return null; }
}

export function parseDeepSWEResult({ exitCode = 0, signal = null, reward = null, ctrf = null, elapsedMs = null } = {}) {
  const rewardPayload = parseJsonText(reward);
  const ctrfPayload = parseJsonText(ctrf);
  const rewardValue = firstNumber(rewardPayload, ["reward", "score", "value"]);
  const passFraction = firstNumber(rewardPayload, ["pass_fraction", "passFraction", "fraction"])
    ?? firstNumber(ctrfPayload, ["pass_fraction", "passFraction"]);
  const summary = ctrfPayload?.summary ?? ctrfPayload?.results ?? {};
  const testsPassed = firstNumber(rewardPayload, ["tests_passed", "testsPassed", "passed"])
    ?? firstNumber(summary, ["passed", "tests_passed", "testsPassed"]);
  const testsTotal = firstNumber(rewardPayload, ["tests_total", "testsTotal", "total"])
    ?? firstNumber(summary, ["total", "tests_total", "testsTotal"]);
  const verifierPass = rewardPayload?.passed !== undefined
    ? Boolean(rewardPayload.passed)
    : rewardPayload?.success !== undefined
      ? Boolean(rewardPayload.success)
      : passFraction !== null
        ? passFraction >= 1
        : rewardValue !== null
          ? rewardValue >= 1
          : false;
  const processOk = exitCode === 0 && !signal;
  return {
    status: processOk && rewardPayload ? "ok" : "error",
    pass: processOk && rewardPayload ? verifierPass : null,
    scores: {
      reward: rewardValue,
      passFraction,
      verifierPass: processOk && rewardPayload ? (verifierPass ? 1 : 0) : null,
      testsPassed,
      testsTotal
    },
    metrics: { totalElapsedMs: finiteNumber(elapsedMs), processingLatencyMs: finiteNumber(elapsedMs) },
    reward: rewardPayload,
    ctrf: ctrfPayload,
    processOk
  };
}

async function findArtifact(root, basename) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.name === basename) matches.push(entryPath);
    }
  }
  await visit(root);
  return matches.sort()[0] ?? null;
}

function commandParts(command) {
  if (Array.isArray(command)) return { command: command[0], args: command.slice(1) };
  return { command: String(command || DEFAULT_DEEPSWE_PIER_COMMAND), args: [] };
}

export function executePierTask({
  task,
  model,
  agent = DEFAULT_DEEPSWE_AGENT,
  pierCommand = DEFAULT_DEEPSWE_PIER_COMMAND,
  pierArgs = [],
  cwd,
  env = {},
  timeoutMs = Number(process.env.PYA_DEEPSWE_TIMEOUT_MS || 3600000),
  spawnImpl = spawn
} = {}) {
  if (!task?.path) throw new Error("DeepSWE task path is required");
  const parts = commandParts(pierCommand);
  const args = [...parts.args, ...pierArgs, "run", "-p", task.path, "--agent", agent, "--model", model];
  return new Promise(resolve => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawnImpl(parts.command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, Math.max(1, Number(timeoutMs) || 3600000));
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, stdout, stderr, error: error.message, elapsedMs: Date.now() - startedAt });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

async function writeLogFiles(directory, execution) {
  await fs.mkdir(directory, { recursive: true });
  const stdoutPath = path.join(directory, "pier.stdout.log");
  const stderrPath = path.join(directory, "pier.stderr.log");
  await fs.writeFile(stdoutPath, String(execution.stdout ?? ""), "utf8");
  await fs.writeFile(stderrPath, String(execution.stderr ?? ""), "utf8");
  return { stdoutPath, stderrPath };
}

async function readJsonFile(filepath) {
  if (!filepath) return null;
  try { return JSON.parse(await fs.readFile(filepath, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function aggregateDeepSWERows(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const values = key => successful.map(row => Number(row.scores?.[key])).filter(Number.isFinite);
  const average = key => {
    const numbers = values(key);
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  };
  const latencies = successful.map(row => Number(row.metrics?.totalElapsedMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = fraction => {
    if (!latencies.length) return null;
    return latencies[Math.min(latencies.length - 1, Math.round((latencies.length - 1) * fraction))];
  };
  return {
    sampleCount: rows.length,
    successfulCount: successful.length,
    failureCount: rows.filter(row => row.status === "error").length,
    passedCount: successful.filter(row => row.pass === true).length,
    passRate: successful.length ? successful.filter(row => row.pass === true).length / successful.length : null,
    reward: average("reward"),
    passFraction: average("passFraction"),
    verifierPass: average("verifierPass"),
    testsPassed: average("testsPassed"),
    testsTotal: average("testsTotal"),
    averageLatencyMs: averageMetric(latencies),
    medianLatencyMs: percentile(0.5),
    p95LatencyMs: percentile(0.95)
  };
}

function averageMetric(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rowKey(model, taskId) { return `${model}\u0000${taskId}`; }

async function loadRows(filepath) {
  try {
    return (await fs.readFile(filepath, "utf8")).split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function runDeepSWE({
  tasksPath,
  models = [process.env.PYA_DEEPSWE_MODEL ?? DEFAULT_DEEPSWE_MODEL],
  agent = process.env.PYA_DEEPSWE_AGENT ?? DEFAULT_DEEPSWE_AGENT,
  pierCommand = process.env.PYA_DEEPSWE_PIER_COMMAND ?? DEFAULT_DEEPSWE_PIER_COMMAND,
  pierArgs = [],
  sampleSeed = Number(process.env.PYA_DEEPSWE_SAMPLE_SEED ?? DEFAULT_DEEPSWE_SAMPLE_SEED),
  limit = null,
  runId = null,
  root = process.cwd(),
  resume = false,
  modelEndpoint = process.env.PYA_DEEPSWE_MODEL_ENDPOINT ?? process.env.OPENAI_BASE_URL ?? null,
  apiKey = process.env.PYA_DEEPSWE_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.STRATA_API_KEY ?? null,
  timeoutMs = Number(process.env.PYA_DEEPSWE_TIMEOUT_MS || 3600000),
  machine,
  runTask = executePierTask,
  now = () => new Date()
} = {}) {
  if (!tasksPath) throw new Error("DeepSWE requires a local tasks path");
  const allTasks = await discoverDeepSWETasks(tasksPath);
  const tasks = selectDeepSWETasks(allTasks, { limit, sampleSeed });
  if (!tasks.length) throw new Error(`DeepSWE has no task.toml files under ${tasksPath}`);
  const resolvedModels = [...new Set((Array.isArray(models) ? models : [models]).map(String).filter(Boolean))];
  if (!resolvedModels.length) throw new Error("DeepSWE requires at least one model");
  const id = String(runId ?? `deep-swe-${now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${sha256(`${tasksPath}:${sampleSeed}`).slice(0, 8)}`);
  const outputJsonl = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const prior = resume ? await loadRows(outputJsonl) : [];
  const results = [...prior];
  const complete = new Set(prior.filter(row => row.status === "ok" || row.status === "skipped").map(row => rowKey(row.model, row.sampleId)));
  const startedAt = now().toISOString();
  const artifactRoot = path.resolve(root, "criterion", "results", id, "deepswe");
  const persist = async () => {
    await fs.mkdir(path.dirname(outputJsonl), { recursive: true });
    await fs.writeFile(outputJsonl, `${results.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
  };
  const modelMetadata = Object.fromEntries(resolvedModels.map(model => [model, {
    model,
    engine: "pier",
    runtime: "deepswe",
    agent,
    modelEndpoint: modelEndpoint ?? null
  }]));
  for (const model of resolvedModels) {
    for (const task of tasks) {
      const key = rowKey(model, task.id);
      if (complete.has(key)) continue;
      const taskRoot = path.join(artifactRoot, model.replace(/[^A-Za-z0-9._-]+/gu, "_"), task.id.replace(/[^A-Za-z0-9._-]+/gu, "_"));
      const taskStartedAt = now().toISOString();
      let execution;
      try {
        execution = await runTask({
          task,
          model,
          agent,
          pierCommand,
          pierArgs,
          cwd: taskRoot,
          timeoutMs,
          env: {
            ...(modelEndpoint ? { OPENAI_BASE_URL: modelEndpoint } : {}),
            ...(apiKey ? { OPENAI_API_KEY: apiKey } : {})
          }
        });
      } catch (error) {
        execution = { exitCode: null, signal: null, stdout: "", stderr: "", error: error.message, elapsedMs: null };
      }
      const logs = await writeLogFiles(taskRoot, execution);
      const rewardPath = execution.rewardPath ?? await findArtifact(taskRoot, "reward.json");
      const ctrfPath = execution.ctrfPath ?? await findArtifact(taskRoot, "ctrf.json");
      const reward = execution.reward ?? await readJsonFile(rewardPath);
      const ctrf = execution.ctrf ?? await readJsonFile(ctrfPath);
      const parsed = parseDeepSWEResult({ ...execution, reward, ctrf });
      const row = {
        runId: id,
        benchmark: "deep-swe",
        model,
        engine: "pier",
        profile: "deepswe",
        sampleId: task.id,
        status: parsed.status,
        pass: parsed.pass,
        output: "",
        outputHash: sha256(""),
        inputHash: sha256(`${task.taskTomlHash}:${task.instructionHash ?? ""}`),
        promptHash: task.instructionHash ?? task.taskTomlHash,
        inputTokens: null,
        metrics: parsed.metrics,
        scores: parsed.scores,
        reward: parsed.reward,
        verifier: parsed.ctrf,
        modelMetadata: modelMetadata[model],
        metadata: {
          taskPath: task.path,
          taskToml: task.taskToml,
          taskTomlHash: task.taskTomlHash,
          instructionPath: task.instructionPath,
          instructionHash: task.instructionHash,
          language: task.metadata?.language ?? null,
          repository: task.metadata?.repo ?? task.metadata?.repository ?? null,
          baseCommit: task.metadata?.base_commit ?? task.metadata?.baseCommit ?? null,
          agent,
          pierCommand: Array.isArray(pierCommand) ? pierCommand : [pierCommand, ...pierArgs],
          rewardPath,
          ctrfPath,
          stdoutPath: logs.stdoutPath,
          stderrPath: logs.stderrPath,
          processExitCode: execution.exitCode,
          processSignal: execution.signal,
          timedOut: Boolean(execution.timedOut)
        },
        provenance: {
          benchmark: "deep-swe",
          benchmarkSource: DEEPSWE_CATALOG.sourceUrl,
          datasetHash: sha256(stableJson(tasks.map(item => ({ id: item.id, taskTomlHash: item.taskTomlHash, instructionHash: item.instructionHash })))),
          sampleId: task.id,
          sampleSelectionSeed: sampleSeed,
          model,
          agent,
          taskTomlHash: task.taskTomlHash,
          instructionHash: task.instructionHash,
          modelEndpoint: modelEndpoint ?? null
        },
        startedAt: taskStartedAt,
        finishedAt: now().toISOString(),
        ...(parsed.status === "error" ? { error: execution.error ?? (execution.timedOut ? "DeepSWE task timed out" : "DeepSWE verifier result unavailable") } : {})
      };
      const priorIndex = results.findIndex(candidate => rowKey(candidate.model, candidate.sampleId) === key);
      if (priorIndex >= 0) results.splice(priorIndex, 1);
      results.push(row);
      if (row.status === "ok") complete.add(key);
      await persist();
    }
  }
  const finishedAt = now().toISOString();
  const aggregates = resolvedModels.map(model => ({
    model,
    modelMetadata: modelMetadata[model],
    aggregate: aggregateDeepSWERows(results.filter(row => row.model === model))
  }));
  const finalRun = await writeRunArtifacts({
    runId: id,
    criterion: "deep-swe",
    suite: { ...DEEPSWE_CATALOG, key: "deep-swe", sourceUrls: [DEEPSWE_CATALOG.sourceUrl, DEEPSWE_CATALOG.taskFormatUrl], licenseUrls: [DEEPSWE_CATALOG.licenseUrl] },
    status: results.some(row => row.status === "error") ? "partial" : "completed",
    split: "task-corpus",
    actualSplit: "task-corpus",
    datasetRevision: "local-task-corpus",
    datasetHash: sha256(stableJson(tasks.map(task => ({ id: task.id, taskTomlHash: task.taskTomlHash, instructionHash: task.instructionHash })))),
    models: resolvedModels,
    engine: "pier",
    profile: "deepswe",
    contextLength: null,
    sampling: { agent, sampleSeed },
    machine: machine ?? await collectMachineMetadata(),
    mode: "criterion",
    smoke: limit !== null && Number(limit) < allTasks.length,
    runScope: limit !== null && Number(limit) < allTasks.length ? "smoke" : "full",
    createdAt: startedAt,
    startedAt,
    finishedAt,
    totalWallClockMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    datasetPath: path.resolve(tasksPath),
    fixtureRoot: null,
    replayCommand: `node command/criterion.mjs deepswe --tasks ${path.resolve(tasksPath)} --agent ${agent} --model ${resolvedModels.join(",")} --sample-seed ${sampleSeed} --run-id ${id} --resume`,
    results,
    aggregates,
    modelMetadata,
    selectedTaskIds: tasks.map(task => task.id),
    sampleSelectionSeed: sampleSeed,
    pier: { command: pierCommand, agent, modelEndpoint: modelEndpoint ?? null, timeoutMs }
  }, { root });
  return finalRun;
}

export { aggregateDeepSWERows, findArtifact };
