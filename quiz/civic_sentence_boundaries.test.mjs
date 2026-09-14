import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  agendaRoleConstraint,
  extractCivicLeadingSentence,
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
  assert.equal(
    extractCivicLeadingSentence(
      "On September 1, 2026 at 3:00 PM, staff will present severance applications. - **Application File No. B10-2026:**",
    ),
    "On September 1, 2026 at 3:00 PM, staff will present severance applications.",
  );
  assert.equal(
    extractCivicLeadingSentence("Zoning By-law Amendment No. 59 concerns the proposal."),
    "Zoning By-law Amendment No. 59 concerns the proposal.",
  );
  assert.equal(
    extractCivicLeadingSentence(
      "The application requests a minor variance increasing lot frontage from 10.0 metres to 11.30 metres while maintaining R5 zoning compliance.",
    ),
    "The application requests a minor variance increasing lot frontage from 10.0 metres to 11.30 metres while maintaining R5 zoning compliance.",
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

  const agendaSource = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/run-owen-sound-meeting-from-ref.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(agendaSource, /extractCivicLeadingSentence/u);
  assert.match(agendaSource, /REJECTION_REASON:/u);
  assert.match(agendaSource, /candidateText: llmOneSentence \|\| oneSentenceSummary/u);
  assert.doesNotMatch(agendaSource, /function buildAgendaOneSentenceFallback/u);
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
  assert.deepEqual(
    unsupportedAgendaRoles(
      "Council held the statutory public meeting for the amendment.",
      [
        "5.a Official Plan Amendment No. 14",
        "The statutory public meeting for the amendment gathered public input.",
      ],
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
