import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildGrammarWordProposal,
  loadAtomWordGenerationInputs
} from "../program/library/translation/atom_word_generation.mjs";

export async function runGrammarWordSuggestion(args = process.argv.slice(2), {
  report = console.log,
  loadInputs = loadAtomWordGenerationInputs
} = {}) {
  const sourceConcept = args.join(" ").trim();
  if (!sourceConcept) throw new Error("usage: node command/vocab_grammar_suggest.mjs <english concept>");
  const inputs = await loadInputs();
  const proposal = buildGrammarWordProposal({
    concept: `${sourceConcept}_`,
    sourceConcept,
    ...inputs,
    existingEntries: pyashWords,
    reservedEntries: inputs.reservedEntries
  });
  report(JSON.stringify(proposal, null, 2));
  return proposal;
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runGrammarWordSuggestion().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
