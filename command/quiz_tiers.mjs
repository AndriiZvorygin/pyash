#!/usr/bin/env node

// Resource tiering for the quiz suite.
//
// A quiz belongs to a tier by what it needs from the machine, not by where it
// sits in the tree:
//
//   t1  needs nothing beyond the repository
//   t2  needs a provisioned resource (wordnet, whisper sample audio, ffmpeg
//       with the drawtext filter)
//   t3  needs a house checkout that the repository does not track
//
// The filesystem and git lookups are injected so the rules can be pinned by a
// quiz without touching the working tree.

export const TIERS = ["t1", "t2", "t3"];

const HOUSE_PROGRAM_PATH = /world\/house\/([^/"'`\s]+)\/program\//gu;

export function detectHouseDependencies(source) {
  const houses = new Set();
  for (const match of String(source || "").matchAll(HOUSE_PROGRAM_PATH)) {
    houses.add(match[1]);
  }
  return [...houses];
}

export function detectRequirements(source, { isTrackedHouse = () => true } = {}) {
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
  return requirements;
}

export function classifyQuizFile(source, options = {}) {
  const requirements = detectRequirements(source, options);
  const house = requirements.some((requirement) => requirement.id === "house");
  const tier = house ? "t3" : requirements.length > 0 ? "t2" : "t1";
  return { tier, requirements };
}
