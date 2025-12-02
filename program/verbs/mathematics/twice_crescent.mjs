// Sigmoid-like activation: 1 / (1 + e^-x)
export async function twiceCrescent_obj_num(sentence) {
  const z = sentence?.obj?.num ?? sentence?.obj ?? 0;
  const y = 1 / (1 + Math.exp(-z));
  return { obj: y, be: sentence?.be ?? "number" };
}

export const twiceCrescent = twiceCrescent_obj_num;

export const signatures = [
  { signatureWords: ["be", "twice crescent", "obj", "num"], handler: twiceCrescent_obj_num }
];
