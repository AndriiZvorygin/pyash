import { throwErrorSentence } from "../error.mjs";
import {
  formatCompositionalValidationReport,
  validateCompositionalCases
} from "../library/compositional_case_validation.mjs";

export function verifyHnucGrammar(_sentence, options = {}) {
  const result = validateCompositionalCases(options);
  const report = formatCompositionalValidationReport(result);
  if (!result.ok) {
    throwErrorSentence({
      name: "hnuc grammar defective",
      message: `hnuc grammar defective\n${report}`,
      from: { name: "verify hnuc grammar" },
      raw: result
    });
  }
  const { contexts, mappings, assignedCodes, knownUnassigned, warnings } = result.summary;
  return {
    ob: {
      text: [
        `hnuc grammar verified: contexts=${contexts} mappings=${mappings} assigned codes=${assignedCodes} known unassigned codes=${knownUnassigned} warnings=${warnings}`,
        ...result.warnings.map(item => `${item.path}: ${item.message}`)
      ].join("\n")
    },
    be: "text"
  };
}

export default verifyHnucGrammar;

export const signatures = [
  { signatureWords: ["be", "verify hnuc grammar"], handler: verifyHnucGrammar }
];
