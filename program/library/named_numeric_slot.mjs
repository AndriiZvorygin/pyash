export const MUTABLE_NUMERIC_SLOT_MARKER = "variable";
export const CONSTANT_NUMERIC_SLOT_MARKER = "permanently number";
export const CONSTANT_BOOLEAN_SLOT_MARKER = "permanently boolean";

export function namedNumericSlotKind(fact) {
  const marker = fact?.as?.name;
  if (marker === MUTABLE_NUMERIC_SLOT_MARKER) return "variable";
  if ([CONSTANT_NUMERIC_SLOT_MARKER, CONSTANT_BOOLEAN_SLOT_MARKER].includes(marker)) return "constant";
  return null;
}

function namedSlotType(fact) {
  if (["bool", "boolean"].includes(fact?.be) && typeof fact?.ob?.boolean === "boolean") return "bool";
  if (["num", "number"].includes(fact?.be) && Number.isInteger(fact?.ob?.num)) return "num";
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

export function isNamedBooleanSlotDeclaration(sentence) {
  return Boolean(
    sentence?.mood === "ya"
    && sentence?.su?.name
    && ["bool", "boolean"].includes(sentence.be)
    && typeof sentence.ob?.boolean === "boolean"
    && namedNumericSlotKind(sentence)
  );
}

export function namedNumericSlotValueError(fact, sentence) {
  if (namedNumericSlotKind(fact) !== "variable") return null;
  if (namedSlotType(fact) === "bool") {
    return ["bool", "boolean"].includes(sentence?.be) && typeof sentence?.ob?.boolean === "boolean"
      ? null
      : "boolean variable slot requires a boolean value";
  }
  return (sentence?.be === "number" || sentence?.be === "num")
    && Number.isInteger(sentence?.ob?.num)
    && sentence.ob.num >= 0
    && sentence.ob.num <= 0xffff
    ? null
    : "numeric variable slot requires an unsigned 16-bit number";
}

export function namedNumericSlotWriteError(fact, sentence) {
  if (namedNumericSlotKind(fact) !== "variable") return null;
  if (sentence?.mood === "do") {
    const types = sentence.to?.nameTypeWords ?? [];
    const booleanSlot = namedSlotType(fact) === "bool";
    const compatible = booleanSlot
      ? types.length === 1 && ["bool", "boolean"].includes(types[0])
      : types.length === 1 && ["num", "number"].includes(types[0]);
    if (compatible) return null;
    return booleanSlot
      ? "boolean variable writes require a typed bool destination"
      : "numeric variable writes require a typed num destination";
  }
  return namedNumericSlotValueError(fact, sentence);
}
