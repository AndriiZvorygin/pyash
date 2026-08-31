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
import {
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
    evidenceLine({ facet: "commitment", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "organization", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "due-date", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "work", value: "ob name work-fixture-mail-001" })
  ];

  const bundle = normalizeLinkedClaimBundle(sentences);

  assert.equal(bundle.subjectKey, "su name commitment-001");
  assert.deepEqual(Object.keys(bundle.facets), [
    "commitment",
    "person",
    "organization",
    "due-date",
    "work"
  ]);
  assert.equal(bundle.facets["due-date"].records[0].payload.date, "2026-08-24");
  assert.equal(bundle.facets["due-date"].records[0].key, "su name commitment-001 be due-date ya");
  assert.equal(bundle.facets["due-date"].records[0].anchorId, "hq-mail-001#paragraph-1");
  assert.ok(sentences.every(sentence => !sentence.ob.map));

  assert.throws(
    () => normalizeLinkedClaimBundle([
      evidenceLine({
        facet: "due-date",
        value: "ob date 2026-08-24 since date 2026-08-01 until date 2026-08-31"
      })
    ]),
    /belongs in ob date/u
  );
});

test("headquarters contacts and relationships use the same linked-claim contract", () => {
  const contact = normalizeLinkedClaimBundle([
    evidenceLine({ subject: "person-ada", facet: "person", value: `ob text ${JSON.stringify("Ada Lovelace")}` }),
    evidenceLine({ subject: "person-ada", facet: "contact-method", value: `ob text ${JSON.stringify("ada@example.test")}` })
  ]);
  const relationship = normalizeLinkedClaimBundle([
    evidenceLine({ subject: "relationship-ada-analytical", facet: "relationship", value: `ob text ${JSON.stringify("works with")}` }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "person", value: "ob name person-ada" }),
    evidenceLine({ subject: "relationship-ada-analytical", facet: "organization", value: "ob name analytical-engine" })
  ]);

  assert.equal(contact.subjectKey, "su name person-ada");
  assert.deepEqual(Object.keys(contact.facets), ["person", "contact-method"]);
  assert.equal(relationship.subjectKey, "su name relationship-ada-analytical");
  assert.deepEqual(Object.keys(relationship.facets), ["relationship", "person", "organization"]);
});

test("headquarters bundle conflicts stay facet-local and preserve source evidence", () => {
  const current = [
    evidenceLine({ facet: "commitment", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, source: "hq-mail-001 paragraph-1" }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace", source: "hq-mail-001 paragraph-2" }),
    evidenceLine({ facet: "organization", value: "ob name analytical-engine", source: "hq-mail-001 paragraph-3" }),
    evidenceLine({ facet: "due-date", value: "ob date 2026-08-24", source: "hq-mail-001 paragraph-4" }),
    evidenceLine({ facet: "work", value: "ob name work-fixture-mail-001", source: "hq-mail-001 paragraph-5" })
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
  assert.equal(view.facets.organization.status, "current");
  assert.equal(view.facets["due-date"].status, "current");
  assert.equal(view.facets.work.status, "current");
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
    evidenceLine({ facet: "commitment", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "organization", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "due-date", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "work", value: "ob name work-fixture-mail-001" })
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
    evidenceLine({ facet: "commitment", value: `ob text ${JSON.stringify("Prepare the decision packet")}`, exists: true }),
    evidenceLine({ facet: "person", value: "ob name ada-lovelace" }),
    evidenceLine({ facet: "organization", value: "ob name analytical-engine" }),
    evidenceLine({ facet: "due-date", value: "ob date 2026-08-24" }),
    evidenceLine({ facet: "work", value: "ob name work-fixture-mail-001" })
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
      parse("exists su name commitment-001 ob date 2026-08-24 accordingto name direct-evidential by num 0.9 be due-date ya")
    ]),
    /source anchor defective/u
  );

  assert.throws(
    () => normalizeLinkedClaimBundle([
      evidenceLine({ facet: "due-date", value: "ob date 2026-08-24" }),
      evidenceLine({ subject: "other-commitment-001", facet: "work", value: "ob name work-fixture-mail-001", source: "other-subject paragraph-1" })
    ]),
    /stable su identifier/u
  );
});

test("ordinary Knowledge Core claim identity remains the facet contract", () => {
  const dueDate = evidenceLine({ facet: "due-date", value: "ob date 2026-08-24" });
  assert.equal(deriveClaimKey(dueDate), "su name commitment-001 be due-date ya");
});
