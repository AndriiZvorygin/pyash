import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GPU_CONTAINER = "pyac-vliw-runtime";
const GPU_FILES = [
  ["gpu runtime executable", "/service/pyac-vliw-runtime"],
  ["gpu worker executable", "/service/pyac-vliw-gpu-worker"],
  ["spirv shader", "/service/pyac_vliw_gpu_kernel.spv"],
  ["gpu pipeline cache", "/service/artifacts/pyac_vliw_pipeline_cache.bin"]
];

function run(command, args, { cwd, includeStderr = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) return "";
  return [result.stdout, ...(includeStderr ? [result.stderr] : [])]
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function fileMetrics(filePath) {
  try {
    const bytes = await fs.readFile(filePath);
    return {
      path: filePath,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch {
    return { path: filePath, unavailable: true };
  }
}

function pipelineTimings(logText) {
  const values = {};
  const patterns = [
    ["pack", /pack pipeline ready in ([\d.]+)s/u],
    ["programlet", /programlet pipeline ready in ([\d.]+)s/u],
    ["sections", /sections pipeline ready in ([\d.]+)s/u]
  ];
  for (const [name, pattern] of patterns) {
    const match = String(logText).match(pattern);
    if (match) values[name] = Number(match[1]);
  }
  const initialized = String(logText).match(/full initialization ([\d.]+)s/u)
    ?? String(logText).match(/runtime initialized on .+ in ([\d.]+)s/u);
  return {
    scope: String(logText).includes("wrote compiled GPU pipeline artifact")
      ? "pipeline-cache-generation"
      : "runtime-cache-load",
    perPipelineSeconds: values,
    ...(initialized ? { fullInitializationSeconds: Number(initialized[1]) } : {})
  };
}

async function collectGpuArtifacts(root) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vliw-metrics-"));
  const artifacts = {};
  try {
    for (const [name, filePath] of GPU_FILES) {
      const copiedPath = path.join(temporaryDirectory, path.basename(filePath));
      const copy = spawnSync("docker", ["cp", `${GPU_CONTAINER}:${filePath}`, copiedPath], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024
      });
      artifacts[name] = copy.error || copy.status !== 0
        ? { path: filePath, unavailable: true }
        : await fileMetrics(copiedPath);
      artifacts[name].path = filePath;
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  const artifactDirectory = process.env.PYAC_VLIW_ARTIFACT_DIR
    || path.join(os.homedir(), ".local/share/pyash/pyac-vliw");
  artifacts["host pipeline cache"] = await fileMetrics(path.join(artifactDirectory, "pyac_vliw_pipeline_cache.bin"));

  const buildLog = await fs.readFile(path.join(artifactDirectory, "pipeline-cache-build.log"), "utf8").catch(() => "");
  const runtimeLog = run("docker", ["logs", "--tail", "300", GPU_CONTAINER], { cwd: root, includeStderr: true });
  const pipelineLog = buildLog || runtimeLog;
  return {
    artifacts,
    pipeline: pipelineTimings(pipelineLog),
    pipelineBuildLogAvailable: Boolean(buildLog),
    imageId: run("docker", ["inspect", "--format", "{{.Image}}", GPU_CONTAINER], { cwd: root }) || "",
    containerStartedAt: run("docker", ["inspect", "--format", "{{.State.StartedAt}}", GPU_CONTAINER], { cwd: root }) || ""
  };
}

export async function collectVliwConformanceEnvironment(root) {
  const targetDirectory = process.env.CARGO_TARGET_DIR
    ? path.resolve(root, process.env.CARGO_TARGET_DIR)
    : path.join(root, "rust/pyac/target");
  const cpuExecutable = await fileMetrics(path.join(targetDirectory, "debug/examples/vliw_reference"));
  const gpu = await collectGpuArtifacts(root);
  const gpuInfo = run("nvidia-smi", ["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"], { cwd: root });
  const patch = spawnSync("git", ["diff", "--binary", "HEAD"], {
    cwd: root,
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024
  });
  const workingTree = run("git", ["status", "--porcelain"], { cwd: root });
  return {
    hostname: os.hostname(),
    sourceRevision: run("git", ["rev-parse", "HEAD"], { cwd: root }),
    workingTreeState: workingTree ? "dirty" : "clean",
    trackedPatchSha256: !patch.error && patch.status === 0
      ? createHash("sha256").update(patch.stdout).digest("hex")
      : "",
    cpuExecutable,
    gpu,
    ...(gpuInfo ? { gpuInfo } : {})
  };
}

function textFact(name, value) {
  if (value === undefined || value === null || value === "") return "";
  return `exists su name ${name} ob text ${JSON.stringify(String(value))} be text ya`;
}

function numberFact(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `exists su name ${name} ob num ${value} be number ya`;
}

function artifactFacts(name, artifact) {
  if (!artifact) return [];
  return [
    textFact(`${name} path`, artifact.path),
    numberFact(`${name} bytes`, artifact.sizeBytes),
    textFact(`${name} sha256`, artifact.sha256),
    ...(artifact.unavailable ? [textFact(`${name} status`, "unavailable")] : [])
  ].filter(Boolean);
}

function requestFacts(prefix, requests = []) {
  const runtimeTimingNames = new Map([
    ["requestDecodeMs", "service request decode ms"],
    ["workerSlotWaitMs", "service worker slot wait ms"],
    ["gpuLockWaitMs", "service gpu lock wait ms"],
    ["packDecodeMs", "runtime pack decode ms"],
    ["classifyMs", "runtime classify ms"],
    ["bufferSetupMs", "runtime buffer setup ms"],
    ["commandEncodeMs", "runtime command encode ms"],
    ["submitWaitReadbackMs", "runtime submit wait readback ms"],
    ["kernelGpuMs", "runtime kernel gpu ms"],
    ["resultDecodeMs", "runtime result decode ms"],
    ["totalMs", "runtime total ms"],
    ["serviceTotalMs", "service total ms"]
  ]);
  return requests.flatMap((request, index) => {
    const label = `${prefix} request ${String(index + 1).padStart(2, "0")}`;
    const runtimeTimingFacts = [...runtimeTimingNames].map(([key, name]) =>
      numberFact(`${label} ${name}`, request.housekeeper?.runtimeTimingMs?.[key])
    );
    return [
      textFact(`${label} name`, request.name),
      textFact(`${label} phase`, request.phase),
      numberFact(`${label} wall ms`, request.elapsedMs),
      numberFact(`${label} pack bytes`, request.packBytes),
      numberFact(`${label} case count`, request.caseCount),
      ...(request.housekeeper ? [
        textFact(`${label} queue handle`, request.housekeeper.handleId),
        textFact(`${label} remote job id`, request.housekeeper.remoteJobId),
        textFact(`${label} queued at`, request.housekeeper.queuedAt),
        textFact(`${label} worker started at`, request.housekeeper.workerStartedAt),
        textFact(`${label} worker finished at`, request.housekeeper.workerFinishedAt),
        textFact(`${label} Housekeeper submitted at`, request.housekeeper.remoteSubmittedAt),
        textFact(`${label} Housekeeper started at`, request.housekeeper.remoteStartedAt),
        textFact(`${label} Housekeeper finished at`, request.housekeeper.remoteFinishedAt),
        numberFact(`${label} local queue wait ms`, request.housekeeper.localQueueWaitMs),
        numberFact(`${label} worker wall ms`, request.housekeeper.workerWallMs),
        numberFact(`${label} Housekeeper queue wait ms`, request.housekeeper.housekeeperQueueWaitMs),
        numberFact(`${label} Housekeeper active ms`, request.housekeeper.housekeeperActiveMs),
        numberFact(`${label} client round trip ms`, request.housekeeper.clientRoundTripMs),
        textFact(`${label} runtime kernel timing source`, request.housekeeper.runtimeTimingMs?.kernelTimingSource),
        ...runtimeTimingFacts
      ] : [])
    ].filter(Boolean);
  });
}

export function renderVliwConformancePya(report) {
  const environment = report.environment ?? {};
  const gpu = environment.gpu ?? {};
  const lines = [
    textFact("run id", report.runId),
    textFact("status", report.status),
    textFact("started at", report.startedAt),
    textFact("finished at", report.finishedAt),
    numberFact("total wall ms", report.totalWallMs),
    textFact("hostname", environment.hostname),
    textFact("source revision", environment.sourceRevision),
    textFact("working tree state", environment.workingTreeState),
    textFact("tracked patch sha256", environment.trackedPatchSha256),
    textFact("gpu info", environment.gpuInfo),
    textFact("gpu image id", gpu.imageId),
    textFact("gpu container started at", gpu.containerStartedAt),
    textFact("pipeline timing scope", gpu.pipeline?.scope),
    numberFact("pipeline full initialization seconds", gpu.pipeline?.fullInitializationSeconds),
    textFact("failure", report.failure)
  ];
  lines.push(...artifactFacts("cpu executable", environment.cpuExecutable));
  for (const [name, artifact] of Object.entries(gpu.artifacts ?? {})) {
    lines.push(...artifactFacts(name, artifact));
  }
  for (const [name, seconds] of Object.entries(gpu.pipeline?.perPipelineSeconds ?? {})) {
    lines.push(numberFact(`pipeline ${name} seconds`, seconds));
  }
  lines.push(...requestFacts("cpu", report.cpuRequests));
  lines.push(...requestFacts("gpu", report.gpuRequests));
  for (const [index, name] of (report.passedCases ?? []).entries()) {
    lines.push(textFact(`passed case ${String(index + 1).padStart(2, "0")}`, name));
  }
  for (const [index, item] of (report.expectedErrors ?? []).entries()) {
    lines.push(textFact(`expected error ${String(index + 1).padStart(2, "0")} name`, item.name));
    lines.push(numberFact(`expected error ${String(index + 1).padStart(2, "0")} code`, item.errorCode));
  }
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export async function writeVliwConformancePya(root, report, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const baseDirectory = path.join(root, "artifacts");
  await fs.mkdir(baseDirectory, { recursive: true });
  let directory = "";
  for (let sequence = 1; sequence <= 9999; sequence += 1) {
    const candidate = path.join(baseDirectory, `${date}-${String(sequence).padStart(4, "0")}-rust-vliw-conformance`);
    try {
      await fs.mkdir(candidate);
      directory = candidate;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  if (!directory) throw new Error(`could not allocate VLIW conformance artifact directory for ${date}`);
  report.runId ||= path.basename(directory).replace(/-rust-vliw-conformance$/u, "");
  const reportPath = path.join(directory, "result.pya");
  await fs.writeFile(reportPath, renderVliwConformancePya(report), { encoding: "utf8", flag: "wx" });
  return reportPath;
}
