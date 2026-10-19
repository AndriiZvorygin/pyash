import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import vm from "node:vm";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile/transpile_program.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { buildWorkTask } from "../program/runtime/work/contract.mjs";
import {
  projectHeadquartersKnowledge,
  readHeadquartersKnowledgeSchema
} from "../program/agent/headquarters/knowledge.mjs";
import {
  compareUtf8Bytes,
  deriveClaimKey,
  normalizeEvidence,
  normalizeLinkedClaimBundle,
  resolveLinkedClaimBundle
} from "../program/library/knowledge_core.mjs";

const execFileAsync = promisify(execFile);

function evidenceLine({ subject = "commitment-001", facet, value, source = "hq-mail-001 paragraph-1", confidence = 0.9, exists = false } = {}) {
  return parse([
    exists ? "exists" : "",
    `su name ${subject}`,
    value,
    `fromtext text ${JSON.stringify(source)}`,
    "accordingto name direct-evidential",
    `by num ${confidence}`,
    `be ${facet} ya`
  ].filter(Boolean).join(" "));
}

test("headquarters commitments use separately keyed Knowledge Core facets", () => {
  const sentences = [
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "company", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "deadline", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "duty", value: "ob name work-fixture-mail-001" })
  ];

  const bundle = normalizeLinkedClaimBundle(sentences);

  assert.equal(bundle.subjectKey, "su name commitment-001");
  assert.deepEqual(Object.keys(bundle.facets), [
    "bet",
    "company",
    "deadline",
    "duty",
    "person"
  ]);
  assert.equal(bundle.facets["deadline"].records[0].payload.date, "2026-08-24");
  assert.equal(bundle.facets["deadline"].records[0].key, "su name commitment-001 be deadline ya");
  assert.equal(bundle.facets["deadline"].records[0].anchorId, "hq-mail-001#paragraph-1");
  assert.ok(sentences.every(sentence => !sentence.ob.map));

  const genericWindowedDate = normalizeLinkedClaimBundle([
    evidenceLine({
      facet: "deadline",
      value: "ob date 2026-08-24 since date 2026-08-01 until date 2026-08-31"
    })
  ]);
  assert.match(genericWindowedDate.facets["deadline"].records[0].key, /since date 2026-08-01/u);
});

test("headquarters contacts and relationships use the same linked-claim contract", () => {
  const contact = normalizeLinkedClaimBundle([
    evidenceLine({ subject: "person-ada", facet: "person", value: `ob text ${JSON.stringify("Ada Lovelace")}` }),
    evidenceLine({ subject: "person-ada", facet: "contacting", value: `ob text ${JSON.stringify("ada@example.test")}` })
  ]);
  const relationship = normalizeLinkedClaimBundle([
    evidenceLine({ subject: "relationship-ada-analytical", facet: "relations", value: `ob text ${JSON.stringify("works with")}` }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "person", value: "ob name person-ada" }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "company", value: "ob name analytical-engine" })
  ]);

  assert.equal(contact.subjectKey, "su name person-ada");
  assert.deepEqual(Object.keys(contact.facets), ["contacting", "person"]);
  assert.equal(relationship.subjectKey, "su name relationship-ada-analytical");
  assert.deepEqual(Object.keys(relationship.facets), ["company", "person", "relations"]);
});

test("headquarters bundle conflicts stay facet-local and preserve source evidence", () => {
  const current = [
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, source: "hq-mail-001 paragraph-1" }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace", source: "hq-mail-001 paragraph-2" }),
    evidenceLine({ facet: "company", value: "ob name analytical-engine", source: "hq-mail-001 paragraph-3" }),
    evidenceLine({ facet: "deadline", value: "ob date 2026-08-24", source: "hq-mail-001 paragraph-4" }),
    evidenceLine({ facet: "duty", value: "ob name work-fixture-mail-001", source: "hq-mail-001 paragraph-5" })
  ];
  const conflictingPerson = evidenceLine({
    facet: "person",
    value: "ob name charles-babbage",
    source: "hq-mail-002 paragraph-2",
    confidence: 0.8
  });
  const records = [...current, conflictingPerson].map(normalizeEvidence);

  const view = resolveLinkedClaimBundle(records);

  assert.equal(view.subjectKey, "su name commitment-001");
  assert.equal(view.facets.person.status, "contested");
  assert.equal(view.facets.person.records.length, 2);
  assert.equal(view.facets.company.status, "current");
  assert.equal(view.facets["deadline"].status, "current");
  assert.equal(view.facets.duty.status, "current");
  assert.deepEqual(view.facets.person.records.map(record => record.anchorId), [
    "hq-mail-001#paragraph-2",
    "hq-mail-002#paragraph-2"
  ]);

  const provenance = resolveLinkedClaimBundle(records, "provenance");
  assert.equal(provenance.facets.person.status, "provenance");
  assert.equal(provenance.facets.person.records.length, 2);
});

