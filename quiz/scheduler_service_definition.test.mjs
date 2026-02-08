import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { forget } from "../program/remember/index.mjs";
import { runScheduledJob } from "../program/agent/scheduled_jobs.mjs";

test("scheduled job can run service definition linked to module ceremony", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-service-def-"));
  const worldRoot = path.join(root, "world");
  const serviceDir = path.join(worldRoot, "conduct", "service");
  const markerPath = path.join(root, "service-marker.txt");
  await fs.mkdir(serviceDir, { recursive: true });

  await fs.writeFile(
    path.join(serviceDir, "custom_tick.pya"),
    [
      'su name runner ob text "ceremony" ya',
      'su name module ob filename "./service_tick_module.pya" ya',
      'su name ceremony ob text "service tick" ya'
    ].join("\n") + "\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(serviceDir, "service_tick_module.pya"),
    [
      "su name service tick be ceremony def",
      `ob text "done" to filename "${markerPath}" be write do`,
      "su name service tick be ceremony prah"
    ].join("\n") + "\n",
    "utf8"
  );

  forget();
  const result = await runScheduledJob({
    worldRoot,
    job: {
      jobName: "custom tick",
      agentName: "helper",
      laneName: "custom_tick",
      withCase: { wo: "tools" },
      prompt: ""
    }
  });
  assert.equal(result?.status, "service:ok");
  assert.equal((await fs.readFile(markerPath, "utf8")).trim(), "done");
});

test("service definition without run linkage is skipped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-service-def-missing-"));
  const worldRoot = path.join(root, "world");
  const serviceDir = path.join(worldRoot, "conduct", "service");
  await fs.mkdir(serviceDir, { recursive: true });
  await fs.writeFile(
    path.join(serviceDir, "custom_tick.pya"),
    'su name module ob filename "./service_tick_module.pya" ya\n',
    "utf8"
  );

  forget();
  const result = await runScheduledJob({
    worldRoot,
    job: {
      jobName: "custom tick",
      agentName: "helper",
      laneName: "custom_tick",
      withCase: { wo: "tools" },
      prompt: ""
    }
  });
  assert.equal(result?.status, "skipped:service_missing_run");
});

test("service sentence executes execstart from ob filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-service-execstart-"));
  const worldRoot = path.join(root, "world");
  const serviceDir = path.join(worldRoot, "conduct", "service");
  const markerPath = path.join(root, "execstart-marker.txt");
  await fs.mkdir(serviceDir, { recursive: true });
  await fs.writeFile(
    path.join(serviceDir, "exec_tick.pya"),
    `su name exec tick as text "simple" ob filename "printf done > ${markerPath}" onto text "on-failure" for name multi-user.target be service ya\n`,
    "utf8"
  );

  forget();
  const result = await runScheduledJob({
    worldRoot,
    job: {
      jobName: "exec tick",
      agentName: "helper",
      laneName: "exec_tick",
      withCase: { wo: "tools" },
      prompt: ""
    }
  });
  assert.equal(result?.status, "service:execstart_ok");
  assert.equal((await fs.readFile(markerPath, "utf8")).trim(), "done");
});
