import { throwErrorSentence } from "../error.mjs";
import { evaluateBooleanClause } from "./boolean_clause.mjs";

export async function andVerb(sentence, runtime) {
  const first = await evaluateBooleanClause(sentence?.ob?.la, runtime);
  if (first === null) {
    throwErrorSentence({
      name: "and defective",
      message: "and defective",
      from: { name: "and" },
      raw: { sentence }
    });
  }
  if (!first) {
    return { ob: { boolean: false }, be: "and" };
  }
  const second = await evaluateBooleanClause(sentence?.with?.la, runtime);
  if (second === null) {
    throwErrorSentence({
      name: "and defective",
      message: "and defective",
      from: { name: "and" },
      raw: { sentence }
    });
  }
  return { ob: { boolean: Boolean(second) }, be: "and" };
}

export default andVerb;

export const signatures = [
  { signatureWords: ["be", "and", "ob", "la", "with", "la"], handler: andVerb }
];
