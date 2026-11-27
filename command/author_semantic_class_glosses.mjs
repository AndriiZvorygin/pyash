#!/usr/bin/env node
// Add authored English glosses for the semantic noun classes and the typological
// terms neither dictionary defines.
//
// The `_gender_` atoms are not corrupt: `galaxy_gender` is the noun class whose
// members are galaxies, `wise_gender` the one for wisdom, `zoic_gender` the one
// for animals. The Chinese source glosses (`星系 性别`, `宙 性别`) are faithful
// word-by-word renderings of exactly that idea — semantic noun class — not a bad
// split. Read as "the class of X", they are coherent and useful.
//
// The other terms are ordinary typological vocabulary. Wikipedia carries 18 of
// the 30 as standalone articles; the rest are described inside broader articles
// (locative case, near future, topic-prominent language). Their glosses below are
// written from those articles, in the same one-sentence style as the Wiktionary
// entries already in the volume.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const GLOSSES_PATH = path.resolve(moduleDirectory, "../program/library/translation/curated_glosses.pya");

// Semantic noun classes: the class of things whose members are <X>.
const NOUN_CLASSES = {
  abstract_gender_: "a noun class whose members are abstract concepts rather than physical things",
  animate_gender_: "a noun class whose members are living beings",
  anthropic_gender_: "a noun class whose members are human beings",
  artistic_gender_: "a noun class whose members are works of art and creative products",
  choice_gender_: "a noun class marking a selection made among alternatives",
  common_gender_: "a noun class containing both masculine and feminine nouns, distinguished only by agreement",
  feminine_gender_: "a noun class whose members take feminine agreement",
  galaxy_gender_: "a noun class whose members are galaxies",
  inanimate_gender_: "a noun class whose members are non-living things",
  locality_gender_: "a noun class whose members are places and locations",
  love_gender_: "a noun class whose members are affections and bonds of attachment",
  masculine_gender_: "a noun class whose members take masculine agreement",
  mineral_gender_: "a noun class whose members are minerals and stone",
  planetary_gender_: "a noun class whose members are planets",
  rational_gender_: "a noun class whose members are beings capable of reason",
  research_gender_: "a noun class whose members are inquiries and studies",
  star_gender_: "a noun class whose members are stars",
  universe_gender_: "a noun class whose members are universes",
  vegetal_gender_: "a noun class whose members are plants",
  vehicle_gender_: "a noun class whose members are vehicles",
  wise_gender_: "a noun class whose members are wisdom and sound judgement",
  zoic_gender_: "a noun class whose members are animals"
};

// Typological terms with no Wiktionary entry. Each gloss follows the Wikipedia
// article's own opening, condensed to one sentence.
const TYPOLOGY = {
  admonitive_mood_: "a mood warning the hearer against something, expressing that the action is to be avoided",
  allocutive_agreement_: "agreement that marks a verb for the social rank or gender of the addressee rather than for an argument",
  assumptive_mood_: "a mood presenting the statement as an assumption the speaker takes for granted",
  centric_case_: "a case marking the thing around which the predicate's other participants are arranged",
  continutive_aspect_: "an aspect continuing an action already under way from a prior situation",
  deliberative_mood_: "a mood posing a question the speaker is reasoning through rather than asking the hearer",
  delimitative_aspect_: "an aspect marking an action as lasting only briefly or as bounded to a short stretch",
  deontic_mood_: "a mood expressing obligation or permission rather than fact",
  destination_case_: "a case marking the place or thing toward which motion proceeds",
  dubitative_mood_: "a mood presenting the statement as uncertain or doubted",
  epistemic_mood_: "a mood marking the speaker's degree of confidence in the statement's truth",
  floating_point_number_: "a number stored as a sign, a significand, and an exponent, so it can represent a wide range of magnitudes at limited precision",
  hesternal_tense_: "a tense placing the event on the day before the day of speaking",
  inductive_mood_: "a mood presenting a conclusion drawn from particular observations rather than stated as fact",
  initiative_case_: "a case marking the participant who initiates an action, distinct from the one who completes it",
  location_case_: "a case marking the place where the action occurs",
  locative_directional_case_: "a case marking motion with respect to a place, combining location with direction",
  pegative_case_: "a case marking the recipient in a clause whose verb assigns a thing to that recipient",
  possessed_case_: "a case marking the thing possessed rather than its possessor",
  recent_past_tense_: "a tense placing the event in the immediate past, earlier on the day of speaking",
  remote_future_tense_: "a tense placing the event in the distant future, beyond the near future",
  remote_past_tense_: "a tense placing the event in the distant past, before the remembered past",
  retrospective_aspect_: "an aspect viewing a situation from the standpoint of its aftermath",
  soon_future_tense_: "a tense placing the event in the immediate future, later on the day of speaking",
  source_case_: "a case marking the place or thing from which motion proceeds",
  speculative_mood_: "a mood presenting the statement as a guess about what may or will be the case",
  topic_case_: "a case marking the clause's topic, the thing the statement is about",
  vialis_case_: "a case marking the route along which motion proceeds",
  way_case_: "a case marking the path a motion follows, synonymous with the vialis"
};

