import { throwErrorSentence } from "../error.mjs";

export async function here() {
  try {
    const cwd = process.cwd();
    return { ob: { filename: cwd }, be: "here" };
  } catch (err) {
    throwErrorSentence({
      name: "here defective",
      message: "here defective",
      from: { name: "here" },
      raw: { error: err?.message }
    });
  }
}

export default here;

export const signatures = [
  { signatureWords: ["be", "here"], handler: here }
];