test("linked headquarters claims replay through the existing interpreter resolver", async () => {
  forget();
  const sentences = [
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "company", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "deadline", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "duty", value: "ob name work-fixture-mail-001" })
  ];
  for (const sentence of sentences) await interpret(sentence);

  const storedEvidence = allRemember().filter(sentence => sentence?.accordingto?.name?.endsWith("-evidential"));
  assert.equal(storedEvidence.length, sentences.length);
  const result = await interpret(parse(
    "su name claim ob la su name commitment-001 ob name ada-lovelace be person ya ko be claim choose do"
  ));
  const personView = JSON.parse(result.value.text);
  assert.equal(personView.status, "current");
  assert.equal(personView.record.payload.name, "ada-lovelace");
});

test("compiled JavaScript and C retain independent headquarters facet keys", async () => {
  const sentences = [
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "company", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "deadline", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "duty", value: "ob name work-fixture-mail-001" })
  ];
  const source = sentences.map(sentenceToPyash).join("\n");
  const program = buildProgram(source);
  const js = transpileProgram(program.sentences, { lang: "javascript" });
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${js}\nglobalThis.__views = __pyaKnowledgeRecords.map(record => __pyaKnowledge.resolveCurrent(__pyaKnowledge.claimKey(record)));`, sandbox);
  assert.deepEqual(Array.from(sandbox.__views, view => view.status), ["current", "current", "current", "current", "current"]);
  assert.deepEqual(Array.from(sandbox.__views, view => Object.keys(view.record.payload)[0]), ["text", "name", "name", "date", "name"]);

  const keys = sentences.map(normalizeEvidence).map(record => record.key);
  const c = transpileProgram(program.sentences, { lang: "c" });
  const prints = keys.map(key => `  printf("%s\\n", pya_knowledge_render_current(${JSON.stringify(key)}));`).join("\n");
  const marker = "  return 0;\n}\n#if defined(__GNUC__)";
  const runnable = c.replace(marker, `${prints}\n  return 0;\n}\n#if defined(__GNUC__)`);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hq-knowledge-facets-c-"));
  const cPath = path.join(tempDir, "facets.c");
  const executablePath = path.join(tempDir, "facets");
  await fs.writeFile(cPath, runnable, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", executablePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(executablePath, [], { timeout: 120000 });
  const cViews = stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
  assert.deepEqual(cViews.map(view => view.status), ["current", "current", "current", "current", "current"]);
  assert.deepEqual(cViews.map(view => Object.keys(view.record.payload)[0]), ["text", "name", "name", "date", "name"]);
});

test("every authoritative headquarters facet uses the Knowledge Core evidence shell", () => {
  assert.throws(
    () => normalizeLinkedClaimBundle([
      parse("exists su name commitment-001 ob date 2026-08-24 accordingto name direct-evidential by num 0.9 be deadline ya")
    ]),
    /source anchor defective/u
  );

  assert.throws(
    () => normalizeLinkedClaimBundle([
      evidenceLine({ facet: "deadline", value: "ob date 2026-08-24" }),
      evidenceLine({ subject: "other-commitment-001", facet: "duty", value: "ob name work-fixture-mail-001", source: "other-subject paragraph-1" })
    ]),
    /stable su identifier/u
  );
});

test("ordinary Knowledge Core claim identity remains the facet contract", () => {
  const dueDate = evidenceLine({ facet: "deadline", value: "ob date 2026-08-24" });
  assert.equal(deriveClaimKey(dueDate), "su name commitment-001 be deadline ya");
});

function personBundle({ subject = "person-ada", label = "Ada Lovelace", source = "hq-mail-001 person" } = {}) {
  return normalizeLinkedClaimBundle([
    evidenceLine({ subject, facet: "person", value: `ob text ${JSON.stringify(label)}`, source })
  ]);
}

