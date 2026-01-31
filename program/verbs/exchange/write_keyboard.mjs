import { spawn } from "node:child_process";
import { resolveConfigText } from "../../configure/env.mjs";

function resolveKeyboardCommand({ rememberFn } = {}) {
  const bin = resolveConfigText("keyboard bin", { rememberFn }) || "xdotool";
  return { bin, args: ["type", "--clearmodifiers", "--delay", "0"] };
}

async function sendKeyboardText(text, { bin, args }) {
  if (!text) return;
  await new Promise((resolve, reject) => {
    const proc = spawn(bin, [...args, text], { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", status => {
      if (status && status !== 0) {
        reject(new Error(`keyboard command exited with ${status}`));
      } else {
        resolve();
      }
    });
  });
}

export { resolveKeyboardCommand, sendKeyboardText };
