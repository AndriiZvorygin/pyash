import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "../program/understand/index.mjs";
import { resolveCompiledCommandPolicy } from "../program/library/command_policy.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");
const runners = ["run", "runjs", "runc"];
const cAvailable = spawnSync("gcc", ["--version"], { stdio: "ignore" }).status === 0;

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PYA_") || key === "OLLAMA_HOST" || key === "OPENAI_BASE_URL" || key === "AI_HOST") {
      delete env[key];
    }
  }
  env.SHELL = "/bin/bash";
  return env;
}

function policySource({ mode = "allow", classifier = "truth", scope = "command" } = {}) {
  const mapName = scope === "command" ? "command configure" : `${scope} command configure`;
  return [
    `su name ${mapName} be map def`,
    `  su name policy mode ob wo ${mode} ya`,
    `  su name classifier enabled ob bool ${classifier} ya`,
    "prah"
  ].join("\n");
}

test("compiled policy extraction preserves scope precedence and legacy keys", () => {
  const legacy = [
    parse("exists su name session command policy mode ob wo ask ya"),
    parse("exists su name agent command policy mode ob wo allow ya"),
    parse("exists su name command policy mode ob wo deny ya"),
    parse("exists su name command classifier enabled ob bool lie ya")
  ];
  const legacyPolicy = resolveCompiledCommandPolicy(legacy);
  assert.deepEqual(legacyPolicy, {
    mode: "ask",
    classifierEnabled: false,
    source: "session command configure"
  });

  const mapped = [
    parse("su name command configure be map def"),
    parse("su name policy mode ob wo deny ya"),
    parse("prah"),
    parse("su name agent command configure be map def"),
    parse("su name policy mode ob wo ask ya"),
    parse("prah"),
    parse("su name session command configure be map def"),
    parse("su name policy mode ob wo allow ya"),
    parse("prah")
  ];
  assert.deepEqual(resolveCompiledCommandPolicy(mapped), {
    mode: "allow",
    classifierEnabled: true,
    source: "session command configure"
  });
});

