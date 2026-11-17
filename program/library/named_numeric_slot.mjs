export const MUTABLE_NUMERIC_SLOT_MARKER = "variable";
export const CONSTANT_NUMERIC_SLOT_MARKER = "permanently number";

export function namedNumericSlotKind(fact) {
  const marker = fact?.as?.name;
  if (marker === MUTABLE_NUMERIC_SLOT_MARKER) return "variable";
  if (marker === CONSTANT_NUMERIC_SLOT_MARKER) return "constant";
  return null;
}

export function isNamedNumericSlotDeclaration(sentence) {
  return Boolean(
    sentence?.mood === "ya"
    && sentence?.su?.name
    && (sentence.be === "number" || sentence.be === "num")
    && Number.isInteger(sentence.ob?.num)
    && sentence.ob.num >= 0
    && sentence.ob.num <= 0xffff
    && namedNumericSlotKind(sentence)
  );
}

export function namedNumericSlotValueError(fact, sentence) {
  if (namedNumericSlotKind(fact) !== "variable") return null;
  const compatible =
    (sentence?.be === "number" || sentence?.be === "num")
    && Number.isInteger(sentence?.ob?.num)
    && sentence.ob.num >= 0
    && sentence.ob.num <= 0xffff;
  return compatible ? null : "numeric variable slot requires an unsigned 16-bit number";
}

export function namedNumericSlotWriteError(fact, sentence) {
  if (namedNumericSlotKind(fact) !== "variable") return null;
  if (sentence?.mood === "do") {
    const types = sentence.to?.nameTypeWords ?? [];
    const compatible = types.length === 1 && ["num", "number"].includes(types[0]);
    return compatible ? null : "numeric variable writes require a typed num destination";
  }
  return namedNumericSlotValueError(fact, sentence);
}
