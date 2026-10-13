import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "command/strata_prepare_gpu.py");

async function withManagerResponse(response, run) {
  let requestBody = "";
  const server = createServer((request, result) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/capacity/prepare");
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      result.writeHead(response.status, { "content-type": "application/json" });
      result.end(JSON.stringify(response.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run({ port, getRequestBody: () => requestBody });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Strata pre-load hook asks GPU Housekeeper for a 20GB managed handoff", async () => {
  await withManagerResponse({
    status: 200,
    body: { prepared: true, deviceId: "gpu0", capacity: { decision: "reclaimed", discharged: ["ollama"] } }
  }, async ({ port, getRequestBody }) => {
    const { stdout } = await execFileAsync("python3", [hook, "20000"], {
      cwd: root,
      env: { ...process.env, PYASH_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${port}` }
    });
    assert.match(stdout, /decision=reclaimed; discharged=ollama/);
    assert.deepEqual(JSON.parse(getRequestBody()), {
      runtimeName: "strata",
      jobSpec: { resourceRequest: { vramRequiredMb: 20000 } }
    });
  });
});

test("Strata pre-load hook fails visibly when manager refuses capacity", async () => {
  await withManagerResponse({
    status: 409,
    body: { prepared: false, busy: true, error: "GPU Housekeeper has active managed GPU work" }
  }, async ({ port }) => {
    await assert.rejects(
      execFileAsync("python3", [hook, "20000"], {
        cwd: root,
        env: { ...process.env, PYASH_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${port}` }
      }),
      (error) => {
        assert.match(error.stderr, /strata GPU preparation refused: GPU Housekeeper has active managed GPU work/);
        return true;
      }
    );
  });
});

test("Strata startup retries only a post-discharge telemetry lag and launches only after admission", async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    request.resume();
    request.on("end", () => {
      if (calls === 1) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({
          prepared: false,
          error: "GPU capacity remains insufficient after safe managed-runtime discharge"
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        prepared: true,
        deviceId: "gpu0",
        capacity: { decision: "fits", discharged: [] }
      }));
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const { port } = server.address();
  try {
    const { stdout, stderr } = await execFileAsync("python3", [
      hook,
      "20000",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('strata-started')"
    ], {
      cwd: root,
      env: { ...process.env, PYASH_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${port}` }
    });
    assert.equal(calls, 2);
    assert.match(stderr, /VRAM release is settling; retrying Housekeeper admission/);
    assert.match(stdout, /decision=fits; discharged=none/);
    assert.match(stdout, /strata-started/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
