import { throwErrorSentence } from "../error.mjs";
import { evaluateBooleanClause } from "./boolean_clause.mjs";

export async function notVerb(sentence, runtime) {
  const clause = sentence?.ob?.la;
  const value = await evaluateBooleanClause(clause, runtime);
  if (value === null) {
    throwErrorSentence({
      name: "not defective",
      message: "not defective",
      from: { name: "not" },
      raw: { sentence }
    });
  }
  return { ob: { boolean: !value }, be: "not" };
}

export default notVerb;

export const signatures = [
  { signatureWords: ["be", "not", "ob", "la"], handler: notVerb }
];
