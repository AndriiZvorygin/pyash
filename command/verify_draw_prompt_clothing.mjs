import fs from "node:fs/promises";
import { parseItineraryPya } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/verify_draw_prompt_clothing.mjs <input.series.pya>";
}

const PERSON_WORDS = [
  "man", "woman", "person", "people", "human", "boy", "girl", "child", "children",
  "father", "mother", "guy", "lady", "citizen", "worker", "farmer", "gardener",
  "teacher", "singer", "singers", "dancer", "dancers"
];

const CLOTHING_WORDS = [
  "shirt", "t-shirt", "blouse", "tunic", "jacket", "coat", "hoodie", "sweater",
  "dress", "robe", "kimono", "pants", "trousers", "jeans", "skirt", "shorts",
  "overalls", "uniform", "boots", "shoes", "sandals", "gloves", "hat", "cap",
  "scarf", "sleeves", "long-sleeve", "long sleeve"
];

const BANNED_WORDS = [
  "nude", "naked", "shirtless", "topless", "barechest", "bare chest", "bare-chest",
  "exposed chest", "exposed breasts", "exposed nipples", "lingerie", "bikini",
  "underwear", "bra only", "panties", "thong", "see-through", "transparent clothing"
];

function splitSentences(text = "") {
  return String(text)
    .split(/[.!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasAnyWord(text = "", words = []) {
  const lower = String(text).toLowerCase();
  return words.some((word) => lower.includes(String(word).toLowerCase()));
}

function verifyPrompt(promptText = "") {
  const issues = [];
  const prompt = String(promptText ?? "").trim();
  if (!prompt) {
    issues.push("empty prompt");
    return issues;
  }

  if (hasAnyWord(prompt, BANNED_WORDS)) {
    issues.push("contains banned nudity/bare-chest wording");
  }

  const sentences = splitSentences(prompt);
  if (!(sentences.length === 3 || sentences.length === 4)) {
    issues.push(`expected 3 or 4 sentences, found ${sentences.length}`);
  }

  const hasPerson = hasAnyWord(prompt, PERSON_WORDS);
  if (hasPerson) {
    if (sentences.length !== 4) {
      issues.push("person scene must have 4 sentences so sentence 2 can define clothing");
    } else {
      const clothingSentence = sentences[1] ?? "";
      if (!hasAnyWord(clothingSentence, CLOTHING_WORDS)) {
        issues.push("sentence 2 does not include concrete clothing words");
      }
      if (hasAnyWord(clothingSentence, BANNED_WORDS)) {
        issues.push("sentence 2 contains banned nudity/bare-chest wording");
      }
    }
  }

  return issues;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  const raw = await fs.readFile(input, "utf8");
  const itinerary = parseItineraryPya(raw);
  const failures = [];

  for (const cut of itinerary.cuts) {
    const prompt = String(cut?.obText ?? "").trim();
    const issues = verifyPrompt(prompt);
    if (issues.length) {
      failures.push({
        name: cut?.name || `cut-${cut?.index ?? "?"}`,
        issues,
        prompt
      });
    }
  }

  if (failures.length) {
    process.stderr.write(`verify_draw_prompt_clothing: failed ${failures.length} prompt(s)\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure.name}: ${failure.issues.join("; ")}\n`);
      process.stderr.write(`  prompt: ${failure.prompt}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`verify_draw_prompt_clothing: ok (${itinerary.cuts.length} prompts)\n`);
}

main().catch((err) => {
  process.stderr.write(`verify_draw_prompt_clothing: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});

