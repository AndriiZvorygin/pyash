import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../../program/understand/index.mjs";
import { splitSentences } from "../../program/library/sentenceSplitter.mjs";
import { buildWorkTask } from "../../program/runtime/work/contract.mjs";
import {
  buildCompactContextCheckpoint,
  projectWorkContext,
  WORK_CONTEXT_MAX_PROMPT_BYTES,
  WORK_CONTEXT_VERSION
} from "../../program/runtime/work/context.mjs";
import { appendWorkOutcome } from "../../program/runtime/work/outcome.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";

function makeTask(overrides = {}) {
  return buildWorkTask({
    taskId: "context-compaction-test",
    owner: "background",
    kind: "roadmap",
    title: "Bound the review loop",
    queuedAt: "2026-08-28T12:00:00.000Z",
    promptText: "Keep repeated review context bounded.",
    acceptanceText: "The compact prompt is deterministic and accepted evidence survives replay.",
    contextText: "The supervisor retains complete audit evidence in its work artifact.",
    workSpec: { bounded: true },
    checkpoint: {
      workspace: { repository: "/repo", worktreePath: "/repo/worktree/context" },
      plan: { workOrder: "Project only the duty and latest applicable evidence.", risks: "Opaque threads retain their own history." },
      ...overrides.checkpoint
    },
    ...overrides
  });
}

function implementationTurn(number, marker = `latest-${number}`) {
  return {
    phase: "implementation",
    role: "worker",
    threadId: `luna-thread-${number}`,
    turnId: `luna-turn-${number}`,
    requestIdentity: `luna-request-${number}`,
    state: "completed",
    resultCaptured: true,
    result: {
      text: [
        `SUMMARY: ${marker}`,
        "CHANGED FILES: program/runtime/work/context.mjs",
        "TESTS: node --test quiz/runtime/work_context.test.mjs",
        "BLOCKERS: none",
        "UNCERTAINTY: none",
        `COMMIT: commit-${number}`
      ].join("\n"),
      diff: `diff --git a/context-${number}.mjs b/context-${number}.mjs\n+${marker}`
    }
  };
}

function reviewTurn(number, decision = "REVISE") {
  return {
    phase: "review",
    role: "manager",
    threadId: `sol-thread-${number}`,
    turnId: `sol-turn-${number}`,
    requestIdentity: `sol-request-${number}`,
    state: "completed",
    resultCaptured: true,
    result: {
      text: [
        `DECISION: ${decision}`,
        `RATIONALE: review ${number}`,
        `CORRECTION: apply correction ${number}`
      ].join("\n")
    }
  };
}

function hugeField(start, end, unit) {
  return `${start}${unit.repeat(24000)}${end}`;
}

function adversarialTask(unit, decision = "REVISE", queuedAt = "2026-08-28T12:00:00.000Z") {
  const diff = `RAW-DIFF-SENTINEL-${unit.repeat(60000)}`;
  const implementation = {
    phase: "implementation",
    role: "worker",
    turnId: "LUNA-TURN-REQUIRED",
    requestIdentity: "LUNA-REQUEST-REQUIRED",
    state: "completed",
    resultCaptured: true,
    result: {
      text: [
        `SUMMARY: ${hugeField("LUNA-SUMMARY-START", "LUNA-SUMMARY-END", unit)}`,
        "CHANGED FILES: LUNA-FILE-REQUIRED",
        "TESTS: LUNA-TEST-REQUIRED",
        `BLOCKERS: ${hugeField("LUNA-BLOCKER-START", "LUNA-BLOCKER-END", unit)}`,
        "COMMIT: LUNA-COMMIT-REQUIRED"
      ].join("\n"),
      diff
    }
  };
  const review = {
    phase: "review",
    role: "manager",
    turnId: "SOL-TURN-REQUIRED",
    requestIdentity: "SOL-REQUEST-REQUIRED",
    state: "completed",
    resultCaptured: true,
    result: {
      text: [
        `DECISION: ${decision}`,
        `RATIONALE: ${hugeField("SOL-RATIONALE-START", "SOL-RATIONALE-END", unit)}`,
        `CORRECTION: ${hugeField("SOL-CORRECTION-START", "SOL-CORRECTION-END", unit)}`
      ].join("\n")
    }
  };
  const convergence = {
    phase: "convergence-review",
    role: "manager",
    turnId: "CONVERGENCE-TURN-REQUIRED",
    requestIdentity: "CONVERGENCE-REQUEST-REQUIRED",
    state: "completed",
    resultCaptured: true,
    result: {
      text: [
        "DECISION: CONTINUE",
        `RATIONALE: ${hugeField("CONVERGENCE-RATIONALE-START", "CONVERGENCE-RATIONALE-END", unit)}`,
        `CORRECTION: ${hugeField("CONVERGENCE-CORRECTION-START", "CONVERGENCE-CORRECTION-END", unit)}`
      ].join("\n")
    }
  };
  return makeTask({
    queuedAt,
    title: hugeField("DUTY-TITLE-START", "DUTY-TITLE-END", unit),
    promptText: hugeField("DUTY-OBJECTIVE-START", "DUTY-OBJECTIVE-END", unit),
    acceptanceText: hugeField("DUTY-ACCEPTANCE-START", "DUTY-ACCEPTANCE-END", unit),
    contextText: hugeField("DUTY-CONTEXT-START", "DUTY-CONTEXT-END", unit),
    checkpoint: {
      workspace: { repository: "/repo", worktreePath: "/worktree" },
      plan: {
        workOrder: hugeField("DUTY-WORK-ORDER-START", "DUTY-WORK-ORDER-END", unit),
        risks: hugeField("DUTY-RISKS-START", "DUTY-RISKS-END", unit)
      },
      implementation: { passes: 20, diff },
      review: { decision, revisionInstructions: "SOL-CORRECTION-REQUIRED" },
      convergence: { reviewCount: 20 },
      turnHistory: [implementation, review, convergence]
    }
  });
}