async function runScenario(runner, sourceText, { sentinel = false } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-compiled-command-policy-"));
  const sourcePath = path.join(tmpDir, "scenario.pya");
  const runId = `compiled-command-policy-${runner}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(sourcePath, sourceText, "utf8");
  const sentinelNames = Array.isArray(sentinel)
    ? sentinel
    : [typeof sentinel === "string" ? sentinel : (sentinel ? "blocked-sentinel" : null)].filter(Boolean);
  for (const sentinelName of sentinelNames) {
    await fs.writeFile(path.join(tmpDir, sentinelName), "keep\n", "utf8");
  }

  let exitCode = 0;
  try {
    await execFileAsync(path.join(repoRoot, runner), [
      "--newspaper",
      "--no-checkpoint",
      "--run-id", runId,
      "--run-time", "2025-01-01T00:00:00Z",
      sourcePath
    ], { cwd: tmpDir, env: cleanEnv(), timeout: 120000 });
  } catch (error) {
    exitCode = typeof error?.code === "number" ? error.code : 1;
  }

  const newspaperPath = path.join(tmpDir, "newspaper", `${runId}.pya`);
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  return { tmpDir, runId, exitCode, newspaper };
}

async function replayScenario({ tmpDir, runId }) {
  return execFileAsync(process.execPath, [
    path.join(repoRoot, "command", "replay_newspaper.mjs"),
    "--run-id", runId,
    "--run-root", tmpDir
  ], { cwd: repoRoot, env: cleanEnv(), timeout: 120000 });
}

function parsePolicyRecords(newspaper) {
  return newspaper
    .split(/\r?\n/u)
    .filter(line => /(?:be command audit ya|be ratify do)$/u.test(line.trim()))
    .map(line => {
      const sentence = parse(line);
      assert.ok(sentence, `policy record should parse: ${line}`);
      assert.ok(sentence.fromtext?.text, `policy record should carry timestamp: ${line}`);
      return sentence;
    });
}

async function forEachRunner(t, callback) {
  for (const runner of runners) {
    if (runner === "runc" && !cAvailable) {
      t.assert.skip("gcc toolchain unavailable for runc compiled policy matrix");
      continue;
    }
    await callback(runner);
  }
}

test("compiled allow emits request/policy/result audits and deterministic artifact-linked identities", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource(),
      'ob text "printf first" to filename "artifacts/first.txt" be command do',
      'ob text "printf second" to filename "artifacts/second.txt" be command do',
      ""
    ].join("\n"));

    assert.equal(result.exitCode, 0, runner);
    assert.match(result.newspaper, /command result identity protocol ob text "v1"/u);
    assert.match(result.newspaper, /exists su name command request 000001 ob la/u, runner);
    assert.match(result.newspaper, /exists su name command request 000002 ob la/u, runner);
    assert.match(result.newspaper, /su name command request 000001 ob text "first" be command ya/u, runner);
    assert.match(result.newspaper, /su name command request 000002 ob text "second" be command ya/u, runner);
    assert.match(result.newspaper, /su name command audit 000001[\s\S]*?to name command request 000001[\s\S]*?accordingto name allow/u, runner);
    assert.match(result.newspaper, /su name command audit 000002[\s\S]*?to name command request 000002[\s\S]*?accordingto name allow/u, runner);
    assert.match(result.newspaper, /be artifact ya/u, runner);
    assert.match(result.newspaper, /ob name command request 000001/u, runner);
    assert.match(result.newspaper, /ob name command request 000002/u, runner);
    assert.match(result.newspaper, /be exchange ya/u, runner);
    assert.equal(await fs.readFile(path.join(result.tmpDir, "artifacts/first.txt"), "utf8"), "first");
    assert.equal(await fs.readFile(path.join(result.tmpDir, "artifacts/second.txt"), "utf8"), "second");
    assert.equal(parsePolicyRecords(result.newspaper).filter(sentence => sentence.be === "command audit").length, 4, runner);
    await replayScenario(result);
  });
});

test("compiled deny blocks restricted commands before spawn and preserves the sentinel", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource({ mode: "deny" }),
      'ob text "RM -RF blocked-sentinel" to filename "artifacts/blocked.txt" be command do',
      ""
    ].join("\n"), { sentinel: true });

    assert.notEqual(result.exitCode, 0, runner);
    assert.equal(await fs.readFile(path.join(result.tmpDir, "blocked-sentinel"), "utf8"), "keep\n", runner);
    await assert.rejects(fs.access(path.join(result.tmpDir, "artifacts/blocked.txt")), undefined, runner);
    assert.match(result.newspaper, /exists su name command request 000001 ob la/u, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?to name command request 000001[\s\S]*?accordingto name deny/u, runner);
    assert.doesNotMatch(result.newspaper, /su name command request 000001 ob text[\s\S]*?be command ya/u, runner);
    assert.doesNotMatch(result.newspaper, /be artifact ya/u, runner);
    assert.equal(parsePolicyRecords(result.newspaper).filter(sentence => sentence.be === "command audit").length, 1, runner);
    await replayScenario(result);
  });
});

test("compiled ask/propose fails closed with an identity-linked ratify request", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource({ mode: "ask" }),
      `ob text ${JSON.stringify(`printf 'ask "quoted"'`)} be command propose`,
      ""
    ].join("\n"));

    if (runner === "run") assert.equal(result.exitCode, 0, runner);
    else assert.notEqual(result.exitCode, 0, runner);
    await assert.rejects(fs.access(path.join(result.tmpDir, "ask-sentinel")), undefined, runner);
    assert.match(result.newspaper, /exists su name command request 000001 ob la/u, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?to name command request 000001[\s\S]*?accordingto name ask/u, runner);
    const records = parsePolicyRecords(result.newspaper);
    const audit = records.find(sentence => sentence.be === "command audit");
    const ratify = records.find(sentence => sentence.be === "ratify");
    assert.equal(audit?.to?.name, "command request 000001", runner);
    assert.equal(audit?.accordingto?.name, "ask", runner);
    assert.equal(ratify?.to?.name, "command request 000001", runner);
    assert.equal(ratify?.accordingto?.name, "resume token", runner);
    assert.equal(JSON.parse(ratify?.fromtext?.text ?? "{}").requestIdentity, "command request 000001", runner);
    assert.doesNotMatch(result.newspaper, /be artifact ya/u, runner);
  });
});

test("compiled policy is resolved at the execution point", async t => {
  await forEachRunner(t, async runner => {
    const earlier = await runScenario(runner, [
      'ob text "rm -rf early-sentinel" be command do',
      policySource({ mode: "allow" }),
      ""
    ].join("\n"), { sentinel: "early-sentinel" });

    if (runner === "run") assert.equal(earlier.exitCode, 0, runner);
    else assert.notEqual(earlier.exitCode, 0, runner);
    assert.equal(await fs.readFile(path.join(earlier.tmpDir, "early-sentinel"), "utf8"), "keep\n", runner);
    const earlierRecords = parsePolicyRecords(earlier.newspaper);
    assert.equal(earlierRecords.find(sentence => sentence.be === "command audit")?.accordingto?.name, "ask", runner);

    const midProgram = await runScenario(runner, [
      policySource({ mode: "allow" }),
      'ob text "rm -rf before-policy-change" be command do',
      policySource({ mode: "deny" }),
      'ob text "rm -rf after-policy-change" be command do',
      ""
    ].join("\n"), { sentinel: ["before-policy-change", "after-policy-change"] });

    assert.notEqual(midProgram.exitCode, 0, runner);
    await assert.rejects(fs.access(path.join(midProgram.tmpDir, "before-policy-change")), undefined, runner);
    assert.equal(await fs.readFile(path.join(midProgram.tmpDir, "after-policy-change"), "utf8"), "keep\n", runner);
    const midRecords = parsePolicyRecords(midProgram.newspaper);
    const audits = midRecords.filter(sentence => sentence.be === "command audit");
    assert.equal(audits.find(sentence => sentence.to?.name === "command request 000001")?.accordingto?.name, "allow", runner);
    assert.equal(audits.find(sentence => sentence.to?.name === "command request 000002")?.accordingto?.name, "deny", runner);
  });
});

test("compiled allowed command failures retain the request identity in the error audit", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource(),
      'ob text "false" be command do',
      ""
    ].join("\n"));

    assert.notEqual(result.exitCode, 0, runner);
    assert.match(result.newspaper, /exists su name command request 000001 ob la/u, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?to name command request 000001[\s\S]*?as name result[\s\S]*?accordingto name error/u, runner);
    assert.doesNotMatch(result.newspaper, /su name command request 000001 ob text[\s\S]*?be command ya/u, runner);
    assert.equal(parsePolicyRecords(result.newspaper).filter(sentence => sentence.be === "command audit").length, 2, runner);
    await replayScenario(result);
  });
});

test("compiled classifier-disabled commands use unknown and omit the by class", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource({ classifier: "lie" }),
      'ob text "printf classifier-disabled" be command do',
      ""
    ].join("\n"));

    assert.equal(result.exitCode, 0, runner);
    const audits = result.newspaper.split(/\r?\n/u).filter(line => line.includes("be command audit ya"));
    assert.equal(audits.length, 2, runner);
    assert.ok(audits.every(line => line.includes("to name command request 000001")), runner);
    assert.ok(audits.every(line => !line.includes(" by name ")), runner);
    assert.equal(parsePolicyRecords(result.newspaper).filter(sentence => sentence.be === "command audit").length, 2, runner);
  });
});

test("compiled runners preserve legacy command policy configuration", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      "exists su name command policy mode ob wo allow ya",
      'ob text "printf legacy-policy" be command do',
      ""
    ].join("\n"));

    assert.equal(result.exitCode, 0, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?from name command configure[\s\S]*?accordingto name allow/u, runner);
    assert.match(result.newspaper, /su name command request 000001 ob text "legacy-policy" be command ya/u, runner);
  });
});

test("compiled runners apply session, agent, then command policy precedence", async t => {
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource({ mode: "deny", scope: "command" }),
      policySource({ mode: "deny", scope: "agent" }),
      policySource({ mode: "allow", scope: "session" }),
      'ob text "rm -rf precedence-sentinel" be command do',
      ""
    ].join("\n"), { sentinel: true });

    assert.equal(result.exitCode, 0, runner);
    await assert.rejects(fs.access(path.join(result.tmpDir, "precedence-sentinel")), undefined, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?from name session command configure[\s\S]*?accordingto name allow/u, runner);
  });
});

test("compiled command audits preserve quoted text within the configured buffer", async t => {
  const commandText = `printf 'quoted command ${"x".repeat(1000)}'`;
  await forEachRunner(t, async runner => {
    const result = await runScenario(runner, [
      policySource(),
      `ob text ${JSON.stringify(commandText)} to filename "artifacts/quoted.txt" be command do`,
      ""
    ].join("\n"));

    assert.equal(result.exitCode, 0, runner);
    assert.match(result.newspaper, /command audit 000001[\s\S]*?quoted command/u, runner);
    assert.equal(await fs.readFile(path.join(result.tmpDir, "artifacts/quoted.txt"), "utf8"), `quoted command ${"x".repeat(1000)}`, runner);
  });
});
