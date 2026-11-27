import fs from "node:fs";

import { RADIO_HEADINGS, SCHEMA_HEADINGS, depthFromHeadings, headingsFromArgument } from "../program/library/learn_card_headings.mjs";

const MEMORY_PHRASE_HEADING = "BRIEF MEMORY PHRASES";
// The house's teaching card keeps its memory phrases short. The radio card's
// phrases are the song's hooks, and a hook may run to eight words.
const FULL_PHRASE_WORD_LIMIT = 6;
const RADIO_PHRASE_WORD_LIMIT = 8;
const TRAILING_MEMORY_CONNECTOR = /\b(?:and|or|but|so|because|if|when|while|than|that|which|who|whom|whose|a|an|the|not|rather|instead|of|by|to|from|with|without|for|in|on|at|as)\s*$/iu;

function sectionListItems(body) {
  return String(body ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function countWords(text) {
  return (String(text ?? "").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu) ?? []).length;
}

function readInput() {
  return fs.readFileSync(0, "utf8");
}

export function validateLearnCard(text, headings = SCHEMA_HEADINGS) {
  const source = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const phraseWordLimit = depthFromHeadings(headings) === "radio" ? RADIO_PHRASE_WORD_LIMIT : FULL_PHRASE_WORD_LIMIT;
  const sections = new Map();
  let currentHeading = "";
  let currentLines = [];

  function flush() {
    if (!currentHeading) return;
    sections.set(currentHeading, currentLines.join("\n").trim());
  }

  for (const line of lines) {
    const heading = String(line ?? "").trim().toUpperCase();
    // The boundaries are always the schema's headings: a card of one depth
    // may still carry the sections of another, and a section ends where the
    // next heading begins whatever headings are being asked for.
    if (SCHEMA_HEADINGS.includes(heading)) {
      flush();
      currentHeading = heading;
      currentLines = [];
      continue;
    }
    if (currentHeading) currentLines.push(line);
  }
  flush();

  for (const heading of headings) {
    if (!sections.has(heading)) {
      return `learn card defective: missing heading ${heading}`;
    }
    const body = String(sections.get(heading) ?? "").trim();
    if (!body || body === "-") {
      return `learn card defective: empty section ${heading}`;
    }
    if (heading === MEMORY_PHRASE_HEADING) {
      const items = sectionListItems(body);
      if (items.length < 4 || items.length > 8) {
        return `learn card defective: ${heading} must contain 4-8 dash list items`;
      }
      for (const item of items) {
        if (!item.startsWith("- ")) {
          return `learn card defective: ${heading} must be a dash list`;
        }
        const phrase = item.slice(2).trim();
        const words = countWords(phrase);
        if (words < 2 || words > phraseWordLimit) {
          return `learn card defective: ${heading} item must be 2-${phraseWordLimit} words`;
        }
        if (TRAILING_MEMORY_CONNECTOR.test(phrase)) {
          return `learn card defective: ${heading} item ends with dangling connector`;
        }
      }
    }
  }
  return "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const defect = validateLearnCard(readInput(), headingsFromArgument(process.argv.slice(2)));
  if (defect) {
    process.stderr.write(`${defect}\n`);
    process.exit(1);
  }
}