function parseNewspaperRecords(source) {
  const records = [];
  let current = null;
  for (const line of splitSentences(source)) {
    const sentence = parse(line);
    if (sentence?.mood === "def" && sentence?.be === "map") {
      current = { name: sentence.su?.name || "" };
      continue;
    }
    if (sentence?.mood === "prah") {
      if (current) records.push(current);
      current = null;
      continue;
    }
    if (current && sentence?.mood === "ya" && sentence.su?.name) {
      current[sentence.su.name] = sentence.ob?.text
        ?? sentence.ob?.num
        ?? sentence.ob?.boolean
        ?? sentence.ob?.name;
    }
  }
  return records;
}

test("twenty synthetic revision cycles keep the compact prompt bounded and latest-only", () => {
  const turns = [];
  let task = makeTask();
  let maximum = 0;
  let promptMessages = 0;
  for (let number = 1; number <= 20; number += 1) {
    turns.push(implementationTurn(number), reviewTurn(number));
    task = makeTask({
      checkpoint: {
        ...task.checkpoint,
        implementation: {
          passes: number,
          changedFiles: [`obsolete-${number}.mjs`],
          diff: "x".repeat(60000),
          passHistory: turns
            .filter((turn) => turn.phase === "implementation")
            .map((turn, index) => ({
              pass: index + 1,
              state: "completed",
              at: `2026-08-28T12:${String(index).padStart(2, "0")}:00.000Z`,
              turnId: turn.turnId,
              requestIdentity: turn.requestIdentity,
              summary: turn.result.text.split("\n")[0].slice(9),
              diffHash: crypto.createHash("sha256").update(turn.result.diff).digest("hex"),
              material: false,
              noDeltaReason: "retry evidence"
            })),
          materialProgressPasses: 0,
          noProgressPasses: number,
          consecutiveNoProgressPasses: number
        },
        review: {
          decision: "REVISE",
          explanation: `review ${number}`,
          revisionInstructions: `apply correction ${number}`
        },
        turnHistory: [...turns]
      }
    });
    const projection = projectWorkContext(task, { phase: "revision", role: "worker" });
    promptMessages += 1;
    maximum = Math.max(maximum, Buffer.byteLength(projection.prompt, "utf8"));
    if (number > 1) {
      assert.doesNotMatch(projection.prompt, /Summary: latest-1(?:\n|$)/, "obsolete implementation marker must leave live context");
      assert.doesNotMatch(projection.prompt, /Correction: apply correction 1(?:\n|$)/, "obsolete correction marker must leave live context");
    }
    assert.match(projection.prompt, new RegExp(`Summary: latest-${number}(?:\\n|$)`));
    assert.match(projection.prompt, new RegExp(`Correction: apply correction ${number}(?:\\n|$)`));
    assert.ok(!projection.prompt.includes("x".repeat(100)), "raw diff must not enter live context");
  }
  assert.equal(promptMessages, 20);
  assert.match(JSON.stringify(task.checkpoint.turnHistory), /latest-1/);
  assert.ok(maximum <= WORK_CONTEXT_MAX_PROMPT_BYTES);
  assert.ok(maximum < 4000, `unexpected compact prompt maximum: ${maximum}`);
});

