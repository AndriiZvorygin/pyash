import test from "node:test";
import assert from "node:assert/strict";

import { comfyuiRuntimeIsBusy, managedComfyuiJobRunning } from "../program/motor/comfyui_admin_guard.mjs";
import { dischargeDrawBackend } from "../program/motor/draw_admin.mjs";
import { dischargeQwenSayBackend } from "../program/motor/say_admin.mjs";

const HOUSEKEEPER = "http://housekeeper.test:18886";

function fakeResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    }
  };
}

function queuePayload(jobs = []) {
  return { queueDepth: jobs.length, jobs };
}

test("managedComfyuiJobRunning sees a running ComfyUI job", async () => {
  const fetchImpl = async (url) => {
    assert.equal(String(url), `${HOUSEKEEPER}/queue`);
    return fakeResponse(queuePayload([
      { runtimeName: "comfyui", profileName: "audio_yue2_own_melody", status: "running" }
    ]));
  };
  assert.equal(await managedComfyuiJobRunning({ housekeeperUrl: HOUSEKEEPER, fetchImpl }), true);
});

test("managedComfyuiJobRunning ignores other runtimes and finished jobs", async () => {
  const fetchImpl = async () => fakeResponse(queuePayload([
    { runtimeName: "ollama", profileName: "qwen3.5:9b", status: "running" },
    { runtimeName: "comfyui", profileName: "audio_yue2_own_melody", status: "success" }
  ]));
  assert.equal(await managedComfyuiJobRunning({ housekeeperUrl: HOUSEKEEPER, fetchImpl }), false);
});

test("managedComfyuiJobRunning treats an unreachable housekeeper as not busy", async () => {
  const fetchImpl = async () => {
    throw new Error("connection refused");
  };
  assert.equal(await managedComfyuiJobRunning({ housekeeperUrl: HOUSEKEEPER, fetchImpl }), false);
});

test("comfyuiRuntimeIsBusy is the guard the admin modules use", async () => {
  const fetchImpl = async () => fakeResponse(queuePayload([
    { runtimeName: "comfyui", profileName: "audio_ace_step_1_5_xl_turbo", status: "running" }
  ]));
  assert.equal(await comfyuiRuntimeIsBusy({ housekeeperUrl: HOUSEKEEPER, fetchImpl }), true);
});

test("the draw discharge does not interrupt a ComfyUI that is running a job", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    calls.push({ url: String(url), method });
    if (String(url).endsWith("/queue")) return fakeResponse(queuePayload([
      { runtimeName: "comfyui", profileName: "audio_yue2_own_melody", status: "running" }
    ]));
    if (String(url).endsWith("/interrupt")) return fakeResponse({});
    throw new Error(`unexpected url ${url}`);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const originalEnv = process.env.PYA_GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_HOUSEKEEPER_URL = HOUSEKEEPER;
  try {
    const result = await dischargeDrawBackend({ rememberFn: () => null });
    assert.equal(result?.discharged, false);
    assert.match(String(result?.reason), /managed ComfyUI job/u);
    assert.equal(calls.filter((call) => call.url.endsWith("/interrupt")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = originalEnv;
  }
});

test("the qwen say discharge does not interrupt a ComfyUI that is running a job", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    calls.push({ url: String(url), method });
    if (String(url).endsWith("/queue")) return fakeResponse(queuePayload([
      { runtimeName: "comfyui", profileName: "audio_yue2_own_melody", status: "running" }
    ]));
    if (String(url).endsWith("/interrupt")) return fakeResponse({});
    throw new Error(`unexpected url ${url}`);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const originalEnv = process.env.PYA_GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_HOUSEKEEPER_URL = HOUSEKEEPER;
  try {
    const result = await dischargeQwenSayBackend({ rememberFn: () => null });
    assert.equal(result?.discharged, false);
    assert.equal(calls.filter((call) => call.url.endsWith("/interrupt")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = originalEnv;
  }
});
