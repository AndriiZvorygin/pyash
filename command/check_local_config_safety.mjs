#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (idx < 0) return null;
  const token = args[idx];
  if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  return args[idx + 1] ?? null;
}

function detectViolations(text) {
  const markers = [
    { name: "host.docker.internal", pattern: /host\.docker\.internal/i },
    { name: "searxng service host", pattern: /:\/\/searxng(?::\d+)?\b/i },
    { name: "whisperx service host", pattern: /:\/\/whisperx(?::\d+)?\b/i }
  ];
  const violations = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const marker of markers) {
      if (!marker.pattern.test(line)) continue;
      violations.push({
        line: i + 1,
        marker: marker.name,
        text: line.trim()
      });
    }
  }
  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const rootFlag = parseArgValue(args, "--root");
  const rootDir = path.resolve(rootFlag || process.cwd());
  const secretPath = path.join(rootDir, "configure", "secret.pya");

  let text = "";
  try {
    text = await fs.readFile(secretPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.log(`config safety: skip (${secretPath} not found)`);
      return;
    }
    throw err;
  }

  const violations = detectViolations(text);
  if (violations.length === 0) {
    console.log("config safety: pass");
    return;
  }

  console.error("config safety: fail");
  console.error("container-specific hosts found in configure/secret.pya");
  for (const item of violations) {
    console.error(`- line ${item.line}: ${item.marker} :: ${item.text}`);
  }
  console.error("move container routing values to configure/container.pya");
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
