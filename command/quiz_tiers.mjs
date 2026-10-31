#!/usr/bin/env node

// Resource tiering for the quiz suite.
//
// A quiz belongs to a tier by what it needs from the machine, not by where it
// sits in the tree:
//
//   t1  needs nothing beyond the repository
//   t2  needs a provisioned resource (wordnet, whisper sample audio, ffmpeg
//       with the drawtext filter, the pyachso2n sibling checkout, a python
//       speaker worker)
//   t3  needs a house checkout that the repository does not track
//
// The filesystem and git lookups are injected so the rules can be pinned by a
// quiz without touching the working tree.

export const TIERS = ["t1", "t2", "t3"];

// A house dependency is a relative module path that points into a house
// program folder. A fixture string that merely mentions a house path is not a
// dependency on that house being present, and a template placeholder is not a
// house name.
const HOUSE_PROGRAM_PATH = /(?:\.\.\/|\.\/)[^"'\s]*world\/house\/([^/"'`\s{}]+)\/program\//gu;

// The translation subsystem reads its dictionary and glyph word lists from the
// pyachso2n checkout that sits next to this repository, so a quiz that
// exercises that surface needs the sibling checkout to be present.
const SIBLING_REPO_PATTERN = /pyachso2n|english30k|vocab|pyac_complexity|16GlyphWordList/iu;
const SIBLING_REPO_FILE_NAME = /^(?:translation_|vocab_)/u;

// The speaker identity module drives a python worker.
const PYTHON_WORKER_PATTERN = /speaker_worker\.py|speaker_identity|PYA_PYTHON_BIN/u;

export function detectHouseDependencies(source) {
  const houses = new Set();
  for (const match of String(source || "").matchAll(HOUSE_PROGRAM_PATH)) {
    houses.add(match[1]);
  }
  return [...houses];
}

export function detectRequirements(source, { isTrackedHouse = () => true, fileName = "" } = {}) {
  const text = String(source || "");
  const requirements = [];
  for (const house of detectHouseDependencies(text)) {
    if (isTrackedHouse(house)) continue;
    requirements.push({ id: "house", detail: house });
  }
  if (/know\/wordnet/u.test(text) || /english_wordnet/u.test(text)) {
    requirements.push({ id: "wordnet", detail: "open english wordnet 2025" });
  }
  if (/caterer\/whisper\.cpp/u.test(text) || /jfk\.wav/u.test(text)) {
    requirements.push({ id: "whisper", detail: "whisper.cpp sample audio" });
  }
  if (/cover-overlay-stage/u.test(text)) {
    requirements.push({ id: "ffmpeg-drawtext", detail: "ffmpeg with drawtext" });
  }
  if (SIBLING_REPO_PATTERN.test(text) || SIBLING_REPO_FILE_NAME.test(String(fileName || ""))) {
    requirements.push({ id: "sibling-repo", detail: "pyachso2n checkout" });
  }
  if (PYTHON_WORKER_PATTERN.test(text)) {
    requirements.push({ id: "python-worker", detail: "python speaker worker" });
  }
  return requirements;
}

export function classifyQuizFile(source, options = {}) {
  const requirements = detectRequirements(source, options);
  const house = requirements.some((requirement) => requirement.id === "house");
  const tier = house ? "t3" : requirements.length > 0 ? "t2" : "t1";
  return { tier, requirements };
}
