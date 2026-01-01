import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";

function resolveCommandText(ob = {}, { rememberFn } = {}) {
  if (typeof ob.wo === "string") return ob.wo;
  return renderSayValue(ob, { rememberFn });
}

export async function command(sentence, { remember: rememberFn = remember } = {}) {
  if (process.env.PYA_COMMAND_RESPONSE) {
    return { ob: { text: String(process.env.PYA_COMMAND_RESPONSE) }, be: "command" };
  }
  const cmd = resolveCommandText(sentence.ob ?? {}, { rememberFn });
  if (!cmd) {
    throwErrorSentence({
      name: "command defective",
      message: "command defective",
      from: { name: "command" },
      raw: { cmd }
    });
  }
  let input = null;
  if (sentence.from?.filename) {
    input = await fs.readFile(sentence.from.filename, "utf8");
  } else if (sentence.fromtext?.text) {
    input = sentence.fromtext.text;
  }
  const res = spawnSync(String(cmd), {
    shell: true,
    input: input ?? undefined,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (res.error || res.status) {
    throwErrorSentence({
      name: "command defective",
      message: "command defective",
      from: { name: "command" },
      raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
    });
  }
  const output = String(res.stdout ?? "");
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, output, "utf8");
  }
  return { ob: { text: output }, be: "command" };
}

export default command;

export const signatures = [
  { signatureWords: ["be", "command", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "wo"], handler: command }
];