// Terms where Wiktionary's stem falls on a different sense, or has nothing. A
// naive stem lookup returns "affirmative: an answer showing agreement" for the
// mood, and "exclusive: a restrictive word such as only", neither of which is the
// grammatical category. These are written out instead.
const STEM_MISMATCH = {
  affirmative_mood_: "a mood affirming that the proposition holds, as opposed to negating it",
  exclusive_person_: "a first-person plural form that excludes the person addressed",
  inclusive_person_: "a first-person plural form that includes the person addressed",
  locative_case_: "a case marking the place where the action occurs",
  plural_number_: "a number marking more than one referent",
  paucal_number_: "a number marking a small countable quantity, more than a few but fewer than many",
  multal_number_: "a number marking a large quantity, contrasted with the paucal",
  singulative_number_: "a number marking one member singled out of a collective or mass",
  optative_mood_: "a mood expressing a wish for the event to occur",
  jussive_mood_: "a mood expressing a command directed at a third person rather than the hearer",
  interrogative_mood_: "a mood marking the clause as a question",
  necessitative_mood_: "a mood expressing that the event must occur",
  volitive_mood_: "a mood expressing the speaker's will that the event occur",
  permissive_mood_: "a mood granting permission for the event",
  declarative_mood_: "a mood presenting the clause as a statement of fact",
  hortative_mood_: "a mood encouraging the hearer to act, weaker than a command",
  perlative_case_: "a case marking the path across or through which motion proceeds",
  reciprocal_voice_: "a voice marking that two participants act on each other",
  reflexive_voice_: "a voice marking that the agent acts on itself",
  prohibitive_mood_: "a mood forbidding the event, the negative counterpart of the imperative",
  precative_mood_: "a mood expressing a request or entreaty",
  propositive_mood_: "a mood proposing a course of action for the group to take",
  quotative_case_: "a case marking the material being quoted or reported",
  superlative_case_: "a case marking the thing compared against in a superlative construction",
  to_case_: "a case marking the destination or goal of motion",
  patient_case_: "a case marking the participant affected by the action",
  causal_case_: "a case marking the cause or reason for the action",
  agentive_case_: "a case marking the participant who performs the action",
  telic_aspect_: "an aspect presenting the action as directed toward a goal or endpoint",
  atelic_aspect_: "an aspect presenting the action as having no inherent endpoint",
  completive_aspect_: "an aspect presenting the action as carried through to completion",
  cessative_aspect_: "an aspect marking the cessation of an action",
  inchoative_aspect_: "an aspect marking the beginning of an action or state",
  momentane_aspect_: "an aspect presenting the action as a single brief instant",
  prospective_aspect_: "an aspect presenting the event as about to happen",
  crastinal_tense_: "a tense placing the event on the day after the day of speaking",
  historic_tense_: "a tense used for narrating past events, typical of chronicle style",
  evidential_case_: "a case marking the source of the speaker's information",
  exocentric_case_: "a case whose meaning is not derived from any single component of the construction",
  postpositional_case_: "a case expressed by a postposition rather than by inflection",
  adpositional_case_: "a case expressed by an adposition, whether preposition or postposition",
  applicative_voice_: "a voice promoting an oblique participant to a core argument role",
  benefactive_case_: "a case marking the participant for whose benefit the action occurs",
  apprehensive_mood_: "a mood expressing fear that the event may occur",
  benedictive_mood_: "a mood expressing a blessing or good wish",
  desiderative_mood_: "a mood expressing a desire for the event",
  directive_mood_: "a mood directing the hearer to act",
  eventive_mood_: "a mood presenting the event as actually occurring rather than as possible or wished",
  gnomic_aspect_: "an aspect presenting a statement as generally true rather than tied to a particular occasion",
  gnomic_mood_: "a mood presenting a statement as a general truth",
  imprecative_mood_: "a mood expressing a curse or malediction",
};

