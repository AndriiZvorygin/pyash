import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import gpu from "../program/verbs/gpu.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { runGpuWorkerOnce } from "../program/runtime/gpu/worker.mjs";
import { readGpuHandleStatus } from "../program/runtime/gpu/handle_status.mjs";

async function run(line) {
  return gpu(parse(line));
}

function setWorldRoot(worldRoot) {
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    ob: { filename: worldRoot },
    be: "root"
  });
}

test("gpu mind status and await follow durable duty lifecycle through worker", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  const queued = await run('su name gpu handle one ob text "teach fractions briefly" to name llama3.2 vyah start future be gpu mind do');
  assert.equal(queued?.be, "duty");
  assert.deepEqual(queued?.vyah?.ve?.values, ["start", "success"]);
  assert.equal(queued?.ob?.text, "queued");
  assert.equal(queued?.fromstate?.text, "durable");

  const queuedStatus = await run('accordingto text "gpu handle one" vyah status be gpu do');
  assert.equal(queuedStatus?.be, "duty");
  assert.equal(queuedStatus?.ob?.text, "queued");
  assert.equal(queuedStatus?.totext?.text, "durable");

  const submitted = [];
  await runGpuWorkerOnce({
    worldRoot,
    adapter: {
      async submitJob(job) {
        submitted.push(job);
        return { remoteJobId: "remote-1" };
      },
      async getJobStatus() {
        return {
          status: "success",
          message: "ollama ok",
          result: { response: "Fractions are equal parts." },
          finishedAt: new Date().toISOString()
        };
      }
    },
    maxPolls: 2
  });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.runtimeName, "ollama");
  assert.equal(submitted[0]?.profileName, "llama3.2");
  assert.equal(submitted[0]?.jobSpec?.kind, "ollama-generate");
  assert.equal(submitted[0]?.jobSpec?.prompt, "teach fractions briefly");

  const state = await readGpuHandleStatus(worldRoot, "gpu handle one");
  assert.equal(state?.status, "success");
  assert.equal(state?.message, "ollama ok");
  assert.match(state?.result, /Fractions are equal parts\./);

  const awaited = await run('accordingto text "gpu handle one" during num 2000 vyah await be gpu do');
  assert.deepEqual(awaited?.vyah?.ve?.values, ["await", "success"]);
  assert.equal(awaited?.ob?.text, "success");
  assert.equal(awaited?.fromstate?.text, "ollama ok");
  assert.match(awaited?.result?.text, /Fractions are equal parts\./);
});


test("gpu draw accepts explicit ComfyUI job spec and submits through worker", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-draw-handle-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  const spec = JSON.stringify({
    kind: "comfyui-draw",
    profileName: "teaching-draw",
    prompt: { "1": { inputs: { text: "one clean classroom illustration" } } }
  });
  await run(`su name gpu draw handle ob text ${JSON.stringify(spec)} vyah start future be gpu draw do`);

  const submitted = [];
  await runGpuWorkerOnce({
    worldRoot,
    adapter: {
      async submitJob(job) {
        submitted.push(job);
        return { remoteJobId: "remote-draw-1" };
      },
      async getJobStatus() {
        return {
          status: "success",
          message: "draw ok",
          result: { promptId: "prompt-1", history: { outputs: {} } },
          finishedAt: new Date().toISOString()
        };
      }
    },
    maxPolls: 2
  });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.runtimeName, "comfyui");
  assert.equal(submitted[0]?.profileName, "teaching-draw");
  assert.equal(submitted[0]?.jobSpec?.kind, "comfyui-draw");
  assert.equal(submitted[0]?.jobSpec?.prompt?.["1"]?.inputs?.text, "one clean classroom illustration");

  const awaited = await run('accordingto text "gpu draw handle" during num 2000 vyah await be gpu do');
  assert.deepEqual(awaited?.vyah?.ve?.values, ["await", "success"]);
  assert.equal(awaited?.ob?.text, "success");
  assert.equal(awaited?.fromstate?.text, "draw ok");
});

test("gpu await timeout includes worker startup hint", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-await-timeout-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('su name gpu handle timeout ob text "short prompt" vyah start future be gpu mind do');
  const awaited = await run('accordingto text "gpu handle timeout" during num 1000 vyah await be gpu do');
  assert.equal(awaited?.ob?.text, "queued");
  assert.match(String(awaited?.fromstate?.text ?? ""), /start gpu worker: PYA_GPU_HOUSEKEEPER_URL=/);
});
