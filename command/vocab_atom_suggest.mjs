import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildAtomWordProposal,
  loadAtomWordGenerationInputs
} from "../program/verbs/exchange/translation/atom_word_generation.mjs";

export async function runAtomWordSuggestion(args = process.argv.slice(2), {
  report = console.log,
  loadInputs = loadAtomWordGenerationInputs
} = {}) {
  const concept = args.join(" ").trim();
  if (!concept) throw new Error("usage: node command/vocab_atom_suggest.mjs <english concept>");
  const inputs = await loadInputs();
  const proposal = buildAtomWordProposal({
    concept,
    ...inputs,
    existingEntries: pyashWords,
    reservedEntries: inputs.reservedEntries
  });
  report(JSON.stringify(proposal, null, 2));
  return proposal;
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runAtomWordSuggestion().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}

