import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("scheduler control surface supports begin health restart stop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-control-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "house", "helper", "conduct"), { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "conduct", "agent.pya"),
    'su name helper house directory ob filename "world/house/helper" ya\n',
    "utf8"
  );
  await fs.writeFile(
    path.join(worldRoot, "house", "helper", "conduct", "calendar.pya"),
    [
      "su name heartbeat for name helper with wo tools vyah habit during minute 24 be calendar ya",
      "su name matrix probe for name helper with wo tools vyah habit during minute 1 be calendar ya"
    ].join("\n") + "\n",
    "utf8"
  );

  forget();
  doRemember({
    mood: "ya",
    su: { name: "world tools" },
    be: "bool",
    ob: { boolean: true }
  });
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    be: "filename",
    ob: { filename: worldRoot }
  });

  const beginRes = await interpret(parse('be begin ob text "scheduler" as wo scheduler do'));
  assert.equal(beginRes?.value?.boolean, true);

  const healthPath = path.join(worldRoot, "conduct", "health.pya");
  let healthText = "";
  for (let i = 0; i < 100; i += 1) {
    try {
      healthText = await fs.readFile(healthPath, "utf8");
      if (healthText) break;
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(healthText, /su name scheduler health be map def/);
  assert.match(healthText, /su name scheduler job 1 be map def/);
  assert.match(healthText, /su name job name ob text "heartbeat" ya/);

  const healthRes = await interpret(parse('be health ob text "scheduler" as wo scheduler do'));
  assert.equal(typeof healthRes?.value?.boolean, "boolean");

  const restartRes = await interpret(parse('be restart ob text "scheduler" as wo scheduler do'));
  assert.equal(restartRes?.value?.boolean, true);

  const stopRes = await interpret(parse('be stop ob text "scheduler" as wo scheduler do'));
  assert.equal(stopRes?.value?.boolean, true);
});

test("scheduler control surface supports from wo calendar forms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-control-calendar-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "house", "helper", "conduct"), { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "conduct", "agent.pya"),
    'su name helper house directory ob filename "world/house/helper" ya\n',
    "utf8"
  );
  await fs.writeFile(
    path.join(worldRoot, "house", "helper", "conduct", "calendar.pya"),
    [
      "su name heartbeat for name helper with wo tools vyah habit during minute 24 be calendar ya",
      "su name matrix probe for name helper with wo tools vyah habit during minute 1 be calendar ya"
    ].join("\n") + "\n",
    "utf8"
  );

  forget();
  doRemember({
    mood: "ya",
    su: { name: "world tools" },
    be: "bool",
    ob: { boolean: true }
  });
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    be: "filename",
    ob: { filename: worldRoot }
  });

  const beginRes = await interpret(parse("from wo calendar su name scheduler be begin do"));
  assert.equal(beginRes?.value?.boolean, true);

  const listRes = await interpret(parse("from wo calendar su name scheduler be list do"));
  assert.deepEqual(listRes?.value?.ve?.values?.slice().sort(), ["heartbeat", "matrix probe"]);

  const healthRes = await interpret(parse("from wo calendar su name scheduler be health do"));
  assert.equal(typeof healthRes?.value?.boolean, "boolean");

  const healthProbeRes = await interpret(parse("from wo calendar su name scheduler be health probe do"));
  assert.equal(typeof healthProbeRes?.value?.boolean, "boolean");

  const serviceHealthStart = await interpret(parse("from wo calendar su name matrix probe be health do"));
  assert.equal(serviceHealthStart?.value?.boolean, true);

  const serviceStop = await interpret(parse("from wo calendar su name matrix probe be stop do"));
  assert.equal(serviceStop?.value?.boolean, true);

  const serviceHealthStopped = await interpret(parse("from wo calendar su name matrix probe be health do"));
  assert.equal(serviceHealthStopped?.value?.boolean, false);

  const serviceBegin = await interpret(parse("from wo calendar su name matrix probe be begin do"));
  assert.equal(serviceBegin?.value?.boolean, true);

  const serviceHealthResumed = await interpret(parse("from wo calendar su name matrix probe be health do"));
  assert.equal(serviceHealthResumed?.value?.boolean, true);

  const serviceRestart = await interpret(parse("from wo calendar su name matrix probe be restart do"));
  assert.equal(serviceRestart?.value?.boolean, true);

  const restartRes = await interpret(parse("from wo calendar su name scheduler be restart do"));
  assert.equal(restartRes?.value?.boolean, true);

  const stopRes = await interpret(parse("from wo calendar su name scheduler be stop do"));
  assert.equal(stopRes?.value?.boolean, true);
});

test("scheduler restart clears stale channel input locks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-lock-cleanup-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "house", "helper", "conduct"), { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "conduct", "agent.pya"),
    'su name helper house directory ob filename "world/house/helper" ya\n',
    "utf8"
  );
  await fs.writeFile(
    path.join(worldRoot, "house", "helper", "conduct", "calendar.pya"),
    "su name matrix probe for name helper with wo tools vyah habit during minute 1 be calendar ya\n",
    "utf8"
  );

  forget();
  doRemember({
    mood: "ya",
    su: { name: "world tools" },
    be: "bool",
    ob: { boolean: true }
  });
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    be: "filename",
    ob: { filename: worldRoot }
  });

  const beginRes = await interpret(parse('be begin ob text "scheduler" as wo scheduler do'));
  assert.equal(beginRes?.value?.boolean, true);

  const staleLockPath = path.join(worldRoot, "presence", "stale-fake-channel-input.lock");
  await fs.mkdir(path.dirname(staleLockPath), { recursive: true });
  await fs.writeFile(staleLockPath, "pid=999999\nstartedAt=now\nagent=stale\nchannel=fake\n", "utf8");

  const restartRes = await interpret(parse('be restart ob text "scheduler" as wo scheduler do'));
  assert.equal(restartRes?.value?.boolean, true);

  let staleRemoved = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      await fs.access(staleLockPath);
    } catch (err) {
      if (err?.code === "ENOENT") {
        staleRemoved = true;
        break;
      }
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(staleRemoved, true);

  const stopRes = await interpret(parse('be stop ob text "scheduler" as wo scheduler do'));
  assert.equal(stopRes?.value?.boolean, true);
});
