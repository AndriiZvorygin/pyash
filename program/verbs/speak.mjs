import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";

export async function speak(sentence, { remember: rememberFn = remember } = {}) {
  const value = renderSayValue(sentence.ob ?? {}, { rememberFn });
  const text = String(value ?? "");
  const res = spawnSync("espeak-ng", ["-x", text], { encoding: "utf8" });
  if (res.error) {
    throwErrorSentence({
      name: "speak defective",
      message: "speak defective",
      from: { name: "speak" },
      raw: { error: res.error?.message }
    });
  }
  if (res.status && res.status !== 0) {
    throwErrorSentence({
      name: "speak defective",
      message: "speak defective",
      from: { name: "speak" },
      raw: { status: res.status }
    });
  }
  const output = String(res.stdout ?? "");
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, output, "utf8");
  }
  // eslint-disable-next-line no-console
  console.log(output.trimEnd());
  return { ob: { text: output }, be: "speak" };
}

export default speak;

export const signatures = [
  { signatureWords: ["be", "speak", "ob", "text"], handler: speak },
  { signatureWords: ["be", "speak", "ob", "name", "text"], handler: speak }
];
