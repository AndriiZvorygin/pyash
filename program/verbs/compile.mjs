import { buildProgram } from "../program.mjs";
import { getMemory, setMemory } from "../memory/index.mjs";

export default async function compile({ obj, sentence }) {
  const sourceName = sentence?.obj?.name ?? obj?.name;
  if (!sourceName) throw new Error("compile: obj.name is required");

  const src = getMemory(sourceName);
  const sourceText = src?.obj?.text ?? src?.text;
  if (typeof sourceText !== "string") {
    throw new Error(`compile: source text not found for "${sourceName}"`);
  }

  const program = buildProgram(sourceText);
  const json = JSON.stringify(program.sentences, null, 2);

  // Decide where to store result: target name (to.name) if provided, else subject name
  const targetName = sentence?.to?.name ?? sentence?.subj?.name;
  if (targetName) {
    const fact = {
      subj: { name: targetName },
      be: sentence?.to?.context === "state" ? sentence.to.context : "text",
      obj: { text: json, sentences: program.sentences },
      mood: "ya",
    };
    setMemory(fact);
  }

  return { obj: { text: json, sentences: program.sentences } };
}