function organizationBundle({ subject = "organization-analytical-engine", label = "Analytical Engine", source = "hq-mail-001 organization" } = {}) {
  return normalizeLinkedClaimBundle([
    evidenceLine({ subject, facet: "company", value: `ob text ${JSON.stringify(label)}`, source })
  ]);
}

function workBundle(subject = "work-fixture-mail-001") {
  return normalizeLinkedClaimBundle([
    evidenceLine({ subject, facet: "duty", value: `ob text ${JSON.stringify("Decision packet")}`, source: "hq-mail-001 work" })
  ]);
}

function contactMethodBundle() {
  return normalizeLinkedClaimBundle([
    evidenceLine({ subject: "contact-ada-email", facet: "contacting", value: `ob text ${JSON.stringify("ada@example.test")}`, source: "hq-mail-001 contact" }),
    evidenceLine({ subject: "contact-ada-email", facet: "person", value: "ob name person-ada", source: "hq-mail-001 contact-owner" })
  ]);
}

function relationshipBundle() {
  return normalizeLinkedClaimBundle([
    evidenceLine({ subject: "relationship-ada-analytical", facet: "relations", value: `ob text ${JSON.stringify("works with")}`, source: "hq-mail-001 relationship" }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "person", value: "ob name person-ada", source: "hq-mail-001 relationship-person" }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "company", value: "ob name organization-analytical-engine", source: "hq-mail-001 relationship-organization" })
  ]);
}

function commitmentClaims({ dueDate = "2026-08-24", person = "person-ada", organization = "organization-analytical-engine", work = "work-fixture-mail-001", firstExists = false } = {}) {
  return [
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, source: "hq-mail-001 commitment", exists: firstExists }),
    person && evidenceLine({ facet: "person", value: `ob name ${person}`, source: "hq-mail-001 person-ref" }),
    organization && evidenceLine({ facet: "company", value: `ob name ${organization}`, source: "hq-mail-001 organization-ref" }),
    dueDate && evidenceLine({ facet: "deadline", value: `ob date ${dueDate}`, source: "hq-mail-001 deadline" }),
    work && evidenceLine({ facet: "duty", value: `ob name ${work}`, source: "hq-mail-001 work-ref" })
  ].filter(Boolean);
}

function commitmentBundle(options = {}) {
  return normalizeLinkedClaimBundle(commitmentClaims(options));
}

function workTask(taskId = "work-fixture-mail-001") {
  return buildWorkTask({
    taskId,
    owner: "correspondence worker",
    title: "Prepare the decision packet",
    status: "ready",
    queuedAt: "2026-08-23T18:00:00.000Z",
    acceptanceText: "Preserve source evidence.",
    promptText: "Review the decision packet.",
    source: { identity: "fixture-mail:golden-message-001", kind: "fixture-mail", locator: "fixture-mail.pya" },
    domain: "correspondence",
    delegatedBy: "chief of staff"
  });
}

function headquartersInput(overrides = {}) {
  return {
    bundles: [
      { kind: "bet", bundle: commitmentBundle() },
      { kind: "person", bundle: personBundle() },
      { kind: "company", bundle: organizationBundle() },
      { kind: "duty", bundle: workBundle() }
    ],
    workTasks: [workTask()],
    ...overrides
  };
}

