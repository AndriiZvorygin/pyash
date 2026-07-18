import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCodexExecArgs,
  buildCodexPrompt,
  classifyProbe,
  mergeManagedCrontab,
  runProcess,
  shouldLaunchRecovery,
} from "../world/house/refinery-watchdog/program/watchdog-lib.mjs";

test("classifyProbe distinguishes active, healthy, unpublished, and failed probes", () => {
  assert.deepEqual(classifyProbe({ active: true }), {
    state: "active",
    needs_repair: false,
    reason: "reporter or shared pipeline lock is held",
  });
  assert.equal(classifyProbe({}).state, "healthy_no_candidate");
  assert.equal(classifyProbe({ candidate: { meeting_id: "abc" } }).state, "unposted_candidate");
  assert.equal(classifyProbe({ candidate: { meeting_id: "abc" } }).needs_repair, true);
  assert.equal(classifyProbe({ exitCode: 1 }).state, "probe_error");
  assert.equal(classifyProbe({ error: "timeout" }).needs_repair, true);
});

test("recovery launches only for a new confirmed failure without active work", () => {
  const failures = [{ reporter: "owen" }];
  assert.equal(shouldLaunchRecovery({ failures }), true);
  assert.equal(shouldLaunchRecovery({ failures, active: true }), false);
  assert.equal(shouldLaunchRecovery({ failures, alreadyLaunched: true }), false);
  assert.equal(shouldLaunchRecovery({ failures: [] }), false);
});

test("managed crontab replaces legacy reporter entries and is idempotent", () => {
  const legacy = [
    "30 1 * * * /home/htaf/pyash/scripts/disk-space-housekeeping.sh",
    "0 2 * * * flock -n /tmp/andrii-youtube-reporter.cron.lock -c \"cd /home/htaf/pyash/world/house/andrii-youtube-reporter && ./run-next-story.sh --refresh\"",
    "0 3 * * * flock -n /tmp/owen-sound-reporter.cron.lock -c \"cd /home/htaf/pyash/world/house/owen-sound-reporter && ./run-next-story.sh --refresh\"",
    "0 4 * * * flock -n /tmp/grey-county-reporter.cron.lock -c \"cd /home/htaf/pyash/world/house/grey-county-reporter && ./run-next-story.sh --refresh\"",
    "20 5 * * * node keep-existing.mjs",
    "",
  ].join("\n");
  const once = mergeManagedCrontab(legacy, { nodeBin: "/test/node" });
  const twice = mergeManagedCrontab(once, { nodeBin: "/test/node" });
  assert.equal(twice, once);
  assert.match(once, /0 2 \* \* \* .*run-nightly-refinery\.mjs andrii/u);
  assert.match(once, /0 5,6 \* \* \* .*run-watchdog\.mjs/u);
  assert.match(once, /keep-existing\.mjs/u);
  assert.doesNotMatch(once, /run-next-story\.sh --refresh/u);
  assert.equal((once.match(/refinery-watchdog managed:start/gu) || []).length, 1);
});

test("Codex prompt carries general repair and publishing guardrails", () => {
  const prompt = buildCodexPrompt({
    incidentPath: "/tmp/incident.json",
    artifactDir: "/tmp/artifacts",
    reporters: [{ reporter: "owen" }, { reporter: "grey" }],
  });
  assert.match(prompt, /qwen3\.5:9b/u);
  assert.match(prompt, /Affected reporters: owen, grey/u);
  assert.match(prompt, /Do not create meeting-specific/u);
  assert.match(prompt, /complete meeting chronology/u);
  assert.match(prompt, /independent|Verify the remote publication/iu);
  assert.match(prompt, /do not commit or push/iu);
});

test("Codex launcher contract works with a noninteractive fake executable", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refinery-watchdog-codex-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const fakePath = path.join(tempDir, "fake-codex.mjs");
  const outputPath = path.join(tempDir, "final.json");
  fs.writeFileSync(fakePath, [
    "#!/usr/bin/env node",
    "import fs from 'node:fs';",
    "const args = process.argv.slice(2);",
    "const output = args[args.indexOf('-o') + 1];",
    "fs.writeFileSync(output, JSON.stringify({status:'no_action',reporters:[],root_cause:'simulation',changed_files:[],tests:[],reruns:[],publication_urls:[],remaining_risks:[]}));",
    "process.stdout.write(JSON.stringify({type:'simulation.complete'}) + '\\n');",
  ].join("\n"), "utf8");
  fs.chmodSync(fakePath, 0o755);
  const args = buildCodexExecArgs({
    prompt: "simulation prompt",
    schemaPath: path.join(tempDir, "schema.json"),
    outputPath,
  });
  const result = await runProcess({ cmd: fakePath, args, stream: false, timeoutMs: 10_000 });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).status, "no_action");
  assert.match(result.stdout, /simulation\.complete/u);
  assert.deepEqual(args.slice(0, 3), ["exec", "--full-auto", "--json"]);
});
