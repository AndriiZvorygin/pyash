import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  SUMO_ONTOLOGY_COMMIT,
  expandSumoTemplate,
  loadSumoOntology,
  parseSumoDocumentation,
  parseSumoOntology,
  scanSumoForms
} from "../program/library/translation/sumo_ontology.mjs";

const SOURCE = `; a leading comment
(termFormat EnglishWrittenLanguage CompanionateLove "companionate love")
(termFormat EnglishWrittenLanguage Love "love")
(documentation Love EnglishWrittenLanguage "A strong emotion associated with feelings of desire.")
(documentation Love EnglishLanguage "un resumen")
(instance dog Animal)
(subclass CompanionateLove Love)
(subAttribute CompanionateLove Love)
`;

test("SUMO forms split on top level parentheses and skip comments", () => {
  const forms = scanSumoForms(SOURCE);
  assert.equal(forms.length, 7);
  assert.equal(forms[0], '(termFormat EnglishWrittenLanguage CompanionateLove "companionate love")');
  assert.ok(forms.some((form) => form.startsWith("(subclass ")));
});

test("SUMO documentation keeps the English definition only", () => {
  assert.deepEqual(parseSumoDocumentation('(documentation Love EnglishWrittenLanguage "A strong emotion.")'), {
    term: "Love",
    definition: "A strong emotion."
  });
  assert.equal(parseSumoDocumentation('(documentation Love EnglishLanguage "un resumen")'), null);
  assert.equal(parseSumoDocumentation('(subclass CompanionateLove Love)'), null);
});

test("SUMO templates expand to the declared term format", () => {
  const termFormats = new Map([["Attribute", "attribute"], ["Organization", "organization"]]);
  assert.equal(
    expandSumoTemplate("An &%Attribute of an &%Organization.", termFormats),
    "An attribute of an organization."
  );
  assert.equal(expandSumoTemplate("An &%Unknown.", termFormats), "An &%Unknown.");
});

test("SUMO ontology collects surfaces, definitions, and hierarchy edges", () => {
  const ontology = parseSumoOntology([SOURCE]);
  assert.equal(ontology.format, "sumo-ontology-v1");
  assert.equal(ontology.termFormats.get("CompanionateLove"), "companionate love");
  const concept = ontology.concepts.get("CompanionateLove");
  assert.equal(concept.definition, "");
  assert.deepEqual(concept.subclassOf.sort(), ["Love", "Love"]);
  assert.equal(ontology.concepts.get("dog").instances[0], "Animal");
  assert.equal(ontology.concepts.get("Love").definition, "A strong emotion associated with feelings of desire.");
});

test("SUMO ontology refuses a directory that is not a git checkout", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sumo-ontology-"));
  await fs.writeFile(path.join(directory, "x.kif"), "(instance dog Animal)");
  await assert.rejects(
    () => loadSumoOntology({ directory }),
    (error) => error.code === "invalid-sumo-ontology" && /not a git checkout/u.test(error.message)
  );
  await fs.rm(directory, { recursive: true, force: true });
});

test("SUMO ontology refuses a checkout at the wrong revision", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sumo-ontology-"));
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("git", ["init", "-q", directory]);
  await fs.writeFile(path.join(directory, "x.kif"), "(instance dog Animal)");
  await promisify(execFile)("git", ["-C", directory, "add", "."]);
  await promisify(execFile)("git", ["-C", directory, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "x"]);
  await assert.rejects(
    () => loadSumoOntology({ directory }),
    (error) => error.code === "invalid-sumo-ontology" && /pinned revision/u.test(error.message)
  );
  await fs.rm(directory, { recursive: true, force: true });
});

test("SUMO ontology pins one revision", () => {
  assert.match(SUMO_ONTOLOGY_COMMIT, /^[0-9a-f]{40}$/u);
});