const targetPath = GLOSSES_PATH;
const volumePath = path.resolve(path.dirname(targetPath), "../dictionary/reference.pyac");
const source = await fs.readFile(targetPath, "utf8");
const lines = source.split("\n");
// The map key is the Pyash spelling, not the English label: the builder reads the
// key as the atom sequence. Resolve each English term to its Pyac atom first.
const existing = new Set(
  lines
    .map((line) => line.match(/^su text "([a-z0-9_ ]+)" ob text /u)?.[1])
    .filter(Boolean)
);
const prahIndex = lines.findLastIndex((line) => line.trim() === "prah");
if (prahIndex < 0) throw new Error("curated glosses has no closing prah");

const { execFileSync } = await import("node:child_process");
const binary = path.resolve(moduleDirectory, "../rust/pyac/target/release/pyac-dictionary");
/**
 * Resolve an English atom label to its Pyac spelling.
 *
 * `surface-entries` returns codelets rather than keys, so the spelling is read
 * from slot 2 of the first codelet — the word after the `gi` name marker, which
 * is how every entry record begins.
 */
const { decodePyacWord } = await import("../program/library/vliw/word_code.mjs");
const resolveAtom = (english) => {
  const out = execFileSync(binary, ["surface-entries", volumePath, "en", english], {
    encoding: "utf8",
    maxBuffer: 1 << 26
  });
  const spellings = [];
  for (const match of JSON.parse(out).matches ?? []) {
    const first = match.codelets?.[0];
    if (!first || first[1] !== 0x225e) continue;
    const spelling = decodePyacWord(first[2]);
    if (spelling && !spelling.includes(" ")) spellings.push(spelling);
  }
  return spellings.length ? spellings[0] : null;
};

const ordered = Object.entries({ ...NOUN_CLASSES, ...TYPOLOGY, ...STEM_MISMATCH })
  .sort(([a], [b]) => a.localeCompare(b));
const added = [];
const unresolved = [];
for (const [label, gloss] of ordered) {
  // Query the label verbatim. Stripping the trailing underscore matches the
  // derived `initiative_case` entry as well as the placeholder `initiative_case_`
  // and returns the wrong atom.
  const pyac = resolveAtom(label);
  if (!pyac) { unresolved.push(label); continue; }
  if (existing.has(pyac)) continue;
  added.push(`su text ${JSON.stringify(pyac)} ob text ${JSON.stringify(gloss)} ya`);
}
lines.splice(prahIndex, 0, ...added);
await fs.writeFile(targetPath, lines.join("\n"));
console.log(`added ${added.length} glosses (${Object.keys(NOUN_CLASSES).length} noun classes, ${Object.keys(TYPOLOGY).length} typology, ${Object.keys(STEM_MISMATCH).length} stem mismatches)`);
if (unresolved.length) console.log(`unresolved: ${unresolved.join(" ")}`);
