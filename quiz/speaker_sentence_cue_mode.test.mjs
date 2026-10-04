import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const DIARIZER = fs.readFileSync("/home/htaf/pyash/command/diarize_sentence_srt_from_transcript_folder.mjs", "utf8");
const MEETING_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-andrii-youtube-meeting-from-ref.mjs", "utf8");
const FOLDER_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline-from-meeting-folder.mjs", "utf8");
const PIPELINE = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline.mjs", "utf8");

test("interview diarization routes one sentence cue per recognition request", () => {
  assert.match(DIARIZER, /function buildCueLevelTurns\(cues\)/u);
  assert.match(DIARIZER, /CUE_LEVEL_TURNS \? buildCueLevelTurns\(workCues\) : buildTurnsFromCues\(workCues\)/u);
  assert.match(DIARIZER, /PYA_SPEAKER_CUE_LEVEL_TURNS/u);
  assert.match(DIARIZER, /prevSpeaker: prevSpeaker \|\| null/u);
});

test("cue-level speaker mode propagates through every transcript pipeline wrapper", () => {
  assert.match(MEETING_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(FOLDER_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(PIPELINE, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(PIPELINE, /PYA_SPEAKER_CUE_LEVEL_TURNS:/u);
  assert.match(MEETING_RUNNER, /looksLikeInterview\(/u);
  assert.match(FOLDER_RUNNER, /looksLikeInterview\(/u);
});

test("panel identity mapping does not apply interview self-introduction aliases globally", () => {
  const RENDERER = fs.readFileSync("/home/htaf/pyash/command/render_transcript_html_from_transcript_folder.mjs", "utf8");
  assert.match(RENDERER, /PYA_INTERVIEW_SPEAKER_ALIASES/u);
  assert.match(RENDERER, /if \(!\/\^\(1\|true\|yes\)\$\/iu\.test\(String\(process\.env\.PYA_INTERVIEW_SPEAKER_ALIASES/u);
});

test("named panel handoffs repair gaps using transcript evidence", () => {
  const LINKER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/link-panel-speakers-from-transcript-folder.mjs", "utf8");
  assert.match(LINKER, /function repairHandoffGaps\(spans, rows\)/u);
  assert.match(LINKER, /Explicit moderator handoff names this candidate/u);
});
