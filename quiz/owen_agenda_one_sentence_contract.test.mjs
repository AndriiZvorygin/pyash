import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { verifyAgendaOneSentenceStrictLlm } from "../world/house/owen-sound-reporter/program/run-owen-sound-meeting-from-ref.mjs";
import { generateOneSentenceSummaryLlm } from "../world/house/grey-county-reporter/program/run-full-transcript-pipeline.mjs";

test("Grey full-meeting teaser retries malformed Qwen shape with a fresh LLM contract", async (t) => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "OLLAMA_HOST",
    "PYA_RUNTIME_FILE",
    "PYA_TEXT_MODEL",
    "PYA_GPU_HOUSEKEEPER_URL",
    "GPU_HOUSEKEEPER_URL",
    "PYA_GPU_MANAGER_REQUIRED",
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let calls = 0;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.model, "qwen3.5:9b");
    prompts.push(request.messages[1].content);
    const content = calls === 1
      ? "Too short."
      : "The Committee of the Whole reviewed transit planning, a regional transit study, an official plan approval, and committee minutes during the complete meeting.";
    return {
      ok: true,
      async json() {
        return { message: { content } };
      },
    };
  };
  process.env.OLLAMA_HOST = "http://test-ollama:11434";
  process.env.PYA_RUNTIME_FILE = new URL("../world/house/grey-county-reporter/conduct/runtime.pya", import.meta.url).pathname;
  delete process.env.PYA_TEXT_MODEL;
  delete process.env.PYA_GPU_HOUSEKEEPER_URL;
  delete process.env.GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_MANAGER_REQUIRED = "0";
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  const result = await generateOneSentenceSummaryLlm({
    summaryMd: "The meeting covered the complete chronology, including transit planning, an official plan approval, and committee minutes.",
    hookTitle: "Unified Regional Transit Network",
    jurisdiction: "Grey County",
    body: "Committee of the Whole",
    dateLong: "September 24, 2026",
  });

  assert.equal(calls, 2);
  assert.match(prompts[1], /REJECTION_REASON:.*invalid one-sentence shape/iu);
  assert.match(prompts[1], /PRIOR_REJECTED_CANDIDATE:\s*Too short\./u);
  assert.equal(result, "The Committee of the Whole reviewed transit planning, a regional transit study, an official plan approval, and committee minutes during the complete meeting.");
});

test("Grey full-meeting teaser accepts a complete grounded sentence just above the cosmetic word target", async (t) => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "OLLAMA_HOST",
    "PYA_RUNTIME_FILE",
    "PYA_TEXT_MODEL",
    "PYA_GPU_HOUSEKEEPER_URL",
    "GPU_HOUSEKEEPER_URL",
    "PYA_GPU_MANAGER_REQUIRED",
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  let calls = 0;
  const candidate = "The County Council reviewed transit planning, a regional transit study, an official plan approval, committee minutes, and related public works decisions during its October meeting and discussion of regional priorities and service changes.";
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.model, "qwen3.5:9b");
    return {
      ok: true,
      async json() {
        return { message: { content: candidate } };
      },
    };
  };
  process.env.OLLAMA_HOST = "http://test-ollama:11434";
  process.env.PYA_RUNTIME_FILE = new URL("../world/house/grey-county-reporter/conduct/runtime.pya", import.meta.url).pathname;
  delete process.env.PYA_TEXT_MODEL;
  delete process.env.PYA_GPU_HOUSEKEEPER_URL;
  delete process.env.GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_MANAGER_REQUIRED = "0";
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  const result = await generateOneSentenceSummaryLlm({
    summaryMd: "The meeting covered transit planning, an official plan approval, committee minutes, and related public works decisions.",
    hookTitle: "Regional Transit Network",
    jurisdiction: "Grey County",
    body: "County Council",
    dateLong: "October 8, 2026",
  });

  assert.equal(calls, 1);
  assert.equal(result, candidate);
});