test("review, revision, convergence, and ACCEPT projections select only their allowed evidence", () => {
  const task = makeTask({
    checkpoint: {
      implementation: { passes: 20, diff: "d".repeat(60000) },
      review: { decision: "REVISE", explanation: "latest decision", revisionInstructions: "latest correction" },
      convergence: { reviewCount: 4, decision: "CONTINUE", rationale: "latest convergence", correction: "narrow correction" },
      turnHistory: [implementationTurn(1, "obsolete"), reviewTurn(1), implementationTurn(20, "current"), reviewTurn(20)]
    }
  });
  const review = projectWorkContext(task, { phase: "review", role: "manager" });
  assert.match(review.prompt, /current/);
  assert.doesNotMatch(review.prompt, /obsolete/);
  assert.doesNotMatch(review.prompt, /latest correction/);
  assert.doesNotMatch(review.prompt, /d{100}/);
  assert.deepEqual(review.sourceTurnIds, ["luna-turn-20"]);
  assert.deepEqual(review.sourceRequestIds, ["luna-request-20"]);

  const revision = projectWorkContext(task, { phase: "revision", role: "worker" });
  assert.match(revision.prompt, /current/);
  assert.match(revision.prompt, /review 20/);
  assert.match(revision.prompt, /apply correction 20/);
  assert.doesNotMatch(revision.prompt, /review 1/);
  assert.deepEqual(revision.sourceTurnIds, ["luna-turn-20", "sol-turn-20"]);

  const accepted = projectWorkContext(task, { phase: "accepted", role: "manager" });
  assert.match(accepted.prompt, /current/);
  assert.match(accepted.prompt, /review 20/);
  assert.deepEqual(accepted.sourceRequestIds, ["luna-request-20", "sol-request-20"]);

  const convergence = projectWorkContext(task, { phase: "convergence-review", role: "manager" });
  assert.match(convergence.prompt, /Implementation passes: 20/);
  assert.match(convergence.prompt, /current/);
  assert.doesNotMatch(convergence.prompt, /obsolete/);
  assert.doesNotMatch(convergence.prompt, /retry evidence/);
});

test("identical projections have identical bytes and SHA-256 despite changed audit timestamps", () => {
  const first = makeTask({
    queuedAt: "2026-08-28T12:00:00.000Z",
    checkpoint: { turnHistory: [implementationTurn(1, "same evidence")] }
  });
  const second = makeTask({
    queuedAt: "2026-08-28T23:59:59.000Z",
    checkpoint: { turnHistory: [implementationTurn(1, "same evidence")] }
  });
  const left = projectWorkContext(first, { phase: "review", role: "manager" });
  const right = projectWorkContext(second, { phase: "review", role: "manager" });
  assert.equal(left.prompt, right.prompt);
  assert.equal(left.contextHash, right.contextHash);
  assert.equal(left.contextHash, crypto.createHash("sha256").update(left.prompt).digest("hex"));
});

