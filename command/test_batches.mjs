import fs from "node:fs";
import { availableParallelism, freemem } from "node:os";
import { spawn } from "node:child_process";

export const MAX_TEST_BATCH_COUNT = 3;
export const TEST_WORKER_MEMORY_BUDGET_BYTES = 2 * 1024 ** 3;
export const TEST_HOST_MEMORY_RESERVE_BYTES = 2 * 1024 ** 3;

function availableMemoryBytes() {
  try {
    const memoryInfo = fs.readFileSync("/proc/meminfo", "utf8");
    const availableKiB = Number(memoryInfo.match(/^MemAvailable:\s+(\d+)\s+kB$/mu)?.[1]);
    if (Number.isFinite(availableKiB)) {
      let available = availableKiB * 1024;
      for (const [limitPath, currentPath] of [
        ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"],
        ["/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]
      ]) {
        try {
          const limitText = fs.readFileSync(limitPath, "utf8").trim();
          if (limitText === "max") continue;
          const limit = Number(limitText);
          const current = Number(fs.readFileSync(currentPath, "utf8").trim());
          if (Number.isSafeInteger(limit) && Number.isSafeInteger(current) && limit > current) {
            available = Math.min(available, limit - current);
          }
          break;
        } catch {
          // Try the other cgroup layout, then use host-available memory.
        }
      }
      return available;
    }
  } catch {
    // Use the portable OS memory estimate below.
  }
  return freemem();
}

export function recommendedTestConcurrency({
  cpuCount = availableParallelism(),
  memoryBytes = availableMemoryBytes()
} = {}) {
  if (!Number.isSafeInteger(cpuCount) || cpuCount < 1) {
    throw new RangeError("available test CPU count must be a positive safe integer");
  }
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 0) {
    throw new RangeError("available test memory must be a non-negative safe integer");
  }

  const cpuLimit = Math.max(1, cpuCount - 1);
  const memoryLimit = Math.max(1, Math.floor(
    (memoryBytes - TEST_HOST_MEMORY_RESERVE_BYTES) / TEST_WORKER_MEMORY_BUDGET_BYTES
  ));
  return Math.min(cpuLimit, memoryLimit);
}

export const DEFAULT_TEST_CONCURRENCY = recommendedTestConcurrency();

export function batchItems(items, batchSize) {
  if (!Array.isArray(items)) throw new TypeError("test batch items must be an array");
  const selectedBatchSize = batchSize === undefined
    ? Math.max(1, Math.ceil(items.length / MAX_TEST_BATCH_COUNT))
    : batchSize;
  if (!Number.isSafeInteger(selectedBatchSize) || selectedBatchSize < 1) {
    throw new RangeError("test batch size must be a positive safe integer");
  }

  const batches = [];
  for (let offset = 0; offset < items.length; offset += selectedBatchSize) {
    batches.push(items.slice(offset, offset + selectedBatchSize));
  }
  return batches;
}

export async function runNodeTestBatches(files, {
  cwd,
  env = process.env,
  label = "tests",
  batchSize,
  concurrency = DEFAULT_TEST_CONCURRENCY,
  nodeArgs = []
} = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("test concurrency must be a positive safe integer");
  }
  const batches = batchItems(files, batchSize);

  for (const [index, batch] of batches.entries()) {
    console.log(`[${label}] batch ${index + 1}/${batches.length}: ${batch.length} test files`);
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [
        "--test",
        `--test-concurrency=${concurrency}`,
        ...nodeArgs,
        ...batch
      ], { cwd, stdio: "inherit", env });

      child.once("error", (error) => resolve({ error }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    if (result.error) {
      console.error(result.error);
      return { code: 1, signal: null };
    }
    if (result.signal || result.code !== 0) {
      return { code: result.code, signal: result.signal };
    }
  }

  return { code: 0, signal: null };
}