test("Owen one-sentence verifier retries when corrected prose omits a selected topic", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 2) {
      assert.match(request.messages[1].content, /selected agenda topics/u);
      assert.match(request.messages[1].content, /REJECTION_REASON:.*selected agenda topic coverage/u);
      assert.match(request.messages[1].content, /PRIOR_REJECTED_CORRECTED_OUTPUT:/u);
    }
    const corrected = calls === 1
      ? "Council reviews shifting funds from the WSIB Reserve while residents challenge water charges before the committee considers further financial policy changes."
      : "Council reviews parking limits and the WSIB Reserve while residents challenge water charges during the scheduled Committee meeting.";
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ pass: true, corrected, reason: "grounded" }) } };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await verifyAgendaOneSentenceStrictLlm({
    candidateText: "Council reviews parking limits and the WSIB Reserve while residents challenge water charges.",
    sourceTopNews: "8.c.1 Reserves and Reserve Fund Policy Update: The WSIB Reserve is under review. 8.b.1 Parking Management and Enforcement Review: parking limits are under review.",
    sourceSections: "8.c.1 Reserves and Reserve Fund Policy Update\n8.b.1 Parking Management and Enforcement Review",
    selectedItems: [
      { item: "8.c.1", title: "Report CR-26-070 AF016 Reserves and Reserve Fund Policy Update" },
      { item: "8.b.1", title: "Report CR-26-085 Parking Management and Enforcement Review" },
    ],
  });

  assert.equal(calls, 2);
  assert.equal(result.pass, true);
  assert.match(result.corrected, /parking/u);
});

test("Owen agenda teaser retries and gates the complete one-sentence contract", () => {
  const source = fs.readFileSync(
    new URL("../world/house/owen-sound-reporter/program/run-owen-sound-meeting-from-ref.mjs", import.meta.url),
    "utf8",
  );
  const generator = source.slice(
    source.indexOf("async function generateOneSentenceSummaryLlm"),
    source.indexOf("async function rewriteUpcomingAgendaSummaryLlm"),
  );
  const verifier = source.slice(
    source.indexOf("async function verifyAgendaOneSentenceStrictLlm"),
    source.indexOf("async function buildAgendaSummarySourcePath"),
  );

  assert.match(source, /const AGENDA_ONE_SENTENCE_MIN_WORDS = 18/u);
  assert.match(source, /const AGENDA_ONE_SENTENCE_MAX_WORDS = 32/u);
  assert.match(generator, /REJECTED_CANDIDATE:/u);
  assert.match(generator, /numeric fidelity defect/u);
  assert.match(generator, /if \(!defects\.length\) return candidate/u);
  assert.doesNotMatch(generator, /extractLeadingSentence/u);
  assert.match(verifier, /PRIOR_REJECTED_CORRECTED_OUTPUT:/u);
  assert.match(verifier, /numeric fidelity defect/u);
  assert.match(verifier, /isValidAgendaOneSentence\(normalizedCorrected\)/u);
  assert.match(source, /const oneSentenceLocalPass = isValidAgendaOneSentence\(oneSentenceSummary\)/u);
  assert.match(source, /const oneSentencePass = oneSentenceLocalPass/u);

  const agendaPublisher = fs.readFileSync(
    new URL("../command/publish_agenda_to_helpos_from_payload.mjs", import.meta.url),
    "utf8",
  );
  assert.match(agendaPublisher, /loadEnvFallbacks\(process\.cwd\(\), payloadPath\)/u);
  assert.match(agendaPublisher, /path\.dirname\(path\.resolve\(payloadPath\)\)/u);
});

test("affected reporter prose stages keep failed generation retryable", () => {
  const files = [
    "../world/house/owen-sound-reporter/program/run-owen-sound-meeting-from-ref.mjs",
    "../world/house/grey-county-reporter/program/run-grey-county-meeting-from-ref.mjs",
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fallbackMeetingSummaryMd|extractLeadingSentence|No summary available\./u);
    assert.match(source, /job remains retryable/u);
  }

  const greyFullPipeline = fs.readFileSync(
    new URL("../world/house/grey-county-reporter/program/run-full-transcript-pipeline.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(greyFullPipeline, /buildOneSentenceSummary|firstSentence|fallbackLead/u);
  assert.match(greyFullPipeline, /generateOneSentenceSummaryLlm/u);
  assert.match(greyFullPipeline, /requestManagedOllamaChat/u);
  assert.doesNotMatch(greyFullPipeline, /model:\s*["'](?:qwen3\.5:9b|llama3\.2)/iu);

  const picker = fs.readFileSync(new URL("../command/run_next_unposted_story.mjs", import.meta.url), "utf8");
  assert.match(picker, /posted_remote_transcript: true/u);
  assert.match(picker, /posted_transcript: true/u);
});
