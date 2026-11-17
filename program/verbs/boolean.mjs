import { namedNumericSlotKind } from "../library/named_numeric_slot.mjs";

export function boolean_obj_boolean_to_name_bool(sentence, { remember } = {}) {
  const targetName = sentence.to?.name;
  const target = targetName && typeof remember === "function" ? remember(targetName) : null;
  const targetTypes = sentence.to?.nameTypeWords ?? [];
  if (typeof sentence.ob?.boolean !== "boolean") {
    throw new Error("boolean assignment requires a boolean object");
  }
  if (!targetName || targetTypes.length !== 1 || !["bool", "boolean"].includes(targetTypes[0])) {
    throw new Error("boolean assignment requires a typed boolean destination");
  }
  if (!target || !["bool", "boolean"].includes(target.be) || namedNumericSlotKind(target) !== "variable") {
    throw new Error(`boolean assignment requires a mutable boolean local: ${targetName}`);
  }
  return { ob: { boolean: sentence.ob.boolean }, be: target.be };
}

export default boolean_obj_boolean_to_name_bool;

export const signatures = [
  { signatureWords: ["be", "boolean", "ob", "bool", "to", "name", "bool"], handler: boolean_obj_boolean_to_name_bool },
  { signatureWords: ["be", "boolean", "ob", "bool", "to", "name", "boolean"], handler: boolean_obj_boolean_to_name_bool },
  { signatureWords: ["be", "boolean", "ob", "boolean", "to", "name", "bool"], handler: boolean_obj_boolean_to_name_bool },
  { signatureWords: ["be", "boolean", "ob", "boolean", "to", "name", "boolean"], handler: boolean_obj_boolean_to_name_bool }
];