test("adversarial ASCII and multibyte fields keep required evidence within the allocated byte budget", () => {
  const phases = [
    { phase: "revision", role: "worker", required: ["SOL-CORRECTION-END", "SOL-TURN-REQUIRED", "SOL-REQUEST-REQUIRED"] },
    { phase: "accepted", role: "manager", required: ["SOL-TURN-REQUIRED", "SOL-REQUEST-REQUIRED"] },
    { phase: "convergence-review", role: "manager", required: ["CONVERGENCE-CORRECTION-END", "CONVERGENCE-TURN-REQUIRED", "CONVERGENCE-REQUEST-REQUIRED"] }
  ];
  const dutyMarkers = [
    "DUTY-TITLE-END",
    "DUTY-OBJECTIVE-END",
    "DUTY-ACCEPTANCE-END",
    "DUTY-CONTEXT-END",
    "DUTY-WORK-ORDER-END",
    "DUTY-RISKS-END"
  ];
  const evidenceMarkers = [
    "LUNA-SUMMARY-END",
    "LUNA-COMMIT-REQUIRED",
    "LUNA-FILE-REQUIRED",
    "LUNA-TEST-REQUIRED",
    "LUNA-BLOCKER-END",
    "LUNA-TURN-REQUIRED",
    "LUNA-REQUEST-REQUIRED"
  ];
  for (const unit of ["a", "界"]) {
    for (const { phase, role, required } of phases) {
      const firstTask = adversarialTask(unit, phase === "accepted" ? "ACCEPT" : "REVISE");
      const secondTask = adversarialTask(unit, phase === "accepted" ? "ACCEPT" : "REVISE", "2026-08-29T23:59:59.000Z");
      const options = { phase, role };
      const first = projectWorkContext(firstTask, options);
      const second = projectWorkContext(secondTask, options);
      const diffHash = crypto.createHash("sha256").update(`RAW-DIFF-SENTINEL-${unit.repeat(60000)}`).digest("hex");
      assert.ok(Buffer.byteLength(first.prompt, "utf8") <= WORK_CONTEXT_MAX_PROMPT_BYTES);
      assert.equal(first.prompt, second.prompt, `${unit} ${phase} bytes must be timestamp-independent`);
      assert.equal(first.contextHash, second.contextHash, `${unit} ${phase} hash must be timestamp-independent`);
      for (const marker of [...dutyMarkers, ...evidenceMarkers, ...required, diffHash]) {
        assert.match(first.prompt, new RegExp(marker), `${unit} ${phase} must preserve ${marker}`);
      }
      assert.match(first.prompt, /Diff hash: [0-9a-f]{64}/u);
      assert.doesNotMatch(first.prompt, /RAW-DIFF-SENTINEL/u, `${unit} ${phase} must not inject the raw diff`);
    }
  }
});

test("compact context and all newspaper attempt identities round-trip through Pyash records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-work-context-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  const task = makeTask({ checkpoint: { turnHistory: [implementationTurn(2, "failed sentinel remains durable")] } });
  const projection = projectWorkContext(task, { phase: "review", role: "manager" });
  const saved = await writeWorkTaskStatus(worldRoot, {
    ...task,
    checkpoint: {
      ...task.checkpoint,
      compactContext: buildCompactContextCheckpoint({
        ...projection,
        requestIdentity: "review-request-2",
        activeThreadId: "sol-thread-2",
        priorThreadIds: ["sol-thread-1"]
      })
    }
  });
  const roundTrip = await readWorkTaskStatus(worldRoot, task.taskId);
  assert.equal(roundTrip.checkpoint.compactContext.version, WORK_CONTEXT_VERSION);
  assert.equal(roundTrip.checkpoint.compactContext.prompt, projection.prompt);
  assert.equal(roundTrip.checkpoint.compactContext.contextHash, projection.contextHash);
  assert.deepEqual(roundTrip.checkpoint.compactContext.sourceTurnIds, ["luna-turn-2"]);
  assert.equal(saved.checkpoint.compactContext.activeThreadId, "sol-thread-2");
  assert.match(JSON.stringify(roundTrip.checkpoint.turnHistory), /failed sentinel remains durable/);

  const records = [];
  for (const number of [1, 2, 3]) {
    const attempt = makeTask({ checkpoint: { turnHistory: [implementationTurn(number, `attempt-${number}`)] } });
    const attemptProjection = projectWorkContext(attempt, { phase: "review", role: "manager" });
    await appendWorkOutcome(worldRoot, attempt, {
      action: "context compacted before review",
      contextCheckpoint: {
        ...attemptProjection,
        requestIdentity: `review-request-${number}`,
        activeThreadId: `sol-thread-${number}`,
        priorThreadIds: number > 1 ? [`sol-thread-${number - 1}`] : []
      }
    });
  }
  const newspaperDir = path.join(worldRoot, "newspaper");
  const newspaperName = (await fs.readdir(newspaperDir)).find((name) => name.endsWith("work-context-compaction-test.pya"));
  const newspaper = await fs.readFile(path.join(newspaperDir, newspaperName), "utf8");
  const parsed = parseNewspaperRecords(newspaper).filter((record) => record.name === "work task context checkpoint");
  records.push(...parsed);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record["source turn ids"]), [
    "[\"luna-turn-1\"]",
    "[\"luna-turn-2\"]",
    "[\"luna-turn-3\"]"
  ]);
  assert.deepEqual(records.map((record) => record["active thread id"]), ["sol-thread-1", "sol-thread-2", "sol-thread-3"]);
  assert.match(newspaper, /attempt-1/);
  assert.match(newspaper, /attempt-2/);
  assert.match(newspaper, /attempt-3/);
  assert.ok(!newspaper.includes("x".repeat(100)), "newspaper checkpoint stores bounded prompt, not raw diff");
});
