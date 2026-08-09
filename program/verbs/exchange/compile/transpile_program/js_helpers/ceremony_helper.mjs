export function ceremonyHelperSource() {
  return `function pyaCeremonyTypeWords(value, caseName) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.length ? pyaCeremonyTypeWords(value[0], caseName) : [];
  if (value.nameTypeWords?.length) return ["name", ...value.nameTypeWords];
  if (caseName === "to" && value.su?.name && value.ob) {
    if (value.ob.num !== undefined) return ["name", "num"];
    if (value.ob.text !== undefined) return ["name", "text"];
    if (value.ob.boolean !== undefined) return ["name", "bool"];
    return ["name", "num"];
  }
  if (value.num !== undefined) return ["num"];
  if (value.text !== undefined) return ["text"];
  if (value.filename !== undefined) return ["filename"];
  if (value.boolean !== undefined) return ["bool"];
  if (value.name !== undefined) return ["name", "num"];
  if (value.ob?.num !== undefined) return ["num"];
  if (value.ob?.text !== undefined) return ["text"];
  return [];
}

function pyaCeremonySignature(sentence) {
  const ignored = new Set(["mood", "be", "exists", "signatureWords", "signature", "ret", "this", "consequence", "alternative", "su", "fromindex", "toindex", "atindex"]);
  const cases = Object.entries(sentence || [])
    .filter(([key, value]) => value !== undefined && !ignored.has(key) && !((key === "by" || key === "atindex") && value?.register))
    .map(([key, value]) => [key, pyaCeremonyTypeWords(value, key)])
    .filter(([, typeWords]) => typeWords.length)
    .sort(([left], [right]) => left.localeCompare(right));
  return ["be", sentence?.be || "", ...cases.flatMap(([key, typeWords]) => [key, ...typeWords])].join(" ");
}

function pyaAssertCeremonySignature(sentence, expected) {
  if (sentence?.atindex?.register === true) return;
  const actual = pyaCeremonySignature(sentence);
  if (actual === expected) return;
  const error = new Error("Ceremony signature inconsistency: expected " + expected + ", got " + actual);
  error.name = "signature inconsistency";
  error.sentence = {
    mood: "do",
    be: "error",
    su: { name: "signature inconsistency" },
    ob: { text: error.message },
    from: { name: "compile" }
  };
  throw error;
}`;
}