test("linked bundle facets and projections are canonical under reordered inputs", async () => {
  const lines = [
    evidenceLine({ facet: "duty", value: "ob name work-fixture-mail-001", source: "hq-mail-001 work" }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace", source: "hq-mail-001 person" }),
    evidenceLine({ facet: "deadline", value: "ob date 2026-08-24", source: "hq-mail-001 deadline" }),
    evidenceLine({ facet: "company", value: "ob name analytical-engine", source: "hq-mail-001 organization" }),
    evidenceLine({ facet: "bet", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, source: "hq-mail-001 commitment" }),
    evidenceLine({ facet: "person", value: "ob name charles-babbage", source: "hq-mail-002 person", confidence: 0.8 }),
    evidenceLine({
      facet: "person",
      value: "ob name ada-lovelace since date 2026-09-01 until date 2026-09-30",
      source: "hq-mail-003 person-window"
    })
  ];
  const forward = normalizeLinkedClaimBundle(lines);
  const reverse = normalizeLinkedClaimBundle([...lines].reverse());
  assert.deepEqual(Object.keys(forward.facets), ["bet", "company", "deadline", "duty", "person"]);
  assert.equal(compareUtf8Bytes("company", "person") < 0, true);
  const forwardView = resolveLinkedClaimBundle(forward);
  const reverseView = resolveLinkedClaimBundle(reverse);
  assert.equal(JSON.stringify(forwardView), JSON.stringify(reverseView));
  assert.equal(forwardView.facets.person.status, "multiple");
  assert.deepEqual(Object.keys(forwardView.facets.person.claims), [
    ...Object.keys(forwardView.facets.person.claims).sort(compareUtf8Bytes)
  ]);

  const projected = await projectHeadquartersKnowledge(headquartersInput({
    bundles: [...headquartersInput().bundles].reverse()
  }));
  const reorderedProjected = await projectHeadquartersKnowledge(headquartersInput());
  assert.equal(JSON.stringify(projected), JSON.stringify(reorderedProjected));
  assert.deepEqual(projected.bundles.map(bundle => bundle.subjectKey), [
    "su name commitment-001",
    "su name organization-analytical-engine",
    "su name person-ada",
    "su name work-fixture-mail-001"
  ]);
  assert.deepEqual(Object.keys(projected.bundles[0].facets), ["bet", "company", "deadline", "duty", "person"]);
});

test("Headquarters projector applies Pyash schema and validates references read-only", async () => {
  const projected = await projectHeadquartersKnowledge(headquartersInput());
  const commitment = projected.bundles.find(bundle => bundle.kind === "bet");
  assert.equal(commitment.status, "current");
  assert.equal(commitment.facets["deadline"].record.payload.date, "2026-08-24");
  assert.equal(commitment.facets.person.record.payload.name, "person-ada");
  assert.equal(commitment.facets.company.record.payload.name, "organization-analytical-engine");
  assert.equal(commitment.facets.duty.record.payload.name, "work-fixture-mail-001");
  assert.equal(commitment.facets.person.record.sentence.includes("fromtext"), true);
});

test("Headquarters uses duty for work and reserves worker for people or agents", async () => {
  const schema = await readHeadquartersKnowledgeSchema();
  assert.equal(schema.profiles.some(profile => profile.name === "worker"), false);
  assert.deepEqual(schema.profiles.find(profile => profile.name === "duty")?.requiredFacets, ["duty"]);

  const dutyCommitment = commitmentBundle();
  const dutyBundle = normalizeLinkedClaimBundle([
    evidenceLine({ subject: "work-fixture-mail-001", facet: "duty", value: `ob text ${JSON.stringify("Decision packet")}` })
  ]);
  const projected = await projectHeadquartersKnowledge({
    bundles: [
      { kind: "bet", bundle: dutyCommitment },
      { kind: "person", bundle: personBundle() },
      { kind: "company", bundle: organizationBundle() },
      { kind: "duty", bundle: dutyBundle }
    ],
    workTasks: [workTask()]
  });
  const commitment = projected.bundles.find(bundle => bundle.kind === "bet");
  assert.equal(commitment.facets.duty.record.payload.name, "work-fixture-mail-001");
});

test("Headquarters projector retains normalized subject keys for raw claim arrays", async () => {
  const base = headquartersInput();
  for (const claims of [commitmentClaims(), commitmentClaims().map(normalizeEvidence)]) {
    const projected = await projectHeadquartersKnowledge({
      ...base,
      bundles: base.bundles.map(entry => entry.kind === "bet"
        ? { kind: entry.kind, claims }
        : entry)
    });
    const commitment = projected.bundles.find(bundle => bundle.kind === "bet");
    assert.equal(commitment.subjectKey, "su name commitment-001");
  }
});

test("Headquarters projector preserves contested candidates and aggregate status", async () => {
  const base = headquartersInput();
  const contested = normalizeLinkedClaimBundle([
    ...commitmentClaims({ person: "person-ada" }),
    evidenceLine({
      facet: "person",
      value: "ob name person-charles",
      source: "hq-mail-002 person-ref",
      confidence: 0.8
    })
  ]);
  const projected = await projectHeadquartersKnowledge({
    ...base,
    bundles: [
      { kind: "bet", bundle: contested },
      { kind: "person", bundle: personBundle() },
      { kind: "person", bundle: personBundle({ subject: "person-charles", label: "Charles Babbage", source: "hq-mail-002 person" }) },
      { kind: "company", bundle: organizationBundle() },
      { kind: "duty", bundle: workBundle() }
    ]
  });
  const commitment = projected.bundles.find(bundle => bundle.kind === "bet");
  assert.equal(commitment.status, "contested");
  assert.equal(commitment.facets.person.status, "contested");
  assert.equal(commitment.facets.person.record, null);
  assert.deepEqual(commitment.facets.person.records.map(record => record.payload.name), [
    "person-ada",
    "person-charles"
  ]);
  assert.equal(commitment.facets.person.records.every(record => record.sentence.includes("fromtext")), true);
  assert.equal(commitment.provenance.person.status, "provenance");
  assert.equal(commitment.provenance.person.records.length, 2);
});

test("Headquarters projector validates exact canonical work task ids without a prefix rule", async () => {
  const taskId = "fixture-mail-001";
  const projected = await projectHeadquartersKnowledge({
    bundles: [
      { kind: "bet", bundle: commitmentBundle({ work: taskId }) },
      { kind: "person", bundle: personBundle() },
      { kind: "company", bundle: organizationBundle() },
      { kind: "duty", bundle: workBundle(taskId) }
    ],
    workTasks: [workTask(taskId)]
  });
  const commitment = projected.bundles.find(bundle => bundle.kind === "bet");
  assert.equal(commitment.facets.duty.record.payload.name, taskId);
});

test("Headquarters projector keeps contact and relationship references in the shared profile", async () => {
  const base = headquartersInput();
  const projected = await projectHeadquartersKnowledge({
    ...base,
    bundles: [
      ...base.bundles,
      { kind: "contacting", bundle: contactMethodBundle() },
      { kind: "relations", bundle: relationshipBundle() }
    ]
  });
  const contact = projected.bundles.find(bundle => bundle.kind === "contacting");
  const relationship = projected.bundles.find(bundle => bundle.kind === "relations");
  assert.equal(contact.facets.person.record.payload.name, "person-ada");
  assert.equal(contact.facets["contacting"].record.payload.text, "ada@example.test");
  assert.equal(relationship.facets.person.record.payload.name, "person-ada");
  assert.equal(relationship.facets.company.record.payload.name, "organization-analytical-engine");
});

test("Headquarters projector guards missing references, deadline shape, and WorkTask identity", async () => {
  const base = headquartersInput();
  const nonCanonicalTask = workTask();
  nonCanonicalTask.taskId = "Work fixture 001";
  const cases = [
    {
      name: "person",
      input: { ...base, bundles: base.bundles.filter(entry => entry.kind !== "person") },
      error: /missing person reference/u
    },
    {
      name: "company",
      input: { ...base, bundles: base.bundles.filter(entry => entry.kind !== "company") },
      error: /missing company reference/u
    },
    {
      name: "deadline",
      input: { ...base, bundles: base.bundles.map(entry => entry.kind === "bet" ? { kind: entry.kind, bundle: commitmentBundle({ dueDate: "" }) } : entry) },
      error: /missing deadline facet/u
    },
    {
      name: "duty",
      input: { ...base, bundles: base.bundles.filter(entry => entry.kind !== "duty"), workTasks: [] },
      error: /missing canonical duty reference/u
    },
    {
      name: "task id",
      input: { ...base, workTasks: [nonCanonicalTask] },
      error: /WorkTask\.taskId must be canonical/u
    }
  ];
  for (const testCase of cases) {
    await assert.rejects(() => projectHeadquartersKnowledge(testCase.input), testCase.error, testCase.name);
  }

  const invalidDeadline = commitmentBundle({
    dueDate: "2026-08-24 since date 2026-08-01 until date 2026-08-31"
  });
  await assert.rejects(
    () => projectHeadquartersKnowledge({
      bundles: [{ kind: "bet", bundle: invalidDeadline }],
      workTasks: [workTask()]
    }),
    /deadline facet must use an ob date without since or until/u
  );
});

test("be context predicates retain all compositional context words", () => {
  for (const context of ["space", "interior", "surface", "time", "state", "person", "social", "discourse", "quantity", "limit", "sequence"]) {
    const parsed = parse(`su name ${context} facet be ${context} ya`);
    assert.equal(parsed.be, context, `be ${context} should remain a predicate`);
  }
  const withRoles = parse("su name person facet be person from name source to name target ya");
  assert.equal(withRoles.be, "person");
  assert.equal(withRoles.from.name, "source");
  assert.equal(withRoles.to.name, "target");
  const reservedContextRole = parse("su name item be person from under name source ya");
  assert.equal(reservedContextRole.be, "person");
  assert.equal(reservedContextRole.fromunder.name, "source");
});

test("headquarters knowledge example records and replays its linked artifact", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-knowledge-example-"));
  const repoRoot = path.resolve(".");
  try {
    for (const directory of ["program", "command", "module", "examples"]) {
      await fs.symlink(path.join(repoRoot, directory), path.join(runRoot, directory), "dir");
    }
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYA_MIND_RESPONSE;
    delete cleanEnv.PYA_HEAR_FIXTURE;
    delete cleanEnv.PYA_PIPER_FIXTURE;
    const runId = "hq-contacts-commitments";
    const runCommand = path.join(repoRoot, "command", "run_pya_program.mjs");
    const example = path.join(runRoot, "examples", "pyash", "headquarters-contacts-commitments.pya");
    const runResult = await execFileAsync(process.execPath, [runCommand, "--newspaper", "--run-id", runId, example], {
      cwd: runRoot,
      env: cleanEnv,
      timeout: 120000
    });

    const replayArgs = [
      path.join(repoRoot, "command", "replay_newspaper.mjs"),
      "--run-id", runId,
      "--run-root", runRoot
    ];
    const replayed = await execFileAsync(process.execPath, replayArgs, { cwd: repoRoot, env: cleanEnv, timeout: 120000 });
    assert.match(replayed.stdout, /be replay ya/u);

    const newspaper = await fs.readFile(path.join(runRoot, "newspaper", `${runId}.pya`), "utf8");
    const newspaperSentences = splitSentences(newspaper, { includeThen: true })
      .filter(line => line.trim())
      .map(line => parse(line.trim()));
    const claimEvokes = newspaperSentences.filter(sentence => sentence?.be === "evoke" && sentence?.ob?.la?.be?.startsWith("claim "));
    assert.deepEqual(claimEvokes.map(sentence => sentence.ob.la.be), ["claim identify", "claim choose"]);
    const resultTexts = newspaperSentences
      .filter(sentence => sentence?.su?.name === "result" && sentence?.be === "text")
      .map(sentence => sentence.ob?.text);
    assert.ok(resultTexts.includes("su name commitment-001 be person ya"));
    const chosenView = resultTexts.map(value => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }).find(value => value?.key === "su name commitment-001 be person ya");
    assert.equal(chosenView?.status, "current");
    assert.match(runResult.stderr, /artifacts folder/u);

    const artifact = newspaperSentences.find(sentence => (
      sentence?.be === "artifact"
        && sentence?.to?.filename?.endsWith("headquarters-contacts-commitments.pya")
    ));
    assert.ok(artifact);
    const artifactPath = path.resolve(runRoot, artifact.to.filename);
    const artifactSource = await fs.readFile(artifactPath, "utf8");
    const artifactSentences = splitSentences(artifactSource, { includeThen: true })
      .filter(line => line.trim())
      .map(line => parse(line.trim()));
    assert.equal(artifactSentences.length, 5);
    const artifactBundle = normalizeLinkedClaimBundle(artifactSentences);
    assert.deepEqual(
      resolveLinkedClaimBundle(artifactBundle),
      resolveLinkedClaimBundle(commitmentBundle({ firstExists: true }))
    );
    forget();
    for (const sentence of artifactSentences) await interpret(sentence);
    const replayedCurrent = await interpret(parse(
      "su name replayed-current ob la su name commitment-001 ob name person-ada be person ya ko be claim choose do"
    ));
    const currentView = JSON.parse(replayedCurrent.value.text);
    assert.equal(currentView.status, "current");
    assert.equal(currentView.record.payload.name, "person-ada");

    await interpret(evidenceLine({
      facet: "person",
      value: "ob name person-charles",
      source: "hq-mail-002 person-ref",
      confidence: 0.8
    }));
    const replayedConflict = await interpret(parse(
      "su name replayed-conflict ob la su name commitment-001 ob name person-ada be person ya ko be claim choose do"
    ));
    const conflictView = JSON.parse(replayedConflict.value.text);
    assert.equal(conflictView.status, "contested");
    assert.equal(conflictView.record, null);
    assert.equal(conflictView.records.length, 2);
    const hash = artifact.fromtext.text;
    const contentAddressed = path.join(runRoot, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.pya`);
    await fs.appendFile(contentAddressed, "tampered\n", "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, replayArgs, { cwd: repoRoot, env: cleanEnv, timeout: 120000 }),
      /hash inconsistency/u
    );
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
});
