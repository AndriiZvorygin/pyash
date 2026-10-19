import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const DIARIZER = fs.readFileSync("/home/htaf/pyash/command/diarize_sentence_srt_from_transcript_folder.mjs", "utf8");
const MEETING_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-andrii-youtube-meeting-from-ref.mjs", "utf8");
const FOLDER_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline-from-meeting-folder.mjs", "utf8");
const PIPELINE = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/run-full-transcript-pipeline.mjs", "utf8");
const OWEN_RUNNER = fs.readFileSync("/home/htaf/pyash/world/house/owen-sound-reporter/program/run-owen-sound-youtube-from-ref.mjs", "utf8");
const OWEN_PIPELINE = fs.readFileSync("/home/htaf/pyash/world/house/owen-sound-reporter/program/run-full-transcript-pipeline.mjs", "utf8");
const GREY_PIPELINE = fs.readFileSync("/home/htaf/pyash/world/house/grey-county-reporter/program/run-full-transcript-pipeline.mjs", "utf8");
const AUTO_ASSIGN = fs.readFileSync("/home/htaf/pyash/command/auto_assign_speakers_from_callouts.mjs", "utf8");

test("interview diarization routes one sentence cue per recognition request", () => {
  assert.match(DIARIZER, /function buildCueLevelTurns\(cues\)/u);
  assert.match(DIARIZER, /const CUE_LEVEL_TURNS = true/u);
  assert.match(DIARIZER, /const turns = buildCueLevelTurns\(workCues\)/u);
  assert.match(DIARIZER, /prevSpeaker: prevSpeaker \|\| null/u);
});

test("cue-level speaker mode propagates through every transcript pipeline wrapper", () => {
  assert.match(MEETING_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(FOLDER_RUNNER, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(PIPELINE, /PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS:/u);
  assert.match(PIPELINE, /PYA_SPEAKER_CUE_LEVEL_TURNS:/u);
  assert.match(OWEN_RUNNER, /PYA_SPEAKER_CUE_LEVEL_TURNS: "1"/u);
  assert.match(MEETING_RUNNER, /looksLikeInterview\(/u);
  assert.match(FOLDER_RUNNER, /looksLikeInterview\(/u);
});

test("sentence-level speaker mode disables aggregate small-panel relabeling", () => {
  assert.match(DIARIZER, /aggregate relabel\/reassign: disabled/u);
  assert.doesNotMatch(DIARIZER, /if \(REASSIGN_PASS_ENABLED/u);
  assert.doesNotMatch(DIARIZER, /reassignReport\s*=\s*applySmallPanelReassign/u);
  assert.match(MEETING_RUNNER, /PYA_SPEAKER_SENTENCE_ONLY/u);
  assert.match(FOLDER_RUNNER, /const cueLevelSpeakerTurns = "1"/u);
  assert.match(PIPELINE, /sentenceLevelSpeakerTurns/u);
  for (const source of [MEETING_RUNNER, FOLDER_RUNNER, PIPELINE, OWEN_RUNNER]) {
    assert.doesNotMatch(source, /PYA_SPEAKER_REASSIGN_PASS/u);
    assert.doesNotMatch(source, /PYA_SPEAKER_RELABEL_MODE/u);
  }
});

test("all civic reporter houses use the shared anonymous sentence policy by default", () => {
  const policy = fs.readFileSync("/home/htaf/pyash/program/library/reporter_shared/speaker-diarization-policy.mjs", "utf8");
  assert.match(policy, /SPEAKER_DIARIZATION_POLICY_VERSION = "sentence-cue-anonymous-v1"/u);
  assert.match(policy, /PYA_SPEAKER_SENTENCE_ONLY: "1"/u);
  assert.match(policy, /PYA_SPEAKER_BAD_SAMPLE_GUARD: "1"/u);
  assert.match(policy, /namedSpeakerIdentityEnabled/u);
  for (const source of [OWEN_PIPELINE, GREY_PIPELINE]) {
    assert.match(source, /buildSentenceDiarizationEnv/u);
    assert.match(source, /speakerArtifactUsesDefaultLabels/u);
    assert.match(source, /skipWhen: \(\) => !namedSpeakerIdentity/u);
  }
  assert.match(DIARIZER, /named_identity_output=\$\{NAMED_IDENTITY_OUTPUT_ENABLED/u);
  assert.match(DIARIZER, /aggregate relabel\/reassign: disabled/u);
  assert.match(AUTO_ASSIGN, /named speaker identity requires explicit verification opt-in/u);
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

test("panel linker treats go-ahead and break announcements as moderator controls", () => {
  const LINKER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/link-panel-speakers-from-transcript-folder.mjs", "utf8");
  const SEGMENTER = fs.readFileSync("/home/htaf/pyash/world/house/andrii-youtube-reporter/program/segment-candidate-answers-from-transcript-folder.mjs", "utf8");
  const RENDERER = fs.readFileSync("/home/htaf/pyash/command/render_transcript_html_from_transcript_folder.mjs", "utf8");
  assert.ok(LINKER.includes("go\\s+ahead"));
  assert.ok(LINKER.includes("take\\s+(?:our\\s+)?(?:first\\s+)?break"));
  assert.match(LINKER, /you are listening to/u);
  assert.match(LINKER, /firstNameCount/u);
  assert.match(SEGMENTER, /firstNames/u);
  assert.doesNotMatch(RENDERER, /span\?\.role === "moderator" && cue\.test\([^)]*\)\) continue/u);
});
