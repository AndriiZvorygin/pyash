import { throwErrorSentence } from "../error.mjs";
import { evaluateBooleanClause } from "./boolean_clause.mjs";

export async function orVerb(sentence, runtime) {
  const first = await evaluateBooleanClause(sentence?.ob?.la, runtime);
  if (first === null) {
    throwErrorSentence({
      name: "or defective",
      message: "or defective",
      from: { name: "or" },
      raw: { sentence }
    });
  }
  if (first) {
    return { ob: { boolean: true }, be: "or" };
  }
  const second = await evaluateBooleanClause(sentence?.with?.la, runtime);
  if (second === null) {
    throwErrorSentence({
      name: "or defective",
      message: "or defective",
      from: { name: "or" },
      raw: { sentence }
    });
  }
  return { ob: { boolean: Boolean(second) }, be: "or" };
}

export default orVerb;

export const signatures = [
  { signatureWords: ["be", "or", "ob", "la", "with", "la"], handler: orVerb }
];
