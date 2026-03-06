import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseAdbDevicesOutput,
  upsertAndroidDeviceIdSentence
} from "../program/library/android_default_device.mjs";

function usage() {
  return "Usage: node command/android_default_device.mjs [--yes] [--serial <id>] [--file <path>]";
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error(`${command} failed (${code}): ${stderr.trim()}`.trim()));
    });
  });
}

function readFlagValue(args = [], name = "") {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length) return null;
  return args[index + 1];
}

async function pickSerial({ devices = [], serialFlag = "", yes = false } = {}) {
  const healthy = devices.filter((entry) => entry.state === "device");
  if (!healthy.length) return null;
  if (serialFlag) {
    const wanted = healthy.find((entry) => entry.serial === serialFlag);
    if (!wanted) {
      throw new Error(`android default device defective: serial not found in attached ready devices: ${serialFlag}`);
    }
    return wanted.serial;
  }
  if (healthy.length === 1 || yes) return healthy[0].serial;

  console.log("Available ready devices:");
  for (let index = 0; index < healthy.length; index += 1) {
    const item = healthy[index];
    console.log(`${index + 1}. ${item.serial}${item.details ? ` (${item.details})` : ""}`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = String(await rl.question("Pick device number to set as default: ")).trim();
    const picked = Number(answer);
    if (!Number.isFinite(picked) || picked < 1 || picked > healthy.length) {
      throw new Error("android default device defective: invalid selection");
    }
    return healthy[picked - 1].serial;
  } finally {
    rl.close();
  }
}

async function confirmWrite({ serial, filePath, yes }) {
  if (yes) return true;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = String(await rl.question(`Set ${serial} as default in ${filePath}? [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const yes = args.includes("--yes");
  const serialFlag = String(readFlagValue(args, "--serial") ?? "").trim();
  const fileFlag = String(readFlagValue(args, "--file") ?? "").trim();
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const secretPath = fileFlag ? path.resolve(fileFlag) : path.join(repoRoot, "configure", "secret.pya");

  const adb = await runCommand("adb", ["devices", "-l"]);
  const devices = parseAdbDevicesOutput(adb.stdout);
  const chosen = await pickSerial({ devices, serialFlag, yes });
  if (!chosen) {
    console.error("No ready adb device found (state=device).");
    if (devices.length) {
      console.error("Detected devices:");
      for (const entry of devices) {
        console.error(`- ${entry.serial} (${entry.state}) ${entry.details}`.trim());
      }
    }
    process.exit(1);
  }

  const shouldWrite = await confirmWrite({ serial: chosen, filePath: secretPath, yes });
  if (!shouldWrite) {
    console.log("Cancelled. No changes made.");
    return;
  }

  let existing = "";
  try {
    existing = await fs.readFile(secretPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    existing = "";
  }

  const next = upsertAndroidDeviceIdSentence(existing, chosen);
  await fs.mkdir(path.dirname(secretPath), { recursive: true });
  await fs.writeFile(secretPath, next, "utf8");
  console.log(`Default android device set: ${chosen}`);
  console.log(`Wrote: ${secretPath}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
