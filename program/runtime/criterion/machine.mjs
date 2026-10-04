import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function readGpu() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 3000, maxBuffer: 16 * 1024 });
    return stdout.trim().split(/\r?\n/u).filter(Boolean).join("; ") || null;
  } catch { return null; }
}

export async function collectMachineMetadata({ gpuReader = readGpu } = {}) {
  return {
    hostname: os.hostname(),
    platform: `${process.platform}-${process.arch}`,
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    ramBytes: os.totalmem(),
    gpu: await gpuReader()
  };
}
