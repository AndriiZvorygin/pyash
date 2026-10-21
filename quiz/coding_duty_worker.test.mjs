import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { processDutyAssignment, resolveDutyWorkerConfig, runDutyWorker } from "../command/pyash_duty_worker.mjs";

test("duty worker requires secure hub configuration and a repository allowlist", () => {
  assert.throws(() => resolveDutyWorkerConfig({}), /PYA_DUTY_HUB_URL/u);
  assert.throws(() => resolveDutyWorkerConfig({
    PYA_DUTY_HUB_URL: "http://remote.example",
    PYA_DUTY_WORKER_TOKEN: "secret",
    PYA_DUTY_REPOSITORIES: "pyash=/srv/pyash"
  }), /HTTPS/u);
  const config = resolveDutyWorkerConfig({
    PYA_DUTY_HUB_URL: "https://pyash.example",
    PYA_DUTY_WORKER_TOKEN: "secret",
    PYA_DUTY_REPOSITORIES: "pyash=/srv/pyash",
    PYA_DUTY_STATE_ROOT: "/var/lib/pyash-duty",
    PYA_DUTY_WORKER_HOSTNAME: "zvorygin",
    USER: "htaf",
    PYA_DUTY_HOME_ACCESS: "yes"
  });
  assert.equal(config.workerId, "zvorygin-htaf");
  assert.equal(config.label, "zvorygin (htaf)");
  assert.equal(config.homeAccess, true);
  assert.equal(config.repositories[0].id, "pyash");
  assert.equal(config.stateRoot, "/var/lib/pyash-duty");
});

test("worker advertises configured directories and claims through the hub only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-duty-worker-"));
  let stopping = false;
  const calls = [];
  try {
    const config = resolveDutyWorkerConfig({
      PYA_DUTY_HUB_URL: "https://pyash.example",
      PYA_DUTY_WORKER_ID: "worker-a",
      PYA_DUTY_WORKER_TOKEN: "secret",
      PYA_DUTY_REPOSITORIES: `checkout=${root}`,
      PYA_DUTY_STATE_ROOT: path.join(root, "state")
    });
    await runDutyWorker({
      config,
      fetchFn: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ ok: true, assignment: null }), { status: 200 });
      },
      shouldStop: () => stopping,
      sleepFn: async () => { stopping = true; },
      log: () => {}
    });
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      "/api/duty-workers/heartbeat",
      "/api/duty-workers/claim"
    ]);
    assert.equal(calls[0].options.headers.authorization, "Bearer secret");
    assert.equal(calls[0].body.repositories[0].id, "checkout");
    assert.equal(calls[1].body.workerId, "worker-a");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("worker resumes the assigned duty session and returns its result to the hub", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-duty-turn-"));
  const stateRoot = path.join(root, "state");
  const repositoryRoot = path.join(root, "checkout");
  const sessionRoot = path.join(stateRoot, "world", "house", "coding-saddle", "session");
  const sessionFile = path.join(sessionRoot, "duty-test.pya");
  const sent = [];
  try {
    await fs.mkdir(repositoryRoot, { recursive: true });
    const config = {
      hubUrl: "https://pyash.example",
      workerId: "node-a",
      token: "secret",
      stateRoot
    };
    const assignment = {
      duty: {
        id: "duty-test",
        sessionName: "duty-test",
        repositoryId: "checkout",
        model: "qwen3.5:9b",
        backend: "ollama",
        host: "http://ollama.test"
      },
      message: { id: "message-1", text: "Inspect the existing project." },
      claimId: "claim-1",
      sessionText: "existing Pyash session\n"
    };
    await processDutyAssignment(config, [{ id: "checkout", root: repositoryRoot }], assignment, {
      prepareFn: async (options) => {
        assert.equal(options.cwd, repositoryRoot);
        assert.equal(options.worldRoot, path.join(stateRoot, "world"));
      },
      mindFn: async (sentence, options) => {
        assert.equal(options.sessionUserMetadata.payloadId, "message-1");
        await fs.appendFile(sentence.fromtext.filename, "worker turn recorded\n", "utf8");
        return { ob: { text: "The project is ready for inspection." } };
      },
      fetchFn: async (url, options) => {
        sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      log: () => {}
    });
    assert.equal(sent.length, 1);
    assert.equal(new URL(sent[0].url).pathname, "/api/duty-workers/result");
    assert.equal(sent[0].headers.authorization, "Bearer secret");
    assert.equal(sent[0].body.text, "The project is ready for inspection.");
    assert.match(sent[0].body.sessionText, /worker turn recorded/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("home scope requires explicit worker configuration and runs from the account home", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-duty-home-"));
  const stateRoot = path.join(root, "state");
  const repositoryRoot = path.join(root, "checkout");
  const assignment = {
    duty: {
      id: "duty-home",
      sessionName: "duty-home",
      repositoryId: "checkout",
      permissionScope: "home",
      model: "qwen3.5:9b",
      backend: "ollama",
      host: "http://ollama.test"
    },
    message: { id: "message-home", text: "Inspect my home files." },
    claimId: "claim-home",
    sessionText: "existing session\n"
  };
  try {
    await fs.mkdir(repositoryRoot, { recursive: true });
    let modelCalls = 0;
    await assert.rejects(() => processDutyAssignment({
      hubUrl: "https://pyash.example", workerId: "host-user", token: "secret", stateRoot, homeAccess: false
    }, [{ id: "checkout", root: repositoryRoot }], assignment, {
      prepareFn: async () => { modelCalls += 1; }
    }), /not configured/u);
    assert.equal(modelCalls, 0);

    let preparedCwd = "";
    await processDutyAssignment({
      hubUrl: "https://pyash.example", workerId: "host-user", token: "secret", stateRoot, homeAccess: true
    }, [{ id: "checkout", root: repositoryRoot }], assignment, {
      prepareFn: async ({ cwd }) => { preparedCwd = cwd; },
      mindFn: async (sentence) => {
        await fs.appendFile(sentence.fromtext.filename, "turn\n", "utf8");
        return { ob: { text: "Done." } };
      },
      fetchFn: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      log: () => {}
    });
    assert.equal(preparedCwd, os.homedir());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
