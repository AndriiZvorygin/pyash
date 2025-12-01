// Sigmoid-like activation: 1 / (1 + e^-x)
export async function twiceCrescent(sentence) {
  const z = sentence?.obj?.num ?? sentence?.obj ?? 0;
  const y = 1 / (1 + Math.exp(-z));
  return { obj: y, be: sentence?.be ?? "number" };
}
