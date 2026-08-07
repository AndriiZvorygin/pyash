import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  agendaRoleConstraint,
  splitCivicSentences,
  unsupportedAgendaRoles,
  unsupportedCivicOutcomeVerbs,
} from "../program/library/reporter_shared/civic-sentence-boundaries.mjs";

test("civic sentence boundaries preserve middle initials and municipal abbreviations", () => {
  assert.deepEqual(
    splitCivicSentences(
      "Council received a letter from Michael S. Kerzner and Hon. Rob Flack. The motion carried.",
    ),
    [
      "Council received a letter from Michael S. Kerzner and Hon. Rob Flack.",
      "The motion carried.",
    ],
  );
  assert.deepEqual(
    splitCivicSentences(
      "Zoning By-law Amendment No. 59 concerned the Sydenham Heights proposal.",
    ),
    [
      "Zoning By-law Amendment No. 59 concerned the Sydenham Heights proposal.",
    ],
  );
});

test("Owen whole-meeting recap preserves civic abbreviations and gives retries rejection feedback", () => {
  const source = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /function cleanHeadlineText\(input\)[\s\S]*?splitCivicSentences\(t\)\[0\]/u,
  );
  assert.match(source, /RETRY_FEEDBACK: The prior response was rejected because/u);
  assert.match(source, /PRIOR_REJECTED_OUTPUT:/u);
  assert.match(source, /do not select only its opening sentence/u);
  assert.match(source, /select the central municipal action or topic and one supporting detail/u);
  assert.match(source, /Delete the exact meeting-date phrase/u);
  assert.match(source, /meeting date is article metadata, not SOURCE_ITEM information to preserve/u);
  assert.match(source, /Begin directly with the substantive item action or topic/u);
  assert.match(source, /num_predict: attempt > 1 \? 180 : 110/u);
  assert.doesNotMatch(source, /Council heard\.\.\., considered\.\.\., and adopted/u);
  assert.match(source, /unsupported outcome verb named in that error must be replaced/u);
});

test("generated agenda roles must occur in authoritative structured headings", () => {
  assert.deepEqual(
    unsupportedAgendaRoles(
      "Council heard a deputation about the proposed budget.",
      ["Presentation from the Director of Corporate Services"],
    ),
    ["deputation"],
  );
  assert.deepEqual(
    unsupportedAgendaRoles(
      "Council reviewed the staff presentation and heard Public Forum comments.",
      ["Staff Presentation", "Public Forum"],
    ),
    [],
  );
});

test("agenda role constraints enumerate every role absent from structured headings", () => {
  assert.equal(
    agendaRoleConstraint(["2.a Member Re Upcoming Changes to Recycling"]),
    "Do not use these agenda-role terms: deputation, presentation, public forum, public meeting.",
  );
  assert.equal(
    agendaRoleConstraint(["6 Deputations and Presentations"]),
    "Do not use these agenda-role terms: public forum, public meeting.",
  );
});

test("whole-meeting decision verbs must be grounded in the selected recap items", () => {
  assert.deepEqual(
    unsupportedCivicOutcomeVerbs(
      "Council reviewed the police budget and adopted the confirming bylaw.",
      [
        "The police service presented its draft budget.",
        "Council adopted By-law 2026-006.",
      ],
    ),
    [],
  );
  assert.deepEqual(
    unsupportedCivicOutcomeVerbs(
      "Council approved the police request.",
      ["The police service presented its draft budget."],
    ),
    ["approved"],
  );
});
