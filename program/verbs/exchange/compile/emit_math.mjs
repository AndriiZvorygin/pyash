import { handleMathConditional } from "./emit_math_conditionals.mjs";
import { handleVectorProduce } from "./emit_math_vector.mjs";
import { handleDateMath } from "./emit_math_date.mjs";
import { handleMathPlus } from "./emit_math/plus.mjs";
import { handleMathSubtract } from "./emit_math/subtract.mjs";
import { handleMathMultiplyDivide } from "./emit_math/multiply_divide.mjs";
import { handleMathRemains } from "./emit_math/remains.mjs";

export function handleMathSentence(context, helpers) {
  const conditional = handleMathConditional(context, helpers);
  if (conditional) return conditional;

  const produce = handleVectorProduce(context, helpers);
  if (produce) return produce;

  const dateMath = handleDateMath(context, helpers);
  if (dateMath) return dateMath;

  const plus = handleMathPlus(context, helpers);
  if (plus) return plus;

  const subtract = handleMathSubtract(context, helpers);
  if (subtract) return subtract;

  const multDiv = handleMathMultiplyDivide(context, helpers);
  if (multDiv) return multDiv;

  const remains = handleMathRemains(context, helpers);
  if (remains) return remains;

  return null;
}
