import {
  deriveSignatureFromCall,
  joinSignatureWords,
  lookupSignature,
  lookupSignatureHandler
} from "../../bridge/signature.mjs";
import { syshCaseRegisterForKeyword } from "./sysh_case_registers.mjs";

const NON_CASE_FIELDS = new Set([
  "mood",
  "be",
  "exists",
  "signatureWords",
  "signature",
  "ret",
  "this",
  "consequence",
  "alternative"
]);

export const SYSH_CONTROL_REGISTER_LAYOUT = Object.freeze([
  Object.freeze({ index: 0, name: "verb", field: "be" }),
  Object.freeze({ index: 1, name: "mood", field: "mood" })
]);

export function prepareSyshSentencePattern(sentence, { remember } = {}) {
  const signatureWords = deriveSignatureFromCall(sentence, { remember });
  if (!signatureWords) {
    throw new TypeError("Sysh sentence pattern requires a Pyash verb sentence");
  }

  const caseRegisters = [];
  const unmappedCaseFields = [];
  for (const [keyword, value] of Object.entries(sentence)) {
    if (value === undefined || NON_CASE_FIELDS.has(keyword)) continue;
    const register = syshCaseRegisterForKeyword(keyword);
    if (!register) {
      unmappedCaseFields.push(keyword);
      continue;
    }
    caseRegisters.push(Object.freeze({ ...register, value }));
  }
  caseRegisters.sort((left, right) => left.index - right.index);

  return Object.freeze({
    patternKey: joinSignatureWords(signatureWords),
    signatureWords: Object.freeze([...signatureWords]),
    controlRegisters: Object.freeze(SYSH_CONTROL_REGISTER_LAYOUT.map((register) =>
      Object.freeze({ ...register, value: sentence[register.field] ?? null })
    )),
    caseRegisters: Object.freeze(caseRegisters),
    unmappedCaseFields: Object.freeze(unmappedCaseFields.sort())
  });
}

export function lookupSyshSentencePattern(sentence, options = {}) {
  const pattern = prepareSyshSentencePattern(sentence, options);
  return Object.freeze({
    ...pattern,
    handler: lookupSignatureHandler(pattern.patternKey) ?? null,
    ceremony: lookupSignature(pattern.patternKey) ?? null
  });
}
