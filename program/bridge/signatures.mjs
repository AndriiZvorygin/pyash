// Signature validation for verbs.
// Each verb can define one or more signatures with required roles
// and oneOf groups (at least one role present).

const verbSignatures = {
  add: [{ required: ["obj", "to"] }],
  subtract: [{ required: ["obj"], oneOf: [["to"], ["from"]] }],
  multiply: [{ required: ["by"], oneOf: [["obj"], ["from"]] }],
  divide: [{ required: ["by"], oneOf: [["obj"], ["from"]] }],
  produce: [{ required: ["by"], oneOf: [["obj"], ["from"]] }],
  invert: [{ required: ["obj"] }],
  exponential: [{ required: ["obj"] }],
  neuron: [{ required: ["from", "by", "fromstate", "to"] }],
  "twice crescent": [{ required: ["obj"] }],
};

function hasRole(sentence, role) {
  const val = sentence?.[role];
  return val !== undefined && val !== null;
}

function checkSignature(sentence, sig) {
  const missing = (sig.required || []).filter(role => !hasRole(sentence, role));
  if (missing.length > 0) {
    return `Missing required role: ${missing[0]}`;
  }

  if (sig.oneOf) {
    const satisfied = sig.oneOf.some(group => group.some(role => hasRole(sentence, role)));
    if (!satisfied) {
      const groups = sig.oneOf.map(g => g.join("/")).join(" or ");
      return `One of [${groups}] is required`;
    }
  }

  return null;
}

export function validateSignature(sentence) {
  const sigs = verbSignatures[sentence.be];
  if (!sigs) return null; // unknown or unregistered verb; let downstream handle it

  for (const sig of sigs) {
    const err = checkSignature(sentence, sig);
    if (!err) return null; // matched
  }

  return `No matching signature for ${sentence.be}`;
}
