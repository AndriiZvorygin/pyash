import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const DIARIZER = fs.readFileSync("/home/htaf/pyash/command/diarize_sentence_srt_from_transcript_folder.mjs", "utf8");
const MEETING_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-andrii-youtube-meeting-from-ref.mjs", "utf8");
const FOLDER_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline-from-meeting-folder.mjs", "utf8");
const PIPELINE = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline.mjs", "utf8");

test("interview diarization routes one sentence cue per recognition request", () => {
  assert.match(DIARIZER, /function buildCueLevelTurns\(cues\)/u);
  assert.match(DIARIZER, /TWO_SPEAKER_CUE_TURNS \? buildCueLevelTurns\(workCues\) : buildTurnsFromCues\(workCues\)/u);
  assert.match(DIARIZER, /prevSpeaker: prevSpeaker \|\| null/u);
});

test("cue-level speaker mode propagates through every transcript pipeline wrapper", () => {
  assert.match(MEETING_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(FOLDER_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(PIPELINE, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(MEETING_RUNNER, /looksLikeInterview\(/u);
  assert.match(FOLDER_RUNNER, /looksLikeInterview\(/u);
});
