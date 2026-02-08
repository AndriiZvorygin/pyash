function resolveValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value.text === "string") return value.text;
  if (typeof value.num === "number") return String(value.num);
  if (typeof value.boolean === "boolean") return value.boolean ? "truth" : "lie";
  if (typeof value.value === "string") return value.value;
  return "";
}

function parsePattern(rawPattern) {
  const source = String(rawPattern ?? "");
  const slash = source.match(/^\/([\s\S]*)\/([a-z]*)$/u);
  if (slash) {
    try {
      return new RegExp(slash[1], slash[2]);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(source, "iu");
  } catch {
    return null;
  }
}

export function resemble_subj_text_from_text({ su, ob, from }) {
  const subject = resolveValue(ob ?? su);
  const patternText = resolveValue(from);
  const pattern = parsePattern(patternText);
  if (!pattern) return false;
  return pattern.test(subject);
}

export const resemble = resemble_subj_text_from_text;

export const signatures = [
  { signatureWords: ["be", "resemble", "from", "text"], handler: resemble_subj_text_from_text },
  { signatureWords: ["be", "resemble", "from", "text", "ob", "text"], handler: resemble_subj_text_from_text },
  { signatureWords: ["be", "resemble", "from", "text", "ob", "name", "text"], handler: resemble_subj_text_from_text },
  { signatureWords: ["be", "resemble", "from", "name", "text"], handler: resemble_subj_text_from_text },
  { signatureWords: ["be", "resemble", "from", "name", "text", "ob", "text"], handler: resemble_subj_text_from_text },
  { signatureWords: ["be", "resemble", "from", "name", "text", "ob", "name", "text"], handler: resemble_subj_text_from_text }
];

